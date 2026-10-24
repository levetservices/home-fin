// Small HTTP helpers: JSON bodies, cookies, errors, rate limits, a tiny router.

export class HttpError extends Error {
    constructor(status, message, code) {
        super(message);
        this.status = status;
        this.code = code || undefined;
    }
}

export const badRequest = (message, code) => new HttpError(400, message, code);
export const notFound = (message = 'Not found') => new HttpError(404, message, 'not_found');
/** Signed in, but not as an admin. A 403 (not 404) so the web client can tell this from a service too old to have the route. */
export const notAdmin = () => new HttpError(403, 'This needs an administrator: a Jellyfin administrator or a Home Fin admin account', 'not_admin');

const MAX_BODY = 64 * 1024;

export async function readJson(req) {
    const type = req.headers['content-type'] || '';
    if (!type.includes('application/json')) throw new HttpError(415, 'Expected application/json');
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) throw new HttpError(413, 'Body too large');
        chunks.push(chunk);
    }
    if (!size) return {};
    try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        return value && typeof value === 'object' ? value : {};
    } catch {
        throw badRequest('Invalid JSON');
    }
}

export function sendJson(res, status, body, headers = {}) {
    const payload = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...headers
    });
    res.end(payload);
}

export function parseCookies(header = '') {
    const out = {};
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const key = part.slice(0, i).trim();
        if (key) out[key] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}

export function cookie(name, value, { maxAge, secure, path = '/' } = {}) {
    let out = `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax`;
    if (maxAge !== undefined) out += `; Max-Age=${Math.floor(maxAge)}`;
    if (secure) out += '; Secure';
    return out;
}

/**
 * The visitor's address. Behind a tunnel or reverse proxy every request arrives from the
 * proxy, so with `trustProxy` the last X-Forwarded-For hop is used: the address the proxy
 * itself added (Cloudflare and nginx both append the visitor), which a visitor can't forge.
 * Only turn it on when the service can't be reached except through that proxy.
 */
export function clientIp(req, trustProxy = false) {
    const socketIp = req.socket?.remoteAddress || 'unknown';
    if (!trustProxy) return socketIp;
    const hops = String(req.headers['x-forwarded-for'] || '').split(',').map(h => h.trim()).filter(Boolean);
    return hops.at(-1) || socketIp;
}

/** Fixed-window rate limiter kept in memory. */
export function createRateLimiter({ limit, windowMs }) {
    const hits = new Map();
    return {
        /** Throws 429 when `key` has exceeded the limit. */
        check(key) {
            const now = Date.now();
            let entry = hits.get(key);
            if (!entry || entry.reset <= now) {
                entry = { count: 0, reset: now + windowMs };
                hits.set(key, entry);
            }
            entry.count += 1;
            if (hits.size > 10000) {
                for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
            }
            if (entry.count > limit) {
                throw new HttpError(429, 'Too many attempts. Try again in a few minutes.', 'rate_limited');
            }
        },
        reset(key) {
            hits.delete(key);
        }
    };
}

/** Routes like `/profiles/:id/session`. Returns { handler, params } or null. */
export function createRouter() {
    const routes = [];
    return {
        add(method, pattern, handler) {
            const names = [];
            const regex = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, name) => {
                names.push(name);
                return '([^/]+)';
            }) + '/?$');
            routes.push({ method, regex, names, handler });
        },
        match(method, path) {
            let pathMatched = false;
            for (const route of routes) {
                const m = route.regex.exec(path);
                if (!m) continue;
                pathMatched = true;
                if (route.method !== method) continue;
                const params = {};
                route.names.forEach((name, i) => {
                    params[name] = decodeURIComponent(m[i + 1]);
                });
                return { handler: route.handler, params };
            }
            return pathMatched ? { methodNotAllowed: true } : null;
        }
    };
}
