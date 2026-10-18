// Client for the Home Fin accounts service (homefin/accounts). Same-origin, cookie session.
import type { AuthenticationResult } from '@jellyfin/sdk/lib/generated-client/models/authentication-result';

import { getHomefinAccounts } from 'scripts/settings/webSettings';

export type Maturity = 'kids' | 'teen' | 'all';

export interface Account {
    id: number
    email: string
    name: string
    isAdmin: boolean
    disabled: boolean
    createdAt: string
}

export interface Profile {
    id: number
    name: string
    avatar: string
    maturity: Maturity
    locked: boolean
    jellyfinUserId: string
    position: number
}

export interface AvatarPreset {
    key: string
    emoji: string
    from: string
    to: string
}

export interface Me {
    account: Account
    profiles: Profile[]
}

export interface Invite {
    id: number
    email: string | null
    note: string | null
    expiresAt: string
    usedAt?: string | null
    usedBy?: string | null
    createdAt?: string
    /** Only returned once, when the invite is created. */
    code?: string
    url?: string
}

/** Proves the right to change a locked profile: its PIN, or the account password ("Forgot PIN?"). */
export type ProfileCredential = { currentPin?: string, accountPassword?: string };

export interface JellyfinUserSummary {
    id: string
    name: string
    isAdmin: boolean
    lastActivity: string | null
}

export interface Trending {
    days: number
    series: { id: string, viewers: number, plays: number }[]
    movies: { id: string, viewers: number, plays: number }[]
}

export class AccountsError extends Error {
    status: number;
    code?: string;

    constructor(status: number, message: string, code?: string) {
        super(message);
        // Transpiled `extends Error` loses the prototype; restore it so `instanceof` works.
        Object.setPrototypeOf(this, AccountsError.prototype);
        this.name = 'AccountsError';
        this.status = status;
        this.code = code;
    }
}

let configPromise: Promise<{ enabled: boolean, apiPath: string }> | null = null;

export function getAccountsConfig() {
    configPromise ??= getHomefinAccounts();
    return configPromise;
}

export async function isAccountsEnabled() {
    return (await getAccountsConfig()).enabled;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { apiPath } = await getAccountsConfig();
    const res = await fetch(apiPath + path, {
        method,
        credentials: 'same-origin',
        headers: method === 'GET' ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new AccountsError(res.status, data?.error || `Request failed (${res.status})`, data?.code);
    }
    return data as T;
}

export const accountsApi = {
    me: () => request<Me>('GET', '/me'),
    login: (email: string, password: string) => request<Me>('POST', '/auth/login', { email, password }),
    logout: () => request<{ ok: boolean }>('POST', '/auth/logout'),
    updateMe: (fields: { name?: string, email?: string, newPassword?: string, currentPassword?: string }) => request<Me>('PATCH', '/me', fields),
    avatars: () => request<{ avatars: AvatarPreset[] }>('GET', '/avatars'),
    serviceConfig: () => request<{ enabled: boolean, serverName: string, allowInvites: boolean }>('GET', '/config'),

    createProfile: (fields: { name: string, avatar?: string, maturity?: Maturity, pin?: string | null }) =>
        request<{ profile: Profile, profiles: Profile[] }>('POST', '/profiles', fields),
    updateProfile: (id: number, fields: { name?: string, avatar?: string, maturity?: Maturity, pin?: string | null } & ProfileCredential) =>
        request<{ profile: Profile, profiles: Profile[] }>('PATCH', `/profiles/${id}`, fields),
    deleteProfile: (id: number, credential: ProfileCredential = {}) => request<{ profiles: Profile[] }>('DELETE', `/profiles/${id}`, credential),
    profileSession: (id: number, device: { id: string, name: string, client: string, version: string }, pin?: string) =>
        request<{ authentication: AuthenticationResult, profile: Profile }>('POST', `/profiles/${id}/session`, { device, pin }),
    trending: () => request<Trending>('GET', '/trending'),

    invite: (code: string) => request<{ valid: boolean, email: string | null, serverName: string }>('GET', `/invites/${encodeURIComponent(code)}`),
    acceptInvite: (code: string, fields: { name: string, email: string, password: string }) =>
        request<Me>('POST', `/invites/${encodeURIComponent(code)}/accept`, fields),

    admin: {
        accounts: () => request<{ accounts: (Account & { profiles: Profile[] })[] }>('GET', '/admin/accounts'),
        createAccount: (fields: { name: string, email: string, password: string, isAdmin?: boolean }) =>
            request<{ account: Account & { profiles: Profile[] } }>('POST', '/admin/accounts', fields),
        updateAccount: (id: number, fields: { disabled?: boolean, isAdmin?: boolean, password?: string, name?: string }) =>
            request<{ account: Account & { profiles: Profile[] } }>('PATCH', `/admin/accounts/${id}`, fields),
        deleteAccount: (id: number) => request<{ ok: boolean }>('DELETE', `/admin/accounts/${id}`),
        invites: () => request<{ invites: Invite[] }>('GET', '/admin/invites'),
        createInvite: (fields: { email?: string, note?: string, days?: number, baseUrl: string }) =>
            request<{ invite: Invite }>('POST', '/admin/invites', fields),
        deleteInvite: (id: number) => request<{ ok: boolean }>('DELETE', `/admin/invites/${id}`),
        jellyfinUsers: () => request<{ users: JellyfinUserSummary[] }>('GET', '/admin/jellyfin-users'),
        adopt: (fields: { accountId: number, jellyfinUserId: string, name?: string, maturity?: Maturity }) =>
            request<{ profile: Profile }>('POST', '/admin/adopt', fields)
    }
};

let avatarCache: Promise<AvatarPreset[]> | null = null;

/** The preset avatar catalogue (fetched once). */
export function getAvatars() {
    avatarCache ??= accountsApi.avatars().then(r => r.avatars).catch(() => {
        avatarCache = null;
        return [];
    });
    return avatarCache;
}
