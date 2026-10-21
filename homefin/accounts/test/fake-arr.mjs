// A pretend Radarr (/radarr) and Sonarr (/sonarr) for tests and local browser checks:
//   node test/fake-arr.mjs 8989   → Radarr at http://127.0.0.1:8989/radarr, Sonarr at …/sonarr, API key "arr-key"
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const poster = id => `https://image.tmdb.org/t/p/w500/${id}.jpg`;

export const MOVIES = [
    { tmdbId: 603, title: 'The Matrix', year: 1999, overview: 'A hacker learns the truth about his reality.', genres: ['Action', 'Science Fiction'], runtime: 136, certification: '15' },
    { tmdbId: 604, title: 'The Matrix Reloaded', year: 2003, overview: 'Neo and the rebels fight on.', genres: ['Action'], runtime: 138, certification: '15' },
    { tmdbId: 27205, title: 'Inception', year: 2010, overview: 'A thief who steals secrets through dreams.', genres: ['Action', 'Thriller'], runtime: 148, certification: '12A' }
].map(m => ({ ...m, images: [{ coverType: 'poster', remoteUrl: poster(m.tmdbId) }, { coverType: 'fanart', remoteUrl: poster(`f${m.tmdbId}`) }] }));

export const SERIES = [
    { tvdbId: 81189, title: 'Breaking Bad', year: 2008, overview: 'A chemistry teacher turns to crime.', network: 'AMC', genres: ['Drama', 'Crime'], certification: '18', seasonCount: 5 },
    { tvdbId: 121361, title: 'Game of Thrones', year: 2011, overview: 'Noble families fight for the Iron Throne.', network: 'HBO', genres: ['Drama', 'Fantasy'], certification: '18', seasonCount: 8 }
].map(({ seasonCount, ...s }) => ({
    ...s,
    images: [{ coverType: 'poster', remoteUrl: poster(`tv${s.tvdbId}`) }],
    seasons: Array.from({ length: seasonCount + 1 }, (_, n) => ({ seasonNumber: n, monitored: false, statistics: { episodeCount: 8, totalEpisodeCount: 8, episodeFileCount: 0 } }))
}));

export function createFakeArr({ apiKey = 'arr-key', languageProfiles = true } = {}) {
    const state = { movies: [], series: [], commands: [], nextId: 1 };
    const server = createServer(async (req, res) => {
        const url = new URL(req.url, 'http://x');
        let body = '';
        for await (const c of req) body += c;
        const json = body ? JSON.parse(body) : null;
        const send = (status, value) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(value === undefined ? '' : JSON.stringify(value));
        };
        const [app, api, v3, ...rest] = url.pathname.split('/').filter(Boolean);
        if (api !== 'api' || v3 !== 'v3') return send(404, { message: 'not found' });
        if (req.headers['x-api-key'] !== apiKey) return send(401, { message: 'Unauthorized' });
        const path = rest.join('/');
        const term = (url.searchParams.get('term') || '').toLowerCase();
        const method = req.method;

        if (path === 'system/status') return send(200, { appName: app === 'radarr' ? 'Radarr' : 'Sonarr', version: app === 'radarr' ? '5.14.0' : '4.0.10' });
        if (path === 'qualityprofile') return send(200, [{ id: 4, name: 'HD-1080p' }, { id: 5, name: 'Ultra-HD' }]);
        if (path === 'rootfolder') return send(200, [{ path: app === 'radarr' ? '/media/movies' : '/media/tv', freeSpace: 5e12 }]);
        if (path === 'queue') return send(200, { records: [] });
        if (path === 'command' && method === 'POST') {
            state.commands.push({ app, ...json });
            return send(201, { id: state.commands.length });
        }

        if (app === 'radarr') {
            const withLibrary = m => ({ ...m, ...(state.movies.find(x => x.tmdbId === m.tmdbId) || {}) });
            if (path === 'movie/lookup') return send(200, MOVIES.filter(m => m.title.toLowerCase().includes(term)).map(withLibrary));
            if (path === 'movie/lookup/tmdb') {
                const movie = MOVIES.find(m => m.tmdbId === Number(url.searchParams.get('tmdbId')));
                return movie ? send(200, withLibrary(movie)) : send(404, { message: 'not found' });
            }
            if (path === 'movie' && method === 'GET') return send(200, state.movies);
            if (path === 'movie' && method === 'POST') {
                const movie = { ...json, id: state.nextId++, hasFile: false };
                state.movies.push(movie);
                return send(201, movie);
            }
            if (rest[0] === 'movie' && rest[1] && method === 'PUT') {
                const i = state.movies.findIndex(m => m.id === Number(rest[1]));
                state.movies[i] = { ...state.movies[i], ...json };
                return send(202, state.movies[i]);
            }
        }

        if (app === 'sonarr') {
            if (path === 'languageprofile') return languageProfiles ? send(200, [{ id: 1, name: 'English' }]) : send(404, { message: 'gone in v4' });
            if (path === 'series/lookup') {
                const tvdb = term.startsWith('tvdb:') ? Number(term.slice(5)) : null;
                return send(200, SERIES.filter(s => (tvdb ? s.tvdbId === tvdb : s.title.toLowerCase().includes(term)))
                    .map(s => ({ ...s, ...(state.series.find(x => x.tvdbId === s.tvdbId) || {}) })));
            }
            if (path === 'series' && method === 'GET') return send(200, state.series);
            if (path === 'series' && method === 'POST') {
                const series = { ...json, id: state.nextId++ };
                state.series.push(series);
                return send(201, series);
            }
            if (rest[0] === 'series' && rest[1]) {
                const i = state.series.findIndex(s => s.id === Number(rest[1]));
                if (i < 0) return send(404, { message: 'not found' });
                if (method === 'GET') return send(200, state.series[i]);
                if (method === 'PUT') {
                    state.series[i] = { ...state.series[i], ...json };
                    return send(202, state.series[i]);
                }
            }
        }
        return send(404, { message: `unhandled ${method} ${url.pathname}` });
    });
    return { server, state };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const port = Number(process.argv[2] || 8989);
    createFakeArr().server.listen(port, '127.0.0.1', () => console.log(`fake Radarr/Sonarr on http://127.0.0.1:${port}/radarr and /sonarr (key arr-key)`));
}
