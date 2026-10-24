// Requests (Home Fin's built-in Jellyseerr): search Sonarr / Radarr, request a title, an admin
// approves (or the account is trusted to skip that), and the title is added and searched for.
// Also the admin settings for Sonarr / Radarr and the quick links to the rest of the stack.
import { createRadarr, createSonarr, realSeasons, toResult } from './arr.mjs';
import { decrypt, encrypt, sha256 } from './crypto.mjs';
import { REQUEST_POLICIES, toRequest } from './db.mjs';
import { HttpError, badRequest, createRateLimiter, notAdmin, notFound, readJson } from './http.mjs';

const SERVICES = { radarr: createRadarr, sonarr: createSonarr };
const LIBRARY_TTL_MS = 60 * 1000;
const IDENTITY_TTL_MS = 2 * 60 * 1000;
const MAX_LINKS = 20;

function cleanUrl(value, label = 'URL') {
    let url;
    try {
        url = new URL(String(value ?? '').trim());
    } catch {
        throw badRequest(`${label} must be a full address, like http://192.168.1.20:7878`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw badRequest(`${label} must start with http:// or https://`);
    return url.href.replace(/\/+$/, '');
}

/**
 * @param {object} deps
 * @param {ReturnType<import('./http.mjs').createRouter>} deps.router
 * @param {ReturnType<import('./db.mjs').openDatabase>} deps.store
 * @param {ReturnType<import('./jellyfin.mjs').createJellyfinClient>} deps.jellyfin
 * @param {Buffer} deps.key  AES key (API keys are stored encrypted)
 * @param {(req: any) => number | null} deps.sessionAccountId  the Home Fin account signed in by cookie, if any
 * @param {object} [deps.options]
 */
export function registerRequests({ router, store, jellyfin, key, sessionAccountId, options = {} }) {
    const { fetchImpl = fetch, libraryTtlMs = LIBRARY_TTL_MS } = options;
    const searchLimiter = createRateLimiter({ limit: 60, windowMs: 60 * 1000 });
    const identities = new Map();
    let libraryCache = { at: 0, value: null };

    // ── who is asking ────────────────────────────────────────────────────
    // The web client sends the viewer's Jellyfin token, which says exactly which profile (or plain
    // Jellyfin user) is watching. Without it, a Home Fin account signed in by cookie counts.

    async function jellyfinUser(token) {
        const hash = sha256(token);
        const cached = identities.get(hash);
        if (cached && cached.at > Date.now() - IDENTITY_TTL_MS) return cached.user;
        let user;
        try {
            user = await jellyfin.me(token);
        } catch (err) {
            if (err.status === 401 || err.status === 403) throw new HttpError(401, 'Sign in to continue', 'signed_out');
            throw err;
        }
        if (identities.size > 1000) identities.clear();
        identities.set(hash, { at: Date.now(), user });
        return user;
    }

    async function identify(req) {
        const token = String(req.headers['x-jellyfin-token'] || '');
        if (token) {
            const user = await jellyfinUser(token);
            const profile = store.profileRowByJellyfinUser(user.Id);
            const account = profile && store.account(profile.account_id);
            if (account?.disabled) throw new HttpError(401, 'Sign in to continue', 'signed_out');
            const isAdmin = !!user.Policy?.IsAdministrator || !!account?.isAdmin;
            return {
                userId: user.Id,
                name: profile?.name || user.Name,
                accountId: account?.id ?? null,
                isAdmin,
                policy: isAdmin ? 'auto' : account?.requestPolicy || defaultPolicy()
            };
        }
        const accountId = sessionAccountId(req);
        const account = accountId && store.account(accountId);
        if (!account || account.disabled) throw new HttpError(401, 'Sign in to continue', 'signed_out');
        return {
            userId: `account:${account.id}`,
            name: account.name,
            accountId: account.id,
            isAdmin: account.isAdmin,
            policy: account.isAdmin ? 'auto' : account.requestPolicy
        };
    }

    async function requireAdmin(req) {
        const who = await identify(req);
        if (!who.isAdmin) throw notAdmin();
        return who;
    }

    // ── settings ─────────────────────────────────────────────────────────
    const defaultPolicy = () => store.getSetting('requests', {}).defaultPolicy || 'approve';

    function serviceConfig(service) {
        const saved = store.getSetting(service);
        return saved ? { ...saved, apiKey: decrypt(saved.apiKeyEnc, key) } : null;
    }

    function client(service, config = serviceConfig(service)) {
        return config ? SERVICES[service]({ url: config.url, apiKey: config.apiKey, fetchImpl }) : null;
    }

    function requireClient(service) {
        const arr = client(service);
        if (!arr) throw new HttpError(409, `${service === 'radarr' ? 'Radarr' : 'Sonarr'} isn't set up yet`, 'not_configured');
        return arr;
    }

    // ── what's already there ─────────────────────────────────────────────
    /** What Radarr / Sonarr already have, and what they're downloading (cached for a minute). */
    async function library(force = false) {
        if (!force && libraryCache.value && libraryCache.at > Date.now() - libraryTtlMs) return libraryCache.value;
        const radarr = client('radarr');
        const sonarr = client('sonarr');
        const [movies, series, movieQueue, seriesQueue] = await Promise.all([
            radarr ? radarr.library().catch(() => []) : [],
            sonarr ? sonarr.library().catch(() => []) : [],
            radarr ? radarr.queue().catch(() => null) : null,
            sonarr ? sonarr.queue().catch(() => null) : null
        ]);
        const progress = (queue, idKey) => {
            const out = new Map();
            for (const entry of queue?.records || []) {
                const id = entry[idKey];
                if (!id || !entry.size) continue;
                const current = out.get(id) || { size: 0, left: 0 };
                out.set(id, { size: current.size + entry.size, left: current.left + (entry.sizeleft || 0) });
            }
            return out;
        };
        const value = {
            movies: new Map(movies.map(m => [m.tmdbId, m])),
            series: new Map(series.map(s => [s.tvdbId, s])),
            movieProgress: progress(movieQueue, 'movieId'),
            seriesProgress: progress(seriesQueue, 'seriesId')
        };
        libraryCache = { at: Date.now(), value };
        return value;
    }

    /** available / partial / downloading / processing, from Radarr or Sonarr; null if they don't have it. */
    function arrState(type, mediaId, lib, seasons = null) {
        if (type === 'movie') {
            const movie = lib.movies.get(mediaId);
            if (!movie) return null;
            if (movie.hasFile) return { state: 'available' };
            const dl = lib.movieProgress.get(movie.id);
            return dl ? { state: 'downloading', progress: Math.round(100 * (1 - dl.left / dl.size)) } : { state: movie.monitored ? 'processing' : null };
        }
        const series = lib.series.get(mediaId);
        if (!series) return null;
        const wanted = seasons || realSeasons(series);
        const stats = (series.seasons || []).filter(s => wanted.includes(s.seasonNumber)).map(s => s.statistics || {});
        const total = stats.reduce((n, s) => n + (s.totalEpisodeCount || s.episodeCount || 0), 0);
        const have = stats.reduce((n, s) => n + (s.episodeFileCount || 0), 0);
        const dl = lib.seriesProgress.get(series.id);
        if (total && have >= total) return { state: 'available' };
        if (dl) return { state: 'downloading', progress: Math.round(100 * (1 - dl.left / dl.size)) };
        if (have) return { state: 'partial' };
        const monitored = (series.seasons || []).some(s => s.monitored && wanted.includes(s.seasonNumber));
        return { state: monitored ? 'processing' : null };
    }

    /** A request for the web client, with live progress for approved ones. */
    function requestView(row, lib) {
        const request = toRequest(row);
        if (row.status === 'approved' || row.status === 'available') {
            const live = arrState(row.media_type, row.media_id, lib, request.seasons);
            if (live?.state === 'available' && row.status !== 'available') store.updateRequest(row.id, { status: 'available' });
            return { ...request, status: live?.state === 'available' ? 'available' : 'approved', state: live?.state || 'processing', progress: live?.progress ?? null };
        }
        return { ...request, state: row.status, progress: null };
    }

    // ── adding to Radarr / Sonarr ────────────────────────────────────────
    async function sendToRadarr(row) {
        const radarr = requireClient('radarr');
        const config = serviceConfig('radarr');
        const lib = await library(true);
        const existing = lib.movies.get(row.media_id);
        if (existing) {
            if (!existing.monitored) await radarr.update({ ...existing, monitored: true });
            if (!existing.hasFile) await radarr.search(existing.id);
            return;
        }
        const movie = await radarr.lookupTmdb(row.media_id);
        await radarr.add({
            ...movie,
            qualityProfileId: config.qualityProfileId,
            rootFolderPath: config.rootFolderPath,
            monitored: true,
            minimumAvailability: 'released',
            addOptions: { searchForMovie: true }
        });
    }

    async function sendToSonarr(row) {
        const sonarr = requireClient('sonarr');
        const config = serviceConfig('sonarr');
        const lib = await library(true);
        const requested = row.seasons ? JSON.parse(row.seasons) : null;
        const existing = lib.series.get(row.media_id);
        if (existing) {
            const series = await sonarr.get(existing.id);
            const wanted = requested || realSeasons(series);
            await sonarr.update({
                ...series,
                monitored: true,
                seasons: series.seasons.map(s => ({ ...s, monitored: s.monitored || wanted.includes(s.seasonNumber) }))
            });
            if (requested) {
                for (const season of requested) await sonarr.searchSeason(series.id, season);
            } else {
                await sonarr.searchSeries(series.id);
            }
            return;
        }
        const series = await sonarr.lookupTvdb(row.media_id);
        if (!series) throw new Error('Sonarr couldn\'t find this show any more');
        const wanted = requested || realSeasons(series);
        await sonarr.add({
            ...series,
            qualityProfileId: config.qualityProfileId,
            ...(config.languageProfileId ? { languageProfileId: config.languageProfileId } : {}),
            rootFolderPath: config.rootFolderPath,
            seasonFolder: true,
            monitored: true,
            seasons: (series.seasons || []).map(s => ({ ...s, monitored: wanted.includes(s.seasonNumber) })),
            addOptions: { ignoreEpisodesWithFiles: true, searchForMissingEpisodes: true }
        });
    }

    /** Approve: hand the title to Radarr / Sonarr. A failure is kept on the request to retry. */
    async function approve(row, by) {
        try {
            await (row.media_type === 'movie' ? sendToRadarr(row) : sendToSonarr(row));
            store.updateRequest(row.id, { status: 'approved', decidedByName: by.name });
        } catch (err) {
            if (!err.arr && !(err instanceof HttpError)) console.error('[homefin-accounts] request', row.id, err);
            store.updateRequest(row.id, { status: 'failed', decidedByName: by.name, reason: err.message });
        }
        libraryCache.at = 0;
        return store.requestRow(row.id);
    }

    // ── routes: everyone ─────────────────────────────────────────────────
    router.add('GET', '/requests/config', async req => {
        const who = await identify(req);
        const movies = !!store.getSetting('radarr');
        const tv = !!store.getSetting('sonarr');
        return { enabled: movies || tv, movies, tv, policy: who.policy, isAdmin: who.isAdmin };
    });

    router.add('GET', '/requests/search', async (req) => {
        const who = await identify(req);
        searchLimiter.check(who.userId);
        const term = new URL(req.url, 'http://x').searchParams.get('q')?.trim().slice(0, 100) || '';
        if (term.length < 2) return { results: [] };
        const radarr = client('radarr');
        const sonarr = client('sonarr');
        const [movies, shows, lib] = await Promise.all([
            radarr ? radarr.lookup(term).catch(() => []) : [],
            sonarr ? sonarr.lookup(term).catch(() => []) : [],
            library()
        ]);
        // Interleave so films and shows both show near the top.
        const results = [];
        const max = Math.max(movies.length, shows.length);
        for (let i = 0; i < max && results.length < 40; i++) {
            if (movies[i]?.tmdbId) results.push(toResult('movie', movies[i]));
            if (shows[i]?.tvdbId) results.push(toResult('tv', shows[i]));
        }
        return {
            results: results.map(result => {
                const live = arrState(result.type, result.id, lib);
                const latest = store.requestsFor(result.type, result.id)[0];
                const state = live?.state || (latest && ['pending', 'declined', 'failed'].includes(latest.status) ? latest.status : null);
                return { ...result, state, progress: live?.progress ?? null };
            })
        };
    });

    router.add('GET', '/requests', async req => {
        const who = await identify(req);
        const lib = await library();
        return {
            mine: store.requestsByUser(who.userId).map(row => requestView(row, lib)),
            household: store.listRequests({ limit: 40 }).filter(row => row.requested_by_user !== who.userId).map(row => requestView(row, lib))
        };
    });

    router.add('POST', '/requests', async req => {
        const who = await identify(req);
        if (who.policy === 'off') throw new HttpError(403, 'Requests are turned off for your account', 'requests_off');
        const body = await readJson(req);
        const type = body.type === 'tv' ? 'tv' : 'movie';
        const mediaId = Number(body.id);
        if (!Number.isInteger(mediaId) || mediaId <= 0) throw badRequest('Missing title id');
        const arr = requireClient(type === 'movie' ? 'radarr' : 'sonarr');

        const item = type === 'movie' ? await arr.lookupTmdb(mediaId) : await arr.lookupTvdb(mediaId);
        if (!item) throw notFound('That title couldn\'t be found');
        let seasons = null;
        if (type === 'tv' && Array.isArray(body.seasons) && body.seasons.length) {
            const valid = new Set(realSeasons(item));
            seasons = [...new Set(body.seasons.map(Number))].filter(n => valid.has(n)).sort((a, b) => a - b);
            if (!seasons.length) throw badRequest('Pick at least one season');
            if (seasons.length === valid.size) seasons = null;
        }

        const lib = await library(true);
        const live = arrState(type, mediaId, lib, seasons);
        if (live?.state === 'available') throw new HttpError(409, 'That\'s already in the library', 'available');
        const open = store.requestsFor(type, mediaId).find(r => r.status === 'pending');
        if (open) throw new HttpError(409, `${open.requested_by_name} already asked for this. It's waiting for approval.`, 'already_requested');
        if (live && ['processing', 'downloading'].includes(live.state)) throw new HttpError(409, 'That\'s already on its way', 'processing');

        const result = toResult(type, item);
        const id = store.createRequest({
            type, mediaId, title: result.title, year: result.year, poster: result.poster, seasons,
            requestedByUser: who.userId, requestedByName: who.name, accountId: who.accountId
        });
        let row = store.requestRow(id);
        if (who.policy === 'auto') row = await approve(row, who);
        return { request: requestView(row, await library()) };
    });

    router.add('DELETE', '/requests/:id', async (req, res, { id }) => {
        const who = await identify(req);
        const row = store.requestRow(Number(id));
        if (!row) throw notFound('Request not found');
        if (!who.isAdmin && (row.requested_by_user !== who.userId || row.status !== 'pending')) {
            throw new HttpError(403, 'Only waiting requests can be cancelled', 'forbidden');
        }
        store.deleteRequest(row.id);
        return { ok: true };
    });

    router.add('GET', '/links', async req => {
        const who = await identify(req);
        const links = store.getSetting('links', []);
        return { links: links.filter(link => who.isAdmin || link.audience === 'everyone') };
    });

    // ── routes: admins ───────────────────────────────────────────────────
    router.add('GET', '/admin/requests', async req => {
        await requireAdmin(req);
        const lib = await library();
        return {
            pending: store.listRequests({ status: 'pending' }).map(row => requestView(row, lib)),
            failed: store.listRequests({ status: 'failed', limit: 20 }).map(row => requestView(row, lib)),
            recent: store.listRequests({ limit: 30 }).filter(row => !['pending', 'failed'].includes(row.status)).map(row => requestView(row, lib))
        };
    });

    router.add('POST', '/admin/requests/:id/approve', async (req, res, { id }) => {
        const who = await requireAdmin(req);
        const row = store.requestRow(Number(id));
        if (!row) throw notFound('Request not found');
        if (!['pending', 'failed', 'declined'].includes(row.status)) throw badRequest('That request was already approved');
        const updated = await approve(row, who);
        if (updated.status === 'failed') throw new HttpError(502, updated.reason, 'arr_failed');
        return { request: requestView(updated, await library()) };
    });

    router.add('POST', '/admin/requests/:id/decline', async (req, res, { id }) => {
        const who = await requireAdmin(req);
        const row = store.requestRow(Number(id));
        if (!row) throw notFound('Request not found');
        const body = await readJson(req);
        store.updateRequest(row.id, { status: 'declined', decidedByName: who.name, reason: body.reason ? String(body.reason).slice(0, 200) : null });
        return { request: requestView(store.requestRow(row.id), await library()) };
    });

    router.add('GET', '/admin/integrations', async req => {
        await requireAdmin(req);
        const view = service => {
            const saved = store.getSetting(service);
            return saved ? {
                url: saved.url, hasKey: true, qualityProfileId: saved.qualityProfileId, rootFolderPath: saved.rootFolderPath,
                languageProfileId: saved.languageProfileId ?? null
            } : null;
        };
        return { radarr: view('radarr'), sonarr: view('sonarr'), defaultPolicy: defaultPolicy() };
    });

    /** Check the address and key; returns what the admin picks from (quality profiles, folders). */
    async function testService(service, body) {
        const saved = serviceConfig(service);
        const url = cleanUrl(body.url ?? saved?.url);
        const apiKey = String(body.apiKey || (saved && saved.url === url ? saved.apiKey : '') || '').trim();
        if (!apiKey) throw badRequest('Enter the API key (Settings → General in Sonarr / Radarr)');
        const arr = client(service, { url, apiKey });
        let status;
        try {
            status = await arr.status();
        } catch (err) {
            throw new HttpError(400, err.message, 'arr_unreachable');
        }
        const expected = service === 'radarr' ? 'radarr' : 'sonarr';
        if (status.appName && status.appName.toLowerCase() !== expected) {
            throw badRequest(`That address is ${status.appName}, not ${expected === 'radarr' ? 'Radarr' : 'Sonarr'}`);
        }
        const [qualityProfiles, rootFolders, languageProfiles] = await Promise.all([
            arr.qualityProfiles(),
            arr.rootFolders(),
            service === 'sonarr' ? arr.languageProfiles() : []
        ]);
        return {
            url, apiKey, version: status.version,
            qualityProfiles: qualityProfiles.map(p => ({ id: p.id, name: p.name })),
            rootFolders: rootFolders.map(f => ({ path: f.path, freeSpace: f.freeSpace ?? null })),
            languageProfiles: (languageProfiles || []).map(p => ({ id: p.id, name: p.name }))
        };
    }

    router.add('POST', '/admin/integrations/:service/test', async (req, res, { service }) => {
        await requireAdmin(req);
        if (!SERVICES[service]) throw notFound();
        const { apiKey, ...result } = await testService(service, await readJson(req));
        return result;
    });

    router.add('PUT', '/admin/integrations/:service', async (req, res, { service }) => {
        await requireAdmin(req);
        if (!SERVICES[service]) throw notFound();
        const body = await readJson(req);
        const tested = await testService(service, body);
        const qualityProfileId = Number(body.qualityProfileId ?? tested.qualityProfiles[0]?.id);
        if (!tested.qualityProfiles.some(p => p.id === qualityProfileId)) throw badRequest('Pick a quality profile');
        const rootFolderPath = String(body.rootFolderPath ?? tested.rootFolders[0]?.path ?? '');
        if (!tested.rootFolders.some(f => f.path === rootFolderPath)) throw badRequest('Pick a root folder (add one in Sonarr / Radarr first)');
        const languageProfileId = tested.languageProfiles.length ? Number(body.languageProfileId ?? tested.languageProfiles[0].id) : null;
        store.setSetting(service, { url: tested.url, apiKeyEnc: encrypt(tested.apiKey, key), qualityProfileId, rootFolderPath, languageProfileId });
        libraryCache.at = 0;
        return { ok: true };
    });

    router.add('DELETE', '/admin/integrations/:service', async (req, res, { service }) => {
        await requireAdmin(req);
        if (!SERVICES[service]) throw notFound();
        store.setSetting(service, null);
        libraryCache.at = 0;
        return { ok: true };
    });

    router.add('PUT', '/admin/requests-settings', async req => {
        await requireAdmin(req);
        const body = await readJson(req);
        if (!REQUEST_POLICIES.has(body.defaultPolicy)) throw badRequest('Choose auto, approve or off');
        store.setSetting('requests', { defaultPolicy: body.defaultPolicy });
        return { defaultPolicy: body.defaultPolicy };
    });

    router.add('GET', '/admin/links', async req => {
        await requireAdmin(req);
        return { links: store.getSetting('links', []) };
    });

    router.add('PUT', '/admin/links', async req => {
        await requireAdmin(req);
        const body = await readJson(req);
        if (!Array.isArray(body.links)) throw badRequest('Expected a list of links');
        if (body.links.length > MAX_LINKS) throw badRequest(`Up to ${MAX_LINKS} links`);
        const links = body.links.map((link, i) => {
            const name = String(link?.name ?? '').trim().slice(0, 40);
            if (!name) throw badRequest(`Link ${i + 1} needs a name`);
            return {
                name,
                url: cleanUrl(link.url, `${name}'s address`),
                icon: /^[a-z_]{1,40}$/.test(String(link.icon ?? '')) ? link.icon : 'link',
                audience: link.audience === 'everyone' ? 'everyone' : 'admins'
            };
        });
        store.setSetting('links', links);
        return { links };
    });

    return { identify };
}
