import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';

import { createApp } from '../src/app.mjs';
import { decrypt, encrypt, hashSecret, verifySecret } from '../src/crypto.mjs';
import { openDatabase } from '../src/db.mjs';
import { createJellyfinClient } from '../src/jellyfin.mjs';

// ── fake Jellyfin ─────────────────────────────────────────────────────────
function createFakeJellyfin() {
    const state = { users: new Map(), auths: [], played: new Map(), nextId: 1 };
    const server = createServer(async (req, res) => {
        const url = new URL(req.url, 'http://x');
        let body = '';
        for await (const c of req) body += c;
        const json = body ? JSON.parse(body) : null;
        const send = (status, value) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(value === undefined ? '' : JSON.stringify(value));
        };
        const admin = req.headers.authorization === 'MediaBrowser Token="test-key"';
        const parts = url.pathname.split('/').filter(Boolean);

        if (url.pathname === '/Users/AuthenticateByName' && req.method === 'POST') {
            const user = [...state.users.values()].find(u => u.Name === json.Username);
            if (!user || user.password !== json.Pw) return send(401, { error: 'bad' });
            state.auths.push({ user: user.Id, header: req.headers.authorization });
            return send(200, { AccessToken: `token-${user.Id}`, ServerId: 'srv', User: { Id: user.Id, Name: user.Name } });
        }
        if (!admin) return send(401, { error: 'no key' });
        if (url.pathname === '/Users/New' && req.method === 'POST') {
            const id = `user${state.nextId++}`;
            state.users.set(id, { Id: id, Name: json.Name, password: json.Password, Policy: { IsHidden: false, IsAdministrator: false, AuthenticationProviderId: 'x' } });
            return send(200, { Id: id, Name: json.Name });
        }
        if (url.pathname === '/Users' && req.method === 'GET') {
            return send(200, [...state.users.values()].map(({ password, ...u }) => u));
        }
        if (url.pathname === '/Items') {
            const items = state.played.get(url.searchParams.get('userId')) || [];
            return send(200, { Items: items });
        }
        if (parts[0] === 'Users' && parts[1]) {
            const user = state.users.get(parts[1]);
            if (!user) return send(404, { error: 'missing' });
            if (parts.length === 2 && req.method === 'GET') {
                const { password, ...u } = user;
                return send(200, u);
            }
            if (parts.length === 2 && req.method === 'DELETE') {
                state.users.delete(user.Id);
                return send(204);
            }
            if (parts[2] === 'Policy') {
                user.Policy = json;
                return send(204);
            }
            if (parts[2] === 'Password') {
                user.password = json.NewPw;
                return send(204);
            }
        }
        return send(404, { error: 'unhandled ' + url.pathname });
    });
    return { server, state };
}

// ── harness ───────────────────────────────────────────────────────────────
let fake;
let jellyfinUrl;
let api;
let apiUrl;
let store;
const key = randomBytes(32);

function listen(server) {
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

/** A tiny client with its own cookie jar. */
function client() {
    let cookie = '';
    return async function call(method, path, body, headers = {}) {
        const res = await fetch(apiUrl + path, {
            method,
            headers: {
                ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
                ...(cookie ? { Cookie: cookie } : {}),
                ...headers
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const setCookie = res.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        const data = await res.json().catch(() => null);
        return { status: res.status, data };
    };
}

const device = { id: 'browser-1', name: 'Chrome', client: 'Jellyfin Web', version: '10.11.11' };

async function createAccount(email, { admin = false, password = 'correct horse' } = {}) {
    const id = store.createAccount({ email, name: email.split('@')[0], passwordHash: await hashSecret(password), isAdmin: admin });
    const call = client();
    const login = await call('POST', '/auth/login', { email, password });
    assert.equal(login.status, 200);
    return { id, call };
}

before(async () => {
    fake = createFakeJellyfin();
    jellyfinUrl = await listen(fake.server);
});

beforeEach(async () => {
    if (api) await new Promise(resolve => api.close(resolve));
    fake.state.users.clear();
    fake.state.auths.length = 0;
    fake.state.played.clear();
    store = openDatabase(':memory:');
    const jellyfin = createJellyfinClient({ url: jellyfinUrl, apiKey: 'test-key' });
    const handle = createApp({ store, jellyfin, key });
    api = createServer((req, res) => handle(req, res, new URL(req.url, 'http://x').pathname));
    apiUrl = await listen(api);
});

after(() => {
    api?.close();
    fake.server.close();
});

// ── tests ─────────────────────────────────────────────────────────────────
describe('crypto', () => {
    it('hashes and verifies secrets', async () => {
        const hash = await hashSecret('1234');
        assert.ok(await verifySecret('1234', hash));
        assert.ok(!(await verifySecret('1235', hash)));
        assert.ok(!(await verifySecret('1234', 'garbage')));
    });

    it('round-trips encrypted secrets and rejects tampering', () => {
        const enc = encrypt('s3cret', key);
        assert.equal(decrypt(enc, key), 's3cret');
        const parts = enc.split('.');
        parts[3] = Buffer.from('tampered').toString('base64url');
        assert.throws(() => decrypt(parts.join('.'), key));
    });
});

describe('sign in', () => {
    it('rejects a wrong password and accepts the right one', async () => {
        store.createAccount({ email: 'a@example.com', name: 'A', passwordHash: await hashSecret('correct horse') });
        const call = client();
        assert.equal((await call('POST', '/auth/login', { email: 'a@example.com', password: 'nope' })).status, 401);
        assert.equal((await call('GET', '/me')).status, 401);
        const ok = await call('POST', '/auth/login', { email: 'A@Example.com', password: 'correct horse' });
        assert.equal(ok.status, 200);
        assert.equal(ok.data.account.email, 'a@example.com');
        assert.equal((await call('GET', '/me')).status, 200);
        await call('POST', '/auth/logout', {});
        assert.equal((await call('GET', '/me')).status, 401);
    });

    it('blocks non-JSON and cross-site writes', async () => {
        const res = await fetch(apiUrl + '/auth/login', { method: 'POST', body: 'email=a' });
        assert.equal(res.status, 415);
        const cross = await fetch(apiUrl + '/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
            body: '{}'
        });
        assert.equal(cross.status, 403);
    });
});

describe('profiles', () => {
    it('creates a hidden Jellyfin user per profile with the maturity ceiling', async () => {
        const { call } = await createAccount('fam@example.com');
        const res = await call('POST', '/profiles', { name: 'Mason', avatar: 'rhino', maturity: 'kids' });
        assert.equal(res.status, 200);
        const user = fake.state.users.get(res.data.profile.jellyfinUserId);
        assert.ok(user.Name.startsWith('hf-'));
        assert.equal(user.Policy.IsHidden, true);
        assert.equal(user.Policy.MaxParentalRating, 10);
        assert.ok(user.Policy.AuthenticationProviderId, 'existing policy fields are kept');
        assert.equal(res.data.profile.locked, false);
        assert.equal(JSON.stringify(res.data).includes(user.password), false, 'password never leaves the service');
    });

    it('enforces unique names and the five-profile limit', async () => {
        const { call } = await createAccount('big@example.com');
        assert.equal((await call('POST', '/profiles', { name: 'One' })).status, 200);
        assert.equal((await call('POST', '/profiles', { name: 'one' })).status, 400);
        for (const name of ['Two', 'Three', 'Four', 'Five']) assert.equal((await call('POST', '/profiles', { name })).status, 200);
        const sixth = await call('POST', '/profiles', { name: 'Six' });
        assert.equal(sixth.status, 400);
        assert.equal(fake.state.users.size, 5, 'no orphan Jellyfin users');
    });

    it('signs a profile in for the caller\'s device', async () => {
        const { call } = await createAccount('dev@example.com');
        const { data } = await call('POST', '/profiles', { name: 'Hayden' });
        const res = await call('POST', `/profiles/${data.profile.id}/session`, { device });
        assert.equal(res.status, 200);
        assert.equal(res.data.authentication.AccessToken, `token-${data.profile.jellyfinUserId}`);
        assert.match(fake.state.auths[0].header, /DeviceId="browser-1"/);
    });

    it('requires the PIN for a locked profile', async () => {
        const { call } = await createAccount('pin@example.com');
        const { data } = await call('POST', '/profiles', { name: 'Dad', pin: '4321' });
        assert.equal(data.profile.locked, true);
        assert.equal((await call('POST', `/profiles/${data.profile.id}/session`, { device })).status, 403);
        assert.equal((await call('POST', `/profiles/${data.profile.id}/session`, { device, pin: '0000' })).status, 403);
        assert.equal((await call('POST', `/profiles/${data.profile.id}/session`, { device, pin: '4321' })).status, 200);
        assert.equal((await call('PATCH', `/profiles/${data.profile.id}`, { name: 'Papa' })).status, 403);
        assert.equal((await call('PATCH', `/profiles/${data.profile.id}`, { name: 'Papa', currentPin: '4321' })).status, 200);
    });

    it('recovers when the Jellyfin password was changed elsewhere', async () => {
        const { call } = await createAccount('drift@example.com');
        const { data } = await call('POST', '/profiles', { name: 'Alana' });
        fake.state.users.get(data.profile.jellyfinUserId).password = 'changed-by-someone';
        const res = await call('POST', `/profiles/${data.profile.id}/session`, { device });
        assert.equal(res.status, 200);
    });

    it('keeps profiles private to their account', async () => {
        const a = await createAccount('a@example.com');
        const b = await createAccount('b@example.com');
        const { data } = await a.call('POST', '/profiles', { name: 'Secret' });
        const id = data.profile.id;
        assert.equal((await b.call('POST', `/profiles/${id}/session`, { device })).status, 404);
        assert.equal((await b.call('PATCH', `/profiles/${id}`, { name: 'Mine' })).status, 404);
        assert.equal((await b.call('DELETE', `/profiles/${id}`, {})).status, 404);
        assert.deepEqual((await b.call('GET', '/me')).data.profiles, []);
    });

    it('deletes the Jellyfin user with the profile but never the last profile', async () => {
        const { call } = await createAccount('del@example.com');
        const first = (await call('POST', '/profiles', { name: 'First' })).data.profile;
        const second = (await call('POST', '/profiles', { name: 'Second' })).data.profile;
        assert.equal((await call('DELETE', `/profiles/${second.id}`, {})).status, 200);
        assert.equal(fake.state.users.has(second.jellyfinUserId), false);
        assert.equal((await call('DELETE', `/profiles/${first.id}`, {})).status, 400);
    });
});

describe('invites and admin', () => {
    it('lets an admin invite someone who then signs straight in', async () => {
        const admin = await createAccount('owner@example.com', { admin: true });
        const made = await admin.call('POST', '/admin/invites', { note: 'Gran', baseUrl: 'https://tv.example.com/web/index.html' });
        assert.equal(made.status, 200);
        assert.match(made.data.invite.url, /^https:\/\/tv\.example\.com\/web\/index\.html#\/homefin\/join\?code=/);
        const code = made.data.invite.code;

        const guest = client();
        assert.equal((await guest('GET', `/invites/${code}`)).data.valid, true);
        const joined = await guest('POST', `/invites/${code}/accept`, { name: 'Gran', email: 'gran@example.com', password: 'knitting123' });
        assert.equal(joined.status, 200);
        assert.equal(joined.data.profiles.length, 1);
        assert.equal((await guest('GET', '/me')).status, 200);

        const again = client();
        assert.equal((await again('POST', `/invites/${code}/accept`, { name: 'X', email: 'x@example.com', password: 'whatever1' })).status, 410);
    });

    it('hides admin routes from everyone else', async () => {
        const user = await createAccount('user@example.com');
        assert.equal((await user.call('GET', '/admin/accounts')).status, 404);
        assert.equal((await user.call('POST', '/admin/invites', {})).status, 404);
    });

    it('creates accounts and adopts existing non-admin Jellyfin users', async () => {
        const admin = await createAccount('owner@example.com', { admin: true });
        const created = await admin.call('POST', '/admin/accounts', { name: 'Mum', email: 'mum@example.com', password: 'flowers123' });
        assert.equal(created.status, 200);
        assert.equal(created.data.account.profiles.length, 1);

        fake.state.users.set('legacy', { Id: 'legacy', Name: 'hayden', password: 'old', Policy: { IsAdministrator: false } });
        fake.state.users.set('boss', { Id: 'boss', Name: 'boss', password: 'old', Policy: { IsAdministrator: true } });
        const list = await admin.call('GET', '/admin/jellyfin-users');
        assert.deepEqual(list.data.users.map(u => u.id).sort(), ['boss', 'legacy']);

        assert.equal((await admin.call('POST', '/admin/adopt', { accountId: created.data.account.id, jellyfinUserId: 'boss' })).status, 400);
        const adopted = await admin.call('POST', '/admin/adopt', { accountId: created.data.account.id, jellyfinUserId: 'legacy', name: 'Hayden' });
        assert.equal(adopted.status, 200);
        assert.notEqual(fake.state.users.get('legacy').password, 'old');
        assert.equal(fake.state.users.get('legacy').Policy.IsHidden, true);
    });
});

describe('trending', () => {
    it('ranks titles by distinct viewers in the last week', async () => {
        const { call } = await createAccount('t@example.com');
        const p1 = (await call('POST', '/profiles', { name: 'One' })).data.profile;
        const p2 = (await call('POST', '/profiles', { name: 'Two' })).data.profile;
        const now = new Date().toISOString();
        const old = new Date(Date.now() - 30 * 86400000).toISOString();
        fake.state.played.set(p1.jellyfinUserId, [
            { Id: 'e1', Type: 'Episode', SeriesId: 'showA', UserData: { LastPlayedDate: now } },
            { Id: 'e2', Type: 'Episode', SeriesId: 'showA', UserData: { LastPlayedDate: now } },
            { Id: 'm1', Type: 'Movie', UserData: { LastPlayedDate: now } },
            { Id: 'e9', Type: 'Episode', SeriesId: 'showOld', UserData: { LastPlayedDate: old } }
        ]);
        fake.state.played.set(p2.jellyfinUserId, [
            { Id: 'e3', Type: 'Episode', SeriesId: 'showB', UserData: { LastPlayedDate: now } },
            { Id: 'e4', Type: 'Episode', SeriesId: 'showA', UserData: { LastPlayedDate: now } }
        ]);
        const res = await call('GET', '/trending');
        assert.equal(res.status, 200);
        assert.deepEqual(res.data.series.map(s => s.id), ['showA', 'showB']);
        assert.equal(res.data.series[0].viewers, 2);
        assert.deepEqual(res.data.movies.map(m => m.id), ['m1']);
    });
});
