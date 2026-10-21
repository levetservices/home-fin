// SQLite storage for accounts, profiles, sessions and invites (node:sqlite).
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    avatar TEXT NOT NULL,
    maturity TEXT NOT NULL DEFAULT 'all' CHECK (maturity IN ('kids', 'teen', 'all')),
    pin_hash TEXT,
    jellyfin_user_id TEXT NOT NULL UNIQUE,
    jellyfin_password_enc TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (account_id, name)
);
CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    user_agent TEXT
);
CREATE TABLE IF NOT EXISTS invites (
    id INTEGER PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    created_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    email TEXT,
    note TEXT,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    used_by_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    media_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    year INTEGER,
    poster TEXT,
    seasons TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'failed', 'available')),
    requested_by_user TEXT NOT NULL,
    requested_by_name TEXT NOT NULL,
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    decided_by_name TEXT,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT
);
CREATE INDEX IF NOT EXISTS profiles_account ON profiles(account_id);
CREATE INDEX IF NOT EXISTS requests_media ON requests(media_type, media_id);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
`;

export const SESSION_DAYS = 30;
export const MAX_PROFILES = 5;

export function openDatabase(file) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    db.exec(SCHEMA);
    migrate(db);
    return createStore(db);
}

/** Columns added after the first release, for databases created before them. */
function migrate(db) {
    const columns = new Set(db.prepare('PRAGMA table_info(accounts)').all().map(c => c.name));
    if (!columns.has('request_policy')) {
        // Whether the account's requests need an admin's approval: auto, approve or off.
        db.exec("ALTER TABLE accounts ADD COLUMN request_policy TEXT NOT NULL DEFAULT 'approve'");
    }
}

export const REQUEST_POLICIES = new Set(['auto', 'approve', 'off']);

/** Public shape of an account (never includes hashes). */
function toAccount(row) {
    if (!row) return null;
    return {
        id: row.id,
        email: row.email,
        name: row.name,
        isAdmin: !!row.is_admin,
        disabled: !!row.disabled,
        requestPolicy: row.request_policy,
        createdAt: row.created_at
    };
}

/** Public shape of a request. */
export function toRequest(row) {
    if (!row) return null;
    return {
        id: row.id,
        type: row.media_type,
        mediaId: row.media_id,
        title: row.title,
        year: row.year,
        poster: row.poster,
        seasons: row.seasons ? JSON.parse(row.seasons) : null,
        status: row.status,
        requestedBy: row.requested_by_name,
        requestedByUser: row.requested_by_user,
        accountId: row.account_id,
        decidedBy: row.decided_by_name,
        reason: row.reason,
        createdAt: row.created_at,
        decidedAt: row.decided_at
    };
}

/** Public shape of a profile (never includes the Jellyfin password). */
export function toProfile(row) {
    if (!row) return null;
    return {
        id: row.id,
        name: row.name,
        avatar: row.avatar,
        maturity: row.maturity,
        locked: !!row.pin_hash,
        jellyfinUserId: row.jellyfin_user_id,
        position: row.position
    };
}

function createStore(db) {
    const q = sql => db.prepare(sql);
    const days = n => new Date(Date.now() + n * 86400000).toISOString();

    return {
        db,
        transaction(fn) {
            db.exec('BEGIN');
            try {
                const result = fn();
                db.exec('COMMIT');
                return result;
            } catch (err) {
                db.exec('ROLLBACK');
                throw err;
            }
        },

        // ── accounts ────────────────────────────────────────────────
        countAccounts: () => q('SELECT COUNT(*) AS n FROM accounts').get().n,
        accountRowByEmail: email => q('SELECT * FROM accounts WHERE email = ?').get(String(email).trim()),
        accountRowById: id => q('SELECT * FROM accounts WHERE id = ?').get(id),
        account: id => toAccount(q('SELECT * FROM accounts WHERE id = ?').get(id)),
        listAccounts: () => q('SELECT * FROM accounts ORDER BY created_at').all().map(toAccount),
        createAccount({ email, name, passwordHash, isAdmin = false }) {
            const info = q('INSERT INTO accounts (email, name, password_hash, is_admin) VALUES (?, ?, ?, ?)')
                .run(String(email).trim().toLowerCase(), name, passwordHash, isAdmin ? 1 : 0);
            return Number(info.lastInsertRowid);
        },
        updateAccount(id, fields) {
            const map = { name: 'name', email: 'email', passwordHash: 'password_hash', isAdmin: 'is_admin', disabled: 'disabled', requestPolicy: 'request_policy' };
            for (const [key, column] of Object.entries(map)) {
                if (fields[key] === undefined) continue;
                let value = fields[key];
                if (typeof value === 'boolean') value = value ? 1 : 0;
                if (key === 'email') value = String(value).trim().toLowerCase();
                q(`UPDATE accounts SET ${column} = ? WHERE id = ?`).run(value, id);
            }
        },
        deleteAccount: id => q('DELETE FROM accounts WHERE id = ?').run(id),

        // ── profiles ────────────────────────────────────────────────
        profileRows: accountId => q('SELECT * FROM profiles WHERE account_id = ? ORDER BY position, id').all(accountId),
        profiles: accountId => q('SELECT * FROM profiles WHERE account_id = ? ORDER BY position, id').all(accountId).map(toProfile),
        allProfileRows: () => q('SELECT * FROM profiles ORDER BY account_id, position, id').all(),
        /** Load a profile only if it belongs to the account. */
        profileRow: (accountId, profileId) => q('SELECT * FROM profiles WHERE id = ? AND account_id = ?').get(profileId, accountId),
        profileRowByJellyfinUser: userId => q('SELECT * FROM profiles WHERE jellyfin_user_id = ?').get(userId),
        countProfiles: accountId => q('SELECT COUNT(*) AS n FROM profiles WHERE account_id = ?').get(accountId).n,
        createProfile({ accountId, name, avatar, maturity, pinHash, jellyfinUserId, jellyfinPasswordEnc }) {
            const position = q('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM profiles WHERE account_id = ?').get(accountId).p;
            const info = q(`INSERT INTO profiles (account_id, name, avatar, maturity, pin_hash, jellyfin_user_id, jellyfin_password_enc, position)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(accountId, name, avatar, maturity, pinHash ?? null, jellyfinUserId, jellyfinPasswordEnc, position);
            return Number(info.lastInsertRowid);
        },
        updateProfile(id, fields) {
            const map = { name: 'name', avatar: 'avatar', maturity: 'maturity', pinHash: 'pin_hash', jellyfinPasswordEnc: 'jellyfin_password_enc' };
            for (const [key, column] of Object.entries(map)) {
                if (fields[key] !== undefined) q(`UPDATE profiles SET ${column} = ? WHERE id = ?`).run(fields[key], id);
            }
        },
        deleteProfile: id => q('DELETE FROM profiles WHERE id = ?').run(id),

        // ── sessions ────────────────────────────────────────────────
        createSession({ idHash, accountId, userAgent }) {
            q('INSERT INTO sessions (id_hash, account_id, expires_at, user_agent) VALUES (?, ?, ?, ?)')
                .run(idHash, accountId, days(SESSION_DAYS), userAgent ?? null);
        },
        /** Returns the session's account (if valid) and slides its expiry. */
        touchSession(idHash) {
            const row = q(`SELECT s.*, a.disabled FROM sessions s JOIN accounts a ON a.id = s.account_id
                WHERE s.id_hash = ? AND s.expires_at > ?`).get(idHash, new Date().toISOString());
            if (!row || row.disabled) return null;
            q("UPDATE sessions SET last_seen_at = datetime('now'), expires_at = ? WHERE id_hash = ?").run(days(SESSION_DAYS), idHash);
            return row.account_id;
        },
        deleteSession: idHash => q('DELETE FROM sessions WHERE id_hash = ?').run(idHash),
        deleteSessionsForAccount: (accountId, exceptHash = '') => q('DELETE FROM sessions WHERE account_id = ? AND id_hash != ?').run(accountId, exceptHash),
        purgeExpiredSessions: () => q('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString()),

        // ── invites ─────────────────────────────────────────────────
        createInvite({ codeHash, createdBy, email, note, expiresAt }) {
            const info = q('INSERT INTO invites (code_hash, created_by, email, note, expires_at) VALUES (?, ?, ?, ?, ?)')
                .run(codeHash, createdBy, email ?? null, note ?? null, expiresAt);
            return Number(info.lastInsertRowid);
        },
        inviteByHash: codeHash => q('SELECT * FROM invites WHERE code_hash = ?').get(codeHash),
        listInvites: () => q(`SELECT i.id, i.email, i.note, i.expires_at, i.used_at, i.created_at, a.email AS used_by
            FROM invites i LEFT JOIN accounts a ON a.id = i.used_by_account_id ORDER BY i.created_at DESC`).all(),
        // ── settings (JSON values) ──────────────────────────────────
        getSetting(key, fallback = null) {
            const row = q('SELECT value FROM settings WHERE key = ?').get(key);
            return row ? JSON.parse(row.value) : fallback;
        },
        setSetting(key, value) {
            if (value === null || value === undefined) {
                q('DELETE FROM settings WHERE key = ?').run(key);
                return;
            }
            q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
        },

        // ── requests ────────────────────────────────────────────────
        createRequest({ type, mediaId, title, year, poster, seasons, requestedByUser, requestedByName, accountId }) {
            const info = q(`INSERT INTO requests (media_type, media_id, title, year, poster, seasons, requested_by_user, requested_by_name, account_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(type, mediaId, title, year ?? null, poster ?? null,
                seasons ? JSON.stringify(seasons) : null, requestedByUser, requestedByName, accountId ?? null);
            return Number(info.lastInsertRowid);
        },
        requestRow: id => q('SELECT * FROM requests WHERE id = ?').get(id),
        requestsFor: (type, mediaId) => q('SELECT * FROM requests WHERE media_type = ? AND media_id = ? ORDER BY id DESC').all(type, mediaId),
        requestsByUser: userId => q('SELECT * FROM requests WHERE requested_by_user = ? ORDER BY id DESC LIMIT 100').all(userId),
        listRequests: ({ status, limit = 100 } = {}) => (status ?
            q('SELECT * FROM requests WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit) :
            q('SELECT * FROM requests ORDER BY id DESC LIMIT ?').all(limit)),
        updateRequest(id, { status, decidedByName, reason }) {
            q(`UPDATE requests SET status = ?, decided_by_name = COALESCE(?, decided_by_name), reason = ?,
                decided_at = CASE WHEN ? IN ('approved', 'declined') THEN datetime('now') ELSE decided_at END WHERE id = ?`)
                .run(status, decidedByName ?? null, reason ?? null, status, id);
        },
        deleteRequest: id => q('DELETE FROM requests WHERE id = ?').run(id),

        markInviteUsed: (id, accountId) => q("UPDATE invites SET used_at = datetime('now'), used_by_account_id = ? WHERE id = ?").run(accountId, id),
        deleteInvite: id => q('DELETE FROM invites WHERE id = ?').run(id)
    };
}
