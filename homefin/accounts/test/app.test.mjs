import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';

import { createApp } from '../src/app.mjs';
import { decrypt, encrypt, hashSecret, verifySecret } from '../src/crypto.mjs';
import { openDatabase } from '../src/db.mjs';
import { clientIp } from '../src/http.mjs';
import { createJellyfinClient } from '../src/jellyfin.mjs';

import { createFakeArr } from './fake-arr.mjs';

// ── fake Jellyfin ─────────────────────────────────────────────────────────
function createFakeJellyfin() {
    const state = { users: new Map(), auths: [], logouts: [], played: new Map(), nextId: 1 };
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
        if (url.pathname === '/Users/Me') {
            const token = /Token="([^"]*)"/.exec(req.headers.authorization || '')?.[1] || '';
            const user = state.users.get(token.replace(/^token-/, ''));
            if (!user) return send(401, { error: 'bad token' });
            const { password, ...u } = user;
            return send(200, u);
        }
        if (url.pathname === '/Sessions/Logout' && req.method === 'POST') {
            state.logouts.push(req.headers.authorization);
            return send(204);
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
let arr;
let arrUrl;
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
    arr = createFakeArr();
    arrUrl = await listen(arr.server);
});

beforeEach(async () => {
    if (api) await new Promise(resolve => api.close(resolve));
    fake.state.users.clear();
    fake.state.auths.length = 0;
    fake.state.played.clear();
    store = openDatabase(':memory:');
    const jellyfin = createJellyfinClient({ url: jellyfinUrl, apiKey: 'test-key' });
    // As deployed behind a tunnel: visitor addresses come from X-Forwarded-For.
    const handle = createApp({ store, jellyfin, key, options: { trustProxy: true, libraryTtlMs: 0 } });
    api = createServer((req, res) => handle(req, res, new URL(req.url, 'http://x').pathname));
    apiUrl = await listen(api);
});

after(() => {
    api?.close();
    fake.server.close();
    arr.server.close();
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

describe('visitor addresses and sign-in limits', () => {
    it('only believes X-Forwarded-For when told the proxy is trusted', () => {
        const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9', 'cf-connecting-ip': '7.7.7.7' } };
        assert.equal(clientIp(req), '127.0.0.1');
        // The proxy appends the visitor last; anything earlier (or a CF header) could be forged.
        assert.equal(clientIp(req, true), '203.0.113.9');
        assert.equal(clientIp({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }, true), '127.0.0.1');
    });

    it('stops one visitor guessing without locking everyone else out', async () => {
        store.createAccount({ email: 'owner@example.com', name: 'Owner', passwordHash: await hashSecret('correct horse') });
        const attacker = client();
        const from = ip => ({ 'X-Forwarded-For': ip });
        for (let i = 0; i < 10; i++) {
            assert.equal((await attacker('POST', '/auth/login', { email: 'owner@example.com', password: 'wrong guess' }, from('203.0.113.9'))).status, 401);
        }
        assert.equal((await attacker('POST', '/auth/login', { email: 'owner@example.com', password: 'correct horse' }, from('203.0.113.9'))).status, 429);
        // The owner, somewhere else, still gets in.
        const owner = client();
        assert.equal((await owner('POST', '/auth/login', { email: 'owner@example.com', password: 'correct horse' }, from('198.51.100.7'))).status, 200);
    });

    it('caps how many emails one visitor can try', async () => {
        const call = client();
        for (let i = 0; i < 30; i++) {
            assert.equal((await call('POST', '/auth/login', { email: `nobody${i}@example.com`, password: 'x' }, { 'X-Forwarded-For': '203.0.113.50' })).status, 401);
        }
        assert.equal((await call('POST', '/auth/login', { email: 'another@example.com', password: 'x' }, { 'X-Forwarded-For': '203.0.113.50' })).status, 429);
    });
});

describe('cutting off access', () => {
    async function accountWithProfiles() {
        const admin = await createAccount('admin@example.com', { admin: true });
        const member = await createAccount('member@example.com');
        await member.call('POST', '/profiles', { name: 'One' });
        await member.call('POST', '/profiles', { name: 'Two' });
        const users = () => [...fake.state.users.values()];
        return { admin, member, users };
    }

    it('disabling an account disables its profiles in Jellyfin and signs their devices out', async () => {
        const { admin, member, users } = await accountWithProfiles();
        const before = users().map(u => u.password);
        assert.equal((await admin.call('PATCH', `/admin/accounts/${member.id}`, { disabled: true })).status, 200);
        assert.ok(users().every(u => u.Policy.IsDisabled === true), 'Jellyfin users disabled');
        assert.ok(users().every((u, i) => u.password !== before[i]), 'Jellyfin passwords rotated (drops their tokens)');
        assert.equal((await member.call('GET', '/me')).status, 401);

        assert.equal((await admin.call('PATCH', `/admin/accounts/${member.id}`, { disabled: false })).status, 200);
        assert.ok(users().every(u => u.Policy.IsDisabled === false), 'Jellyfin users enabled again');
        // Signing in again still works: the service knows the new passwords.
        const again = client();
        assert.equal((await again('POST', '/auth/login', { email: 'member@example.com', password: 'correct horse' })).status, 200);
        const profile = (await again('GET', '/me')).data.profiles[0];
        assert.equal((await again('POST', `/profiles/${profile.id}/session`, { device })).status, 200);
    });

    it('a password change, by the member or an admin, signs every profile device out', async () => {
        const { admin, member, users } = await accountWithProfiles();
        let before = users().map(u => u.password);
        const changed = await member.call('PATCH', '/me', { newPassword: 'new password 1', currentPassword: 'correct horse' });
        assert.equal(changed.status, 200);
        assert.ok(users().every((u, i) => u.password !== before[i]));
        const profile = changed.data.profiles[0];
        assert.equal((await member.call('POST', `/profiles/${profile.id}/session`, { device })).status, 200);

        before = users().map(u => u.password);
        assert.equal((await admin.call('PATCH', `/admin/accounts/${member.id}`, { password: 'reset password 2' })).status, 200);
        assert.ok(users().every((u, i) => u.password !== before[i]));
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

    it('lets the account password stand in for a forgotten PIN', async () => {
        const { call } = await createAccount('forgot@example.com');
        await call('POST', '/profiles', { name: 'Kid' });
        const { data } = await call('POST', '/profiles', { name: 'Dad', pin: '4321' });
        const id = data.profile.id;
        assert.equal((await call('PATCH', `/profiles/${id}`, { pin: null, accountPassword: 'wrong-password' })).status, 403);
        const reset = await call('PATCH', `/profiles/${id}`, { pin: '1111', accountPassword: 'correct horse' });
        assert.equal(reset.status, 200);
        assert.equal((await call('POST', `/profiles/${id}/session`, { device, pin: '1111' })).status, 200);
        assert.equal((await call('DELETE', `/profiles/${id}`, { accountPassword: 'wrong-password' })).status, 403);
        assert.equal((await call('DELETE', `/profiles/${id}`, { accountPassword: 'correct horse' })).status, 200);
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

    it('lets a Jellyfin administrator run People with their own Jellyfin login', async () => {
        await createAccount('member@example.com');
        fake.state.users.set('boss', { Id: 'boss', Name: 'boss', password: 'x', Policy: { IsAdministrator: true } });
        fake.state.users.set('pleb', { Id: 'pleb', Name: 'pleb', password: 'x', Policy: { IsAdministrator: false } });
        const asBoss = (method, path, body) => client()(method, path, body, { 'X-Jellyfin-Token': 'token-boss' });
        assert.deepEqual((await asBoss('GET', '/admin/me')).data, { name: 'boss', accountId: null });
        assert.deepEqual((await asBoss('GET', '/admin/accounts')).data.accounts.map(a => a.email), ['member@example.com']);
        const invite = await asBoss('POST', '/admin/invites', { baseUrl: 'https://tv.example.com/web/' });
        assert.equal(invite.status, 200);
        const member = store.accountRowByEmail('member@example.com');
        assert.equal((await asBoss('PATCH', `/admin/accounts/${member.id}`, { requestPolicy: 'auto' })).status, 200);

        assert.equal((await client()('GET', '/admin/accounts', undefined, { 'X-Jellyfin-Token': 'token-pleb' })).status, 403);
        assert.equal((await client()('GET', '/admin/accounts')).status, 401);
    });

    it('hides admin routes from everyone else', async () => {
        const user = await createAccount('user@example.com');
        assert.equal((await user.call('GET', '/admin/accounts')).status, 403);
        assert.equal((await user.call('POST', '/admin/invites', {})).status, 403);
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

describe('moving over from a Jellyfin login', () => {
    function jellyfinUser(name, password, { admin = false } = {}) {
        const id = `old-${name}`;
        fake.state.users.set(id, { Id: id, Name: name, password, Policy: { IsHidden: false, IsAdministrator: admin, AuthenticationProviderId: 'x' } });
        return id;
    }

    it('turns the user into a profile of a new account, keeping its password and history', async () => {
        const id = jellyfinUser('alana', 'alana-long-pass');
        const call = client();
        const check = await call('POST', '/auth/move/check', { username: 'alana', password: 'alana-long-pass' });
        assert.deepEqual(check.data, { name: 'alana', keepsPassword: true });

        const moved = await call('POST', '/auth/move', { username: 'alana', password: 'alana-long-pass', email: 'Alana@Example.com' });
        assert.equal(moved.status, 200);
        assert.equal(moved.data.account.email, 'alana@example.com');
        assert.equal(moved.data.profiles.length, 1);
        assert.equal(moved.data.profiles[0].name, 'alana');
        const user = fake.state.users.get(id);
        assert.equal(user.password, 'alana-long-pass', 'TVs and phones stay signed in');
        assert.equal(user.Policy.IsHidden, true);
        assert.ok(fake.state.logouts.includes(`MediaBrowser Token="token-${id}"`), 'the check session is closed');
        assert.equal(decrypt(store.profileRowByJellyfinUser(id).jellyfin_password_enc, key), 'alana-long-pass');

        // Signed straight in, and the same password works for the account.
        assert.equal((await call('GET', '/me')).status, 200);
        assert.equal((await client()('POST', '/auth/login', { email: 'alana@example.com', password: 'alana-long-pass' })).status, 200);

        const again = await client()('POST', '/auth/move', { username: 'alana', password: 'alana-long-pass', email: 'other@example.com' });
        assert.equal(again.status, 409);
    });

    it('replaces a short Jellyfin password and asks for a proper account password', async () => {
        const id = jellyfinUser('kid', '1234');
        const call = client();
        assert.equal((await call('POST', '/auth/move/check', { username: 'kid', password: '1234' })).data.keepsPassword, false);
        assert.equal((await call('POST', '/auth/move', { username: 'kid', password: '1234', email: 'kid@example.com' })).status, 400);
        assert.equal(store.accountRowByEmail('kid@example.com'), undefined, 'nothing half-made');

        const moved = await call('POST', '/auth/move', { username: 'kid', password: '1234', email: 'kid@example.com', newPassword: 'a-better-password' });
        assert.equal(moved.status, 200);
        assert.notEqual(fake.state.users.get(id).password, '1234');
        assert.equal(decrypt(store.profileRowByJellyfinUser(id).jellyfin_password_enc, key), fake.state.users.get(id).password);
    });

    it('joins an existing household account with that account\'s password', async () => {
        const { id: accountId } = await createAccount('home@example.com');
        jellyfinUser('mum', 'mum-long-pass');
        const call = client();
        const wrong = await call('POST', '/auth/move', { username: 'mum', password: 'mum-long-pass', mode: 'join', email: 'home@example.com', accountPassword: 'nope' });
        assert.equal(wrong.status, 401);
        const joined = await call('POST', '/auth/move', { username: 'mum', password: 'mum-long-pass', mode: 'join', email: 'home@example.com', accountPassword: 'correct horse', profileName: 'Mum' });
        assert.equal(joined.status, 200);
        assert.equal(joined.data.account.id, accountId);
        assert.deepEqual(joined.data.profiles.map(p => p.name), ['Mum']);
    });

    it('turns away wrong passwords and administrators', async () => {
        jellyfinUser('boss', 'boss-long-pass', { admin: true });
        jellyfinUser('dad', 'dad-long-pass');
        const call = client();
        assert.equal((await call('POST', '/auth/move/check', { username: 'dad', password: 'wrong' })).status, 401);
        const admin = await call('POST', '/auth/move', { username: 'boss', password: 'boss-long-pass', email: 'boss@example.com' });
        assert.equal(admin.status, 403);
        assert.equal(fake.state.users.get('old-boss').Policy.IsHidden, false);
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

describe('requests (Sonarr / Radarr)', () => {
    beforeEach(() => {
        arr.state.movies.length = 0;
        arr.state.series.length = 0;
        arr.state.commands.length = 0;
    });

    async function setUp() {
        const admin = await createAccount('owner@example.com', { admin: true });
        assert.equal((await admin.call('PUT', '/admin/integrations/radarr', { url: `${arrUrl}/radarr`, apiKey: 'arr-key' })).status, 200);
        assert.equal((await admin.call('PUT', '/admin/integrations/sonarr', { url: `${arrUrl}/sonarr`, apiKey: 'arr-key', qualityProfileId: 5 })).status, 200);
        const member = await createAccount('member@example.com');
        const profile = (await member.call('POST', '/profiles', { name: 'Sam' })).data.profile;
        const token = (await member.call('POST', `/profiles/${profile.id}/session`, { device })).data.authentication.AccessToken;
        // The web client sends the viewer's Jellyfin token: that's how a profile is recognised.
        const asSam = (method, path, body) => client()(method, path, body, { 'X-Jellyfin-Token': token });
        return { admin, member, asSam };
    }

    it('checks Sonarr / Radarr before saving, never returns the key, and is admin-only', async () => {
        const admin = await createAccount('owner@example.com', { admin: true });
        const bad = await admin.call('POST', '/admin/integrations/radarr/test', { url: `${arrUrl}/radarr`, apiKey: 'wrong' });
        assert.equal(bad.status, 400);
        assert.match(bad.data.error, /API key/);
        const wrongApp = await admin.call('POST', '/admin/integrations/radarr/test', { url: `${arrUrl}/sonarr`, apiKey: 'arr-key' });
        assert.match(wrongApp.data.error, /Sonarr, not Radarr/);
        const ok = await admin.call('POST', '/admin/integrations/sonarr/test', { url: `${arrUrl}/sonarr`, apiKey: 'arr-key' });
        assert.deepEqual(ok.data.qualityProfiles.map(p => p.name), ['HD-1080p', 'Ultra-HD']);
        assert.deepEqual(ok.data.languageProfiles, [{ id: 1, name: 'English' }]);
        await admin.call('PUT', '/admin/integrations/radarr', { url: `${arrUrl}/radarr/`, apiKey: 'arr-key' });
        const saved = await admin.call('GET', '/admin/integrations');
        assert.deepEqual(saved.data.radarr, { url: `${arrUrl}/radarr`, hasKey: true, qualityProfileId: 4, rootFolderPath: '/media/movies', languageProfileId: null });
        assert.equal(JSON.stringify(saved.data).includes('arr-key'), false);
        assert.equal(saved.data.sonarr, null);

        const { call } = await createAccount('member@example.com');
        assert.equal((await call('GET', '/admin/integrations')).status, 403);
        assert.equal((await call('PUT', '/admin/integrations/radarr', { url: `${arrUrl}/radarr`, apiKey: 'arr-key' })).status, 403);
    });

    it('waits for approval, then adds the film to Radarr and tracks it to available', async () => {
        const { admin, asSam } = await setUp();
        const search = await asSam('GET', '/requests/search?q=matrix');
        assert.deepEqual(search.data.results.map(r => [r.title, r.state]), [['The Matrix', null], ['The Matrix Reloaded', null]]);
        assert.equal(search.data.results[0].poster, 'https://image.tmdb.org/t/p/w500/603.jpg');

        const asked = await asSam('POST', '/requests', { type: 'movie', id: 603 });
        assert.equal(asked.status, 200);
        assert.equal(asked.data.request.status, 'pending');
        assert.equal(asked.data.request.requestedBy, 'Sam');
        assert.equal(arr.state.movies.length, 0, 'nothing sent before approval');
        const again = await asSam('POST', '/requests', { type: 'movie', id: 603 });
        assert.equal(again.status, 409);
        assert.match(again.data.error, /Sam already asked/);

        const queue = await admin.call('GET', '/admin/requests');
        assert.deepEqual(queue.data.pending.map(r => r.title), ['The Matrix']);
        const approved = await admin.call('POST', `/admin/requests/${asked.data.request.id}/approve`);
        assert.equal(approved.status, 200);
        assert.equal(approved.data.request.state, 'processing');
        const [movie] = arr.state.movies;
        assert.equal(movie.tmdbId, 603);
        assert.equal(movie.qualityProfileId, 4);
        assert.equal(movie.rootFolderPath, '/media/movies');
        assert.deepEqual(movie.addOptions, { searchForMovie: true });

        movie.hasFile = true;
        const mine = await asSam('GET', '/requests');
        assert.equal(mine.data.mine[0].status, 'available');
        assert.equal(store.requestRow(asked.data.request.id).status, 'available', 'remembered');
        const blocked = await asSam('POST', '/requests', { type: 'movie', id: 603 });
        assert.equal(blocked.status, 409);
        assert.match(blocked.data.error, /already in the library/);
    });

    it('sends trusted accounts straight through, with only the seasons asked for', async () => {
        const { admin, member, asSam } = await setUp();
        await admin.call('PATCH', `/admin/accounts/${member.id}`, { requestPolicy: 'auto' });
        const asked = await asSam('POST', '/requests', { type: 'tv', id: 81189, seasons: [2, 1, 9] });
        assert.equal(asked.status, 200);
        assert.equal(asked.data.request.status, 'approved');
        assert.deepEqual(asked.data.request.seasons, [1, 2]);
        const [series] = arr.state.series;
        assert.equal(series.qualityProfileId, 5);
        assert.equal(series.languageProfileId, 1);
        assert.deepEqual(series.seasons.filter(s => s.monitored).map(s => s.seasonNumber), [1, 2]);
        assert.equal(series.addOptions.searchForMissingEpisodes, true);

        // Asking for another season later adds it to the same show and searches for it.
        const more = await asSam('POST', '/requests', { type: 'tv', id: 81189, seasons: [3] });
        assert.equal(more.status, 200);
        assert.deepEqual(arr.state.series[0].seasons.filter(s => s.monitored).map(s => s.seasonNumber), [1, 2, 3]);
        assert.deepEqual(arr.state.commands.at(-1), { app: 'sonarr', name: 'SeasonSearch', seriesId: series.id, seasonNumber: 3 });
    });

    it('lets admins switch requests off per account and decline with a reason', async () => {
        const { admin, member, asSam } = await setUp();
        const asked = await asSam('POST', '/requests', { type: 'movie', id: 27205 });
        const declined = await admin.call('POST', `/admin/requests/${asked.data.request.id}/decline`, { reason: 'Already on Netflix' });
        assert.equal(declined.data.request.status, 'declined');
        assert.equal((await asSam('GET', '/requests')).data.mine[0].reason, 'Already on Netflix');

        await admin.call('PATCH', `/admin/accounts/${member.id}`, { requestPolicy: 'off' });
        assert.equal((await asSam('GET', '/requests/config')).data.policy, 'off');
        assert.equal((await asSam('POST', '/requests', { type: 'movie', id: 604 })).status, 403);
        assert.equal((await admin.call('PATCH', `/admin/accounts/${member.id}`, { requestPolicy: 'sometimes' })).status, 400);
    });

    it('treats a Jellyfin administrator as an admin, and rejects unknown tokens', async () => {
        await setUp();
        fake.state.users.set('boss', { Id: 'boss', Name: 'boss', password: 'x', Policy: { IsAdministrator: true } });
        const asBoss = (method, path, body) => client()(method, path, body, { 'X-Jellyfin-Token': 'token-boss' });
        const config = await asBoss('GET', '/requests/config');
        assert.deepEqual(config.data, { enabled: true, movies: true, tv: true, policy: 'auto', isAdmin: true });
        assert.equal((await asBoss('POST', '/requests', { type: 'movie', id: 604 })).data.request.status, 'approved');
        assert.equal((await asBoss('GET', '/admin/requests')).status, 200);
        assert.equal((await client()('GET', '/requests/config', undefined, { 'X-Jellyfin-Token': 'token-nobody' })).status, 401);
    });

    it('shows quick links to admins, and only the shared ones to everyone else', async () => {
        const { admin, asSam } = await setUp();
        const saved = await admin.call('PUT', '/admin/links', { links: [
            { name: 'Sonarr', url: 'http://192.168.55.40:8989', icon: 'tv' },
            { name: 'Status', url: 'https://status.example.com', icon: 'monitor_heart', audience: 'everyone' }
        ] });
        assert.equal(saved.status, 200);
        assert.deepEqual((await admin.call('GET', '/links')).data.links.map(l => l.name), ['Sonarr', 'Status']);
        assert.deepEqual((await asSam('GET', '/links')).data.links.map(l => l.name), ['Status']);
        assert.equal((await admin.call('PUT', '/admin/links', { links: [{ name: 'Bad', url: 'javascript:alert(1)' }] })).status, 400);
    });
});
