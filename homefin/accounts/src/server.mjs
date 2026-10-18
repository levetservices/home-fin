// Home Fin accounts service entry point.
//
// Serves the accounts API under API_PATH and, when PROXY_JELLYFIN=true, acts as
// the front door for Jellyfin: every other request (pages, API, streams and
// websockets) is passed through unchanged.
import { request as httpRequest, createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

import { createApp } from './app.mjs';
import { hashSecret, parseKey } from './crypto.mjs';
import { openDatabase } from './db.mjs';
import { sendJson } from './http.mjs';
import { createJellyfinClient } from './jellyfin.mjs';

const env = process.env;
const config = {
    port: Number(env.PORT || 8097),
    host: env.HOST || '0.0.0.0',
    apiPath: (env.API_PATH || '/homefin-api').replace(/\/+$/, ''),
    jellyfinUrl: env.JELLYFIN_URL || 'http://127.0.0.1:8096',
    apiKey: env.JELLYFIN_API_KEY,
    secret: env.HOMEFIN_SECRET,
    dbFile: env.HOMEFIN_DB || './data/homefin.db',
    proxy: env.PROXY_JELLYFIN === 'true',
    // Behind Cloudflare Tunnel / a reverse proxy: take the visitor's address from its headers.
    trustProxy: env.TRUST_PROXY === 'true',
    cookieSecure: env.HOMEFIN_COOKIE_SECURE ? env.HOMEFIN_COOKIE_SECURE === 'true' : String(env.HOMEFIN_PUBLIC_URL || '').startsWith('https://'),
    serverName: env.HOMEFIN_SERVER_NAME || 'Home Fin',
    adminEmail: env.HOMEFIN_ADMIN_EMAIL,
    adminPassword: env.HOMEFIN_ADMIN_PASSWORD
};

const key = parseKey(config.secret);
if (!config.apiKey) throw new Error('JELLYFIN_API_KEY is required (Jellyfin Dashboard → API Keys)');

const store = openDatabase(config.dbFile);
const jellyfin = createJellyfinClient({ url: config.jellyfinUrl, apiKey: config.apiKey });
const handleApi = createApp({ store, jellyfin, key, options: config });

// First start: create the owner's admin account from env if there are no accounts yet.
if (store.countAccounts() === 0 && config.adminEmail && config.adminPassword) {
    store.createAccount({ email: config.adminEmail, name: 'Admin', passwordHash: await hashSecret(config.adminPassword), isAdmin: true });
    console.log(`[homefin-accounts] created admin account ${config.adminEmail}`);
}
setInterval(() => store.purgeExpiredSessions(), 6 * 3600 * 1000).unref();

// ── Jellyfin pass-through ────────────────────────────────────────────────
const target = new URL(config.jellyfinUrl);
const isHttps = target.protocol === 'https:';
const targetPort = Number(target.port || (isHttps ? 443 : 80));

/**
 * Headers for Jellyfin. Forwarding headers from the visitor are only passed on when they came
 * through a trusted proxy (TRUST_PROXY); otherwise anyone could claim a LAN address and get
 * Jellyfin's local-network treatment.
 */
function forwardedHeaders(req) {
    const headers = { ...req.headers, host: target.host };
    const socketIp = req.socket.remoteAddress;
    const trusted = config.trustProxy;
    const prior = trusted ? req.headers['x-forwarded-for'] : '';
    headers['x-forwarded-for'] = prior ? `${prior}, ${socketIp}` : socketIp;
    headers['x-forwarded-proto'] = (trusted && req.headers['x-forwarded-proto']) || (req.socket.encrypted ? 'https' : 'http');
    headers['x-forwarded-host'] = (trusted && req.headers['x-forwarded-host']) || req.headers.host;
    return headers;
}

function proxyRequest(req, res) {
    const upstream = (isHttps ? httpsRequest : httpRequest)({
        hostname: target.hostname,
        port: targetPort,
        method: req.method,
        path: req.url,
        headers: forwardedHeaders(req)
    }, (upRes) => {
        res.writeHead(upRes.statusCode, upRes.statusMessage, upRes.headers);
        upRes.pipe(res);
    });
    upstream.on('error', (err) => {
        console.error('[homefin-accounts] proxy error', err.message);
        if (!res.headersSent) sendJson(res, 502, { error: 'Jellyfin is unreachable' });
        else res.destroy();
    });
    req.pipe(upstream);
}

function proxyUpgrade(req, socket, head) {
    const upstream = isHttps ?
        tlsConnect({ host: target.hostname, port: targetPort, servername: target.hostname }) :
        netConnect({ host: target.hostname, port: targetPort });
    upstream.on(isHttps ? 'secureConnect' : 'connect', () => {
        const headers = forwardedHeaders(req);
        let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
        for (const [name, value] of Object.entries(headers)) {
            for (const v of Array.isArray(value) ? value : [value]) raw += `${name}: ${v}\r\n`;
        }
        upstream.write(raw + '\r\n');
        if (head?.length) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
    });
    const close = () => {
        socket.destroy();
        upstream.destroy();
    };
    upstream.on('error', close);
    socket.on('error', close);
}

// ── server ───────────────────────────────────────────────────────────────
const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === config.apiPath || url.pathname.startsWith(config.apiPath + '/')) {
        const path = url.pathname.slice(config.apiPath.length) || '/';
        if (path === '/health') return sendJson(res, 200, { ok: true });
        return handleApi(req, res, path);
    }
    if (config.proxy) return proxyRequest(req, res);
    return sendJson(res, 404, { error: 'Not found' });
});

if (config.proxy) server.on('upgrade', proxyUpgrade);
server.requestTimeout = 0; // long-running media streams when proxying
server.listen(config.port, config.host, () => {
    console.log(`[homefin-accounts] listening on ${config.host}:${config.port}${config.apiPath}` +
        (config.proxy ? ` and proxying everything else to ${config.jellyfinUrl}` : ''));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
