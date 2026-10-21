// Home Fin accounts API: accounts → profiles (one Jellyfin user each), invites, admin, trending.
import { AVATARS, AVATAR_KEYS, defaultAvatar } from './avatars.mjs';
import { decrypt, encrypt, hashSecret, randomToken, sha256, verifySecret } from './crypto.mjs';
import { MAX_PROFILES, REQUEST_POLICIES, SESSION_DAYS, toProfile } from './db.mjs';
import {
    HttpError, badRequest, clientIp, cookie, createRateLimiter, createRouter, notFound, parseCookies, readJson, sendJson
} from './http.mjs';
import { registerRequests } from './requests.mjs';

export const SESSION_COOKIE = 'hf_session';
const TRENDING_TTL_MS = 10 * 60 * 1000;
const TRENDING_DAYS = 7;
const INVITE_DAYS = 7;
const MATURITIES = new Set(['kids', 'teen', 'all']);
// Checked against when an email has no account, so the response time doesn't reveal that.
const NO_ACCOUNT_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// ── validation ────────────────────────────────────────────────────────────

function cleanName(value, label = 'Name') {
    const name = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (!name) throw badRequest(`${label} is required`);
    if (name.length > 30) throw badRequest(`${label} must be 30 characters or fewer`);
    return name;
}

function cleanEmail(value) {
    const email = String(value ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw badRequest('Enter a valid email address');
    return email;
}

function cleanPassword(value) {
    const password = String(value ?? '');
    if (password.length < 8) throw badRequest('Password must be at least 8 characters');
    if (password.length > 200) throw badRequest('Password is too long');
    return password;
}

function cleanPin(value) {
    if (value === null || value === '') return null;
    const pin = String(value ?? '');
    if (!/^\d{4}$/.test(pin)) throw badRequest('PIN must be 4 digits');
    return pin;
}

function cleanAvatar(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (!AVATAR_KEYS.has(value)) throw badRequest('Unknown avatar');
    return value;
}

function cleanMaturity(value, fallback = 'all') {
    if (value === undefined || value === null) return fallback;
    if (!MATURITIES.has(value)) throw badRequest('Maturity must be kids, teen or all');
    return value;
}

function cleanDevice(value) {
    const device = value && typeof value === 'object' ? value : {};
    const id = String(device.id ?? '').slice(0, 256);
    if (!id) throw badRequest('Device id is required');
    return {
        id,
        name: String(device.name ?? 'Web Browser').slice(0, 100),
        client: String(device.client ?? 'Home Fin').slice(0, 100),
        version: String(device.version ?? '1.0.0').slice(0, 40)
    };
}

function isUniqueViolation(err) {
    return /UNIQUE constraint failed/i.test(String(err?.message));
}

// ── app ───────────────────────────────────────────────────────────────────

/**
 * @param {object} deps
 * @param {ReturnType<import('./db.mjs').openDatabase>} deps.store
 * @param {ReturnType<import('./jellyfin.mjs').createJellyfinClient>} deps.jellyfin
 * @param {Buffer} deps.key  AES key for profile passwords
 * @param {object} [deps.options]
 */
export function createApp({ store, jellyfin, key, options = {} }) {
    const { cookieSecure = false, serverName = 'Home Fin', allowInvites = true, trustProxy = false } = options;
    const router = createRouter();
    const ipOf = req => clientIp(req, trustProxy);
    // Sign-in: tight per address + email, looser per address and per email, so one person
    // can't lock everyone out and an email can't be locked by a single attacker.
    const loginLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });
    const loginIpLimiter = createRateLimiter({ limit: 30, windowMs: 15 * 60 * 1000 });
    const loginEmailLimiter = createRateLimiter({ limit: 50, windowMs: 15 * 60 * 1000 });
    const pinLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });
    const inviteLimiter = createRateLimiter({ limit: 20, windowMs: 15 * 60 * 1000 });
    let trendingCache = { at: 0, value: null };

    // ── sessions ─────────────────────────────────────────────────────────
    function startSession(req, res, accountId) {
        const token = randomToken();
        store.createSession({ idHash: sha256(token), accountId, userAgent: String(req.headers['user-agent'] || '').slice(0, 300) });
        res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400, secure: cookieSecure }));
    }

    function sessionAccountId(req) {
        const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
        return token ? store.touchSession(sha256(token)) : null;
    }

    function requireAccount(req) {
        const accountId = sessionAccountId(req);
        const account = accountId && store.account(accountId);
        if (!account || account.disabled) throw new HttpError(401, 'Sign in to continue', 'signed_out');
        return account;
    }

    /**
     * An admin: a Home Fin admin account (signed in by cookie), or a Jellyfin administrator using
     * their own Jellyfin login (no Home Fin account needed). A Jellyfin admin has no account id.
     */
    async function requireAdmin(req) {
        const accountId = sessionAccountId(req);
        const account = accountId && store.account(accountId);
        if (account?.isAdmin && !account.disabled) return account;
        if (req.headers['x-jellyfin-token']) {
            const who = await viewer.identify(req);
            if (who.isAdmin) return { id: who.accountId, name: who.name, isAdmin: true };
            throw notFound();
        }
        if (!account || account.disabled) throw new HttpError(401, 'Sign in to continue', 'signed_out');
        throw notFound();
    }

    // Requests, Sonarr / Radarr and quick links; also tells who's watching from their Jellyfin token.
    const viewer = registerRequests({ router, store, jellyfin, key, sessionAccountId, options });

    function meBody(account) {
        return { account, profiles: store.profiles(account.id) };
    }

    // ── profiles ─────────────────────────────────────────────────────────
    async function createProfileFor(accountId, { name, avatar, maturity, pin }) {
        if (store.countProfiles(accountId) >= MAX_PROFILES) throw badRequest(`An account can have up to ${MAX_PROFILES} profiles`);
        if (store.profileRows(accountId).some(p => p.name.toLowerCase() === name.toLowerCase())) {
            throw badRequest('You already have a profile with that name');
        }

        const password = randomToken(32);
        const user = await jellyfin.createUser(`hf-${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`, password);
        try {
            await jellyfin.applyProfilePolicy(user.Id, maturity);
            const id = store.createProfile({
                accountId,
                name,
                avatar,
                maturity,
                pinHash: pin ? await hashSecret(pin) : null,
                jellyfinUserId: user.Id,
                jellyfinPasswordEnc: encrypt(password, key)
            });
            return toProfile(store.profileRow(accountId, id));
        } catch (err) {
            await jellyfin.deleteUser(user.Id).catch(() => undefined);
            throw err;
        }
    }

    async function checkPin(row, pin, req) {
        if (!row.pin_hash) return;
        pinLimiter.check(`${ipOf(req)}:${row.id}`);
        if (!pin || !(await verifySecret(pin, row.pin_hash))) {
            throw new HttpError(403, 'Incorrect PIN', 'bad_pin');
        }
        pinLimiter.reset(`${ipOf(req)}:${row.id}`);
    }

    /** "Forgot PIN?": the account password unlocks editing or deleting a locked profile. */
    async function checkPinOrPassword(row, body, req, account) {
        if (!row.pin_hash || body.accountPassword === undefined) return checkPin(row, body.currentPin, req);
        loginLimiter.check(`pw:${account.id}`);
        const accountRow = store.accountRowById(account.id);
        if (!(await verifySecret(String(body.accountPassword), accountRow.password_hash))) {
            throw new HttpError(403, 'Your password is incorrect', 'bad_password');
        }
        loginLimiter.reset(`pw:${account.id}`);
    }

    /**
     * Sign every device out of an account's profiles: a new Jellyfin password (only this
     * service knows it) makes Jellyfin drop all of that user's existing tokens.
     */
    async function revokeProfileLogins(accountId) {
        for (const row of store.profileRows(accountId)) {
            const password = randomToken(32);
            await jellyfin.setPassword(row.jellyfin_user_id, password);
            store.updateProfile(row.id, { jellyfinPasswordEnc: encrypt(password, key) });
        }
    }

    /** Disabled accounts' profiles are disabled in Jellyfin too, so TVs and apps stop as well. */
    async function setProfilesDisabled(accountId, disabled) {
        for (const row of store.profileRows(accountId)) await jellyfin.setDisabled(row.jellyfin_user_id, disabled);
    }

    async function deleteJellyfinUser(userId) {
        try {
            await jellyfin.deleteUser(userId);
        } catch (err) {
            if (err.status !== 404) throw err;
        }
    }

    // ── routes: public ───────────────────────────────────────────────────
    router.add('GET', '/config', () => ({ enabled: true, serverName, allowInvites }));
    router.add('GET', '/avatars', () => ({ avatars: AVATARS }));

    router.add('POST', '/auth/login', async (req, res) => {
        const body = await readJson(req);
        const email = String(body.email ?? '').trim().toLowerCase();
        const ip = ipOf(req);
        loginIpLimiter.check(ip);
        loginEmailLimiter.check(email);
        loginLimiter.check(`${ip}:${email}`);
        const row = email && store.accountRowByEmail(email);
        const ok = await verifySecret(String(body.password ?? ''), row?.password_hash ?? NO_ACCOUNT_HASH);
        if (!row || !ok) throw new HttpError(401, 'Incorrect email or password', 'bad_credentials');
        if (row.disabled) throw new HttpError(403, 'This account has been disabled', 'disabled');
        loginLimiter.reset(`${ip}:${email}`);
        loginEmailLimiter.reset(email);
        startSession(req, res, row.id);
        return meBody(store.account(row.id));
    });

    router.add('POST', '/auth/logout', (req, res) => {
        const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
        if (token) store.deleteSession(sha256(token));
        res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', { maxAge: 0, secure: cookieSecure }));
        return { ok: true };
    });

    router.add('GET', '/invites/:code', (req, res, { code }) => {
        inviteLimiter.check(ipOf(req));
        const invite = store.inviteByHash(sha256(code));
        const valid = !!invite && !invite.used_at && invite.expires_at > new Date().toISOString();
        return { valid, email: valid ? invite.email : null, serverName };
    });

    router.add('POST', '/invites/:code/accept', async (req, res, { code }) => {
        inviteLimiter.check(ipOf(req));
        const body = await readJson(req);
        const invite = store.inviteByHash(sha256(code));
        if (!invite || invite.used_at || invite.expires_at <= new Date().toISOString()) {
            throw new HttpError(410, 'This invite link has expired or was already used', 'invite_invalid');
        }
        const name = cleanName(body.name);
        const email = cleanEmail(body.email);
        const password = cleanPassword(body.password);
        if (store.accountRowByEmail(email)) throw badRequest('An account with that email already exists');

        const accountId = store.createAccount({ email, name, passwordHash: await hashSecret(password) });
        try {
            await createProfileFor(accountId, { name, avatar: cleanAvatar(body.avatar, defaultAvatar(accountId)), maturity: 'all' });
        } catch (err) {
            store.deleteAccount(accountId);
            throw err;
        }
        store.markInviteUsed(invite.id, accountId);
        startSession(req, res, accountId);
        return meBody(store.account(accountId));
    });

    // ── moving over from a Jellyfin login ────────────────────────────────
    // Someone who signs in with their old Jellyfin username and password can turn that user
    // into a profile (keeping their history): in a new account of their own, or in an account
    // someone in their household already has (with that account's password).

    const MOVE_DEVICE = { id: 'homefin-move-check', name: 'Home Fin sign-in check', client: 'Home Fin Accounts' };

    /** The Jellyfin user behind a username and password, if it can be moved to Home Fin. */
    async function movableUser(req, body) {
        const username = String(body.username ?? '').trim();
        const password = String(body.password ?? '');
        const ip = ipOf(req);
        loginIpLimiter.check(ip);
        loginLimiter.check(`jf:${ip}:${username.toLowerCase()}`);
        if (!username) throw badRequest('Enter your Jellyfin username');

        let auth;
        try {
            auth = await jellyfin.authenticate(username, password, MOVE_DEVICE);
        } catch (err) {
            if (err.status === 401 || err.status === 403) {
                throw new HttpError(401, 'Incorrect Jellyfin username or password', 'bad_credentials');
            }
            throw err;
        }
        // The check needed a Jellyfin session; don't leave it lying around.
        await jellyfin.logout(auth.AccessToken).catch(() => undefined);
        loginLimiter.reset(`jf:${ip}:${username.toLowerCase()}`);

        const user = await jellyfin.getUser(auth.User.Id);
        if (user.Policy?.IsAdministrator) {
            throw new HttpError(403, 'Administrators keep their Jellyfin login. Use "Sign in with Jellyfin" instead.', 'admin_user');
        }
        if (store.profileRowByJellyfinUser(user.Id)) {
            throw new HttpError(409, 'This login has already moved to Home Fin. Sign in with your email.', 'already_moved');
        }
        // A password of 8+ characters stays, so the person's TVs and phones stay signed in.
        // Anything shorter is replaced with one only this service knows.
        return { user, password, keepsPassword: password.length >= 8 };
    }

    router.add('POST', '/auth/move/check', async req => {
        const { user, keepsPassword } = await movableUser(req, await readJson(req));
        return { name: user.Name, keepsPassword };
    });

    router.add('POST', '/auth/move', async (req, res) => {
        const body = await readJson(req);
        const { user, password, keepsPassword } = await movableUser(req, body);
        const profileName = cleanName(body.profileName ?? String(user.Name).slice(0, 30), 'Profile name');

        let accountId;
        let created = false;
        if (body.mode === 'join') {
            const email = String(body.email ?? '').trim().toLowerCase();
            loginEmailLimiter.check(email);
            const row = email && store.accountRowByEmail(email);
            const ok = await verifySecret(String(body.accountPassword ?? ''), row?.password_hash ?? NO_ACCOUNT_HASH);
            if (!row || !ok) throw new HttpError(401, 'Incorrect Home Fin email or password', 'bad_account');
            if (row.disabled) throw new HttpError(403, 'That account has been disabled', 'disabled');
            loginEmailLimiter.reset(email);
            accountId = row.id;
            if (store.countProfiles(accountId) >= MAX_PROFILES) throw badRequest(`That account already has ${MAX_PROFILES} profiles`);
            if (store.profileRows(accountId).some(p => p.name.toLowerCase() === profileName.toLowerCase())) {
                throw badRequest(`That account already has a profile called ${profileName}. Pick another name.`);
            }
        } else {
            const email = cleanEmail(body.email);
            if (store.accountRowByEmail(email)) throw badRequest('There is already a Home Fin account with that email. Choose "Join an account" to add yourself to it.');
            const accountPassword = cleanPassword(body.newPassword || password);
            accountId = store.createAccount({ email, name: profileName, passwordHash: await hashSecret(accountPassword) });
            created = true;
        }

        try {
            const owner = store.account(accountId);
            const jellyfinPassword = keepsPassword ? password : randomToken(32);
            if (!keepsPassword) await jellyfin.setPassword(user.Id, jellyfinPassword);
            await jellyfin.applyProfilePolicy(user.Id, 'all', { disabled: owner.disabled });
            store.createProfile({
                accountId,
                name: profileName,
                avatar: cleanAvatar(body.avatar, defaultAvatar(store.countProfiles(accountId))),
                maturity: 'all',
                jellyfinUserId: user.Id,
                jellyfinPasswordEnc: encrypt(jellyfinPassword, key)
            });
        } catch (err) {
            if (created) store.deleteAccount(accountId);
            throw err;
        }
        startSession(req, res, accountId);
        return meBody(store.account(accountId));
    });

    // ── routes: signed in ────────────────────────────────────────────────
    router.add('GET', '/me', req => meBody(requireAccount(req)));

    router.add('PATCH', '/me', async (req, res) => {
        const account = requireAccount(req);
        const body = await readJson(req);
        const row = store.accountRowById(account.id);
        const fields = {};
        if (body.name !== undefined) fields.name = cleanName(body.name);
        const sensitive = body.email !== undefined || body.newPassword !== undefined;
        if (sensitive && !(await verifySecret(String(body.currentPassword ?? ''), row.password_hash))) {
            throw new HttpError(403, 'Your current password is incorrect', 'bad_password');
        }
        if (body.email !== undefined) {
            fields.email = cleanEmail(body.email);
            const existing = store.accountRowByEmail(fields.email);
            if (existing && existing.id !== account.id) throw badRequest('That email is already in use');
        }
        if (body.newPassword !== undefined) {
            fields.passwordHash = await hashSecret(cleanPassword(body.newPassword));
            // Sign out other browsers when the password changes.
            const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
            store.deleteSessionsForAccount(account.id, sha256(token));
        }
        store.updateAccount(account.id, fields);
        // ...and every device watching as one of its profiles.
        if (fields.passwordHash) await revokeProfileLogins(account.id);
        return meBody(store.account(account.id));
    });

    router.add('POST', '/profiles', async req => {
        const account = requireAccount(req);
        const body = await readJson(req);
        const profile = await createProfileFor(account.id, {
            name: cleanName(body.name),
            avatar: cleanAvatar(body.avatar, defaultAvatar(store.countProfiles(account.id))),
            maturity: cleanMaturity(body.maturity),
            pin: cleanPin(body.pin ?? null)
        });
        return { profile, profiles: store.profiles(account.id) };
    });

    router.add('PATCH', '/profiles/:id', async (req, res, { id }) => {
        const account = requireAccount(req);
        const row = store.profileRow(account.id, Number(id));
        if (!row) throw notFound('Profile not found');
        const body = await readJson(req);
        await checkPinOrPassword(row, body, req, account);

        const fields = {};
        if (body.name !== undefined) {
            fields.name = cleanName(body.name);
            if (store.profileRows(account.id).some(p => p.id !== row.id && p.name.toLowerCase() === fields.name.toLowerCase())) {
                throw badRequest('You already have a profile with that name');
            }
        }
        if (body.avatar !== undefined) fields.avatar = cleanAvatar(body.avatar, row.avatar);
        if (body.pin !== undefined) {
            const pin = cleanPin(body.pin);
            fields.pinHash = pin ? await hashSecret(pin) : null;
        }
        if (body.maturity !== undefined) {
            fields.maturity = cleanMaturity(body.maturity);
            if (fields.maturity !== row.maturity) await jellyfin.applyProfilePolicy(row.jellyfin_user_id, fields.maturity);
        }
        try {
            store.updateProfile(row.id, fields);
        } catch (err) {
            if (isUniqueViolation(err)) throw badRequest('You already have a profile with that name');
            throw err;
        }
        return { profile: toProfile(store.profileRow(account.id, row.id)), profiles: store.profiles(account.id) };
    });

    router.add('DELETE', '/profiles/:id', async (req, res, { id }) => {
        const account = requireAccount(req);
        const row = store.profileRow(account.id, Number(id));
        if (!row) throw notFound('Profile not found');
        if (store.countProfiles(account.id) <= 1) throw badRequest('An account needs at least one profile');
        const body = await readJson(req);
        await checkPinOrPassword(row, body, req, account);
        await deleteJellyfinUser(row.jellyfin_user_id);
        store.deleteProfile(row.id);
        return { profiles: store.profiles(account.id) };
    });

    router.add('POST', '/profiles/:id/session', async (req, res, { id }) => {
        const account = requireAccount(req);
        const row = store.profileRow(account.id, Number(id));
        if (!row) throw notFound('Profile not found');
        const body = await readJson(req);
        await checkPin(row, body.pin, req);
        const device = cleanDevice(body.device);

        const user = await jellyfin.getUser(row.jellyfin_user_id);
        let password = decrypt(row.jellyfin_password_enc, key);
        let authentication;
        try {
            authentication = await jellyfin.authenticate(user.Name, password, device);
        } catch (err) {
            if (err.status !== 401) throw err;
            // Password changed outside Home Fin: take it back and retry once.
            password = randomToken(32);
            await jellyfin.setPassword(row.jellyfin_user_id, password);
            store.updateProfile(row.id, { jellyfinPasswordEnc: encrypt(password, key) });
            authentication = await jellyfin.authenticate(user.Name, password, device);
        }
        return { authentication, profile: toProfile(row) };
    });

    router.add('GET', '/trending', async req => {
        requireAccount(req);
        if (trendingCache.value && Date.now() - trendingCache.at < TRENDING_TTL_MS) return trendingCache.value;

        const cutoff = new Date(Date.now() - TRENDING_DAYS * 86400000).toISOString();
        const titles = new Map();
        for (const profile of store.allProfileRows()) {
            const result = await jellyfin.recentlyPlayed(profile.jellyfin_user_id).catch(() => ({ Items: [] }));
            const seenByViewer = new Set();
            for (const item of result.Items || []) {
                const played = item.UserData?.LastPlayedDate;
                if (!played || played < cutoff) continue;
                const isEpisode = item.Type === 'Episode';
                const titleId = isEpisode ? item.SeriesId : item.Id;
                if (!titleId) continue;
                const entry = titles.get(titleId) || { id: titleId, type: isEpisode ? 'Series' : 'Movie', viewers: 0, plays: 0 };
                entry.plays += 1;
                if (!seenByViewer.has(titleId)) {
                    seenByViewer.add(titleId);
                    entry.viewers += 1;
                }
                titles.set(titleId, entry);
            }
        }
        const rank = type => [...titles.values()]
            .filter(t => t.type === type)
            .sort((a, b) => b.viewers - a.viewers || b.plays - a.plays)
            .slice(0, 10);
        const value = { days: TRENDING_DAYS, series: rank('Series'), movies: rank('Movie') };
        trendingCache = { at: Date.now(), value };
        return value;
    });

    // ── routes: admin ────────────────────────────────────────────────────
    /** Who is using the admin pages: a Home Fin admin account or a Jellyfin administrator. */
    router.add('GET', '/admin/me', async req => {
        const admin = await requireAdmin(req);
        return { name: admin.name, accountId: admin.id ?? null };
    });

    router.add('GET', '/admin/accounts', async req => {
        await requireAdmin(req);
        return { accounts: store.listAccounts().map(account => ({ ...account, profiles: store.profiles(account.id) })) };
    });

    router.add('POST', '/admin/accounts', async req => {
        await requireAdmin(req);
        const body = await readJson(req);
        const name = cleanName(body.name);
        const email = cleanEmail(body.email);
        const password = cleanPassword(body.password);
        if (store.accountRowByEmail(email)) throw badRequest('An account with that email already exists');
        const accountId = store.createAccount({ email, name, passwordHash: await hashSecret(password), isAdmin: !!body.isAdmin });
        try {
            await createProfileFor(accountId, { name: cleanName(body.profileName ?? name, 'Profile name'), avatar: defaultAvatar(accountId), maturity: 'all' });
        } catch (err) {
            store.deleteAccount(accountId);
            throw err;
        }
        return { account: { ...store.account(accountId), profiles: store.profiles(accountId) } };
    });

    router.add('PATCH', '/admin/accounts/:id', async (req, res, { id }) => {
        const admin = await requireAdmin(req);
        const target = store.account(Number(id));
        if (!target) throw notFound('Account not found');
        const body = await readJson(req);
        const fields = {};
        if (body.disabled !== undefined) {
            if (target.id === admin.id) throw badRequest("You can't disable your own account");
            fields.disabled = !!body.disabled;
        }
        if (body.isAdmin !== undefined) {
            if (target.id === admin.id && !body.isAdmin) throw badRequest("You can't remove your own admin access");
            fields.isAdmin = !!body.isAdmin;
        }
        if (body.name !== undefined) fields.name = cleanName(body.name);
        if (body.requestPolicy !== undefined) {
            if (!REQUEST_POLICIES.has(body.requestPolicy)) throw badRequest('Requests must be auto, approve or off');
            fields.requestPolicy = body.requestPolicy;
        }
        if (body.password !== undefined) fields.passwordHash = await hashSecret(cleanPassword(body.password));
        store.updateAccount(target.id, fields);
        if (fields.disabled || fields.passwordHash) store.deleteSessionsForAccount(target.id);
        if (fields.disabled !== undefined && fields.disabled !== !!target.disabled) await setProfilesDisabled(target.id, fields.disabled);
        if (fields.disabled || fields.passwordHash) await revokeProfileLogins(target.id);
        return { account: { ...store.account(target.id), profiles: store.profiles(target.id) } };
    });

    router.add('DELETE', '/admin/accounts/:id', async (req, res, { id }) => {
        const admin = await requireAdmin(req);
        const target = store.account(Number(id));
        if (!target) throw notFound('Account not found');
        if (target.id === admin.id) throw badRequest("You can't delete your own account");
        for (const profile of store.profileRows(target.id)) await deleteJellyfinUser(profile.jellyfin_user_id);
        store.deleteAccount(target.id);
        return { ok: true };
    });

    router.add('GET', '/admin/invites', async req => {
        await requireAdmin(req);
        const invites = store.listInvites().map(i => ({
            id: i.id, email: i.email, note: i.note, expiresAt: i.expires_at, usedAt: i.used_at, usedBy: i.used_by, createdAt: i.created_at
        }));
        return { invites };
    });

    router.add('POST', '/admin/invites', async req => {
        const admin = await requireAdmin(req);
        const body = await readJson(req);
        const days = Math.min(Math.max(Number(body.days) || INVITE_DAYS, 1), 30);
        const email = body.email ? cleanEmail(body.email) : null;
        const note = body.note ? String(body.note).slice(0, 100) : null;
        const code = randomToken(18);
        const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
        const id = store.createInvite({ codeHash: sha256(code), createdBy: admin.id, email, note, expiresAt });

        // The admin's browser tells us where the web app lives (e.g. https://tv.example.com/web/index.html).
        let base = '';
        try {
            const url = new URL(String(body.baseUrl ?? ''));
            if (url.protocol === 'https:' || url.protocol === 'http:') base = url.origin + url.pathname;
        } catch {
            base = '';
        }
        return { invite: { id, email, note, expiresAt, code, url: `${base}#/homefin/join?code=${encodeURIComponent(code)}` } };
    });

    router.add('DELETE', '/admin/invites/:id', async (req, res, { id }) => {
        await requireAdmin(req);
        store.deleteInvite(Number(id));
        return { ok: true };
    });

    router.add('GET', '/admin/jellyfin-users', async req => {
        await requireAdmin(req);
        const linked = new Set(store.allProfileRows().map(p => p.jellyfin_user_id));
        const users = await jellyfin.listUsers();
        return {
            users: users
                .filter(u => !linked.has(u.Id) && !String(u.Name).startsWith('hf-'))
                .map(u => ({ id: u.Id, name: u.Name, isAdmin: !!u.Policy?.IsAdministrator, lastActivity: u.LastActivityDate ?? null }))
        };
    });

    router.add('POST', '/admin/adopt', async req => {
        await requireAdmin(req);
        const body = await readJson(req);
        const accountId = Number(body.accountId);
        const owner = store.account(accountId);
        if (!owner) throw notFound('Account not found');
        const userId = String(body.jellyfinUserId ?? '');
        if (store.profileRowByJellyfinUser(userId)) throw badRequest('That Jellyfin user is already a profile');
        const user = await jellyfin.getUser(userId);
        if (user.Policy?.IsAdministrator) {
            throw badRequest('Administrator users stay as normal Jellyfin logins. Make a new profile instead.');
        }
        if (store.countProfiles(accountId) >= MAX_PROFILES) throw badRequest(`An account can have up to ${MAX_PROFILES} profiles`);
        const name = cleanName(body.name ?? user.Name);
        if (store.profileRows(accountId).some(p => p.name.toLowerCase() === name.toLowerCase())) {
            throw badRequest('That account already has a profile with that name');
        }

        const password = randomToken(32);
        await jellyfin.setPassword(user.Id, password);
        await jellyfin.applyProfilePolicy(user.Id, cleanMaturity(body.maturity), { disabled: owner.disabled });
        const id = store.createProfile({
            accountId,
            name,
            avatar: cleanAvatar(body.avatar, defaultAvatar(store.countProfiles(accountId))),
            maturity: cleanMaturity(body.maturity),
            jellyfinUserId: user.Id,
            jellyfinPasswordEnc: encrypt(password, key)
        });
        return { profile: toProfile(store.profileRow(accountId, id)) };
    });

    // ── dispatcher ───────────────────────────────────────────────────────
    /** Handle a request whose path has already had the API prefix removed. */
    return async function handle(req, res, path) {
        try {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                // CSRF: JSON-only API, and the Origin (when sent) must be this host.
                if (!String(req.headers['content-type'] || '').includes('application/json')) {
                    throw new HttpError(415, 'Expected application/json');
                }
                const origin = req.headers.origin;
                const host = req.headers['x-forwarded-host'] || req.headers.host;
                if (origin && host && new URL(origin).host !== host) throw new HttpError(403, 'Cross-site request blocked');
            }
            const match = router.match(req.method, path);
            if (!match) throw notFound();
            if (match.methodNotAllowed) throw new HttpError(405, 'Method not allowed');
            const result = await match.handler(req, res, match.params);
            sendJson(res, 200, result);
        } catch (err) {
            if (err instanceof HttpError) {
                sendJson(res, err.status, { error: err.message, code: err.code });
            } else if (err.arr) {
                // Sonarr / Radarr unreachable or unhappy: say so plainly.
                sendJson(res, 502, { error: err.message, code: 'arr_error' });
            } else {
                console.error('[homefin-accounts]', req.method, path, err);
                sendJson(res, err.status === 401 || err.status === 404 ? 502 : 500, { error: 'Something went wrong talking to Jellyfin', code: 'server_error' });
            }
        }
    };
}
