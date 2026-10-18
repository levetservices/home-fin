// Password hashing, secret encryption and random tokens. Node built-ins only.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 32;

/** Hash a password (or PIN) as `scrypt$N$r$p$salt$hash` (base64url). */
export async function hashSecret(secret) {
    const salt = randomBytes(16);
    const hash = await scrypt(String(secret), salt, KEY_LEN, SCRYPT);
    return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

/** Constant-time check of a secret against a stored `hashSecret` value. */
export async function verifySecret(secret, stored) {
    if (typeof stored !== 'string') return false;
    const [scheme, N, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
    const expected = Buffer.from(hashB64, 'base64url');
    const actual = await scrypt(String(secret), Buffer.from(saltB64, 'base64url'), expected.length, {
        N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A url-safe random token. */
export function randomToken(bytes = 32) {
    return randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
    return createHash('sha256').update(String(value)).digest('base64url');
}

/** Parse HOMEFIN_SECRET (base64/base64url/hex, 32 bytes) into a key. */
export function parseKey(secret) {
    if (!secret) throw new Error('HOMEFIN_SECRET is required (32 random bytes, e.g. `openssl rand -base64 32`)');
    for (const encoding of ['base64', 'base64url', 'hex']) {
        const key = Buffer.from(secret, encoding);
        if (key.length === 32) return key;
    }
    throw new Error('HOMEFIN_SECRET must decode to exactly 32 bytes');
}

/** AES-256-GCM encrypt to `v1.iv.tag.ciphertext` (base64url). */
export function encrypt(plaintext, key) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decrypt(payload, key) {
    const [version, iv, tag, data] = String(payload).split('.');
    if (version !== 'v1') throw new Error('Unknown secret format');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

export function safeEqual(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && timingSafeEqual(left, right);
}
