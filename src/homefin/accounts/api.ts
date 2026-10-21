// Client for the Home Fin accounts service (homefin/accounts). Same-origin, cookie session.
import type { AuthenticationResult } from '@jellyfin/sdk/lib/generated-client/models/authentication-result';

import { ServerConnections } from 'lib/jellyfin-apiclient';
import { getHomefinAccounts } from 'scripts/settings/webSettings';

export type Maturity = 'kids' | 'teen' | 'all';

export type RequestPolicy = 'auto' | 'approve' | 'off';

export interface Account {
    id: number
    email: string
    name: string
    isAdmin: boolean
    disabled: boolean
    requestPolicy: RequestPolicy
    createdAt: string
}

export type MediaType = 'movie' | 'tv';

/** Where a title stands: in the library, on its way, asked for, or turned down. */
export type RequestState = 'available' | 'partial' | 'downloading' | 'processing' | 'pending' | 'declined' | 'failed' | null;

/** A film or show from Radarr / Sonarr's search (TMDB id for films, TVDB id for shows). */
export interface MediaResult {
    type: MediaType
    id: number
    title: string
    year: number | null
    overview: string
    poster: string | null
    backdrop: string | null
    genres: string[]
    runtime: number | null
    network: string | null
    rating: string | null
    seasons: number[] | null
    state: RequestState
    progress: number | null
}

export interface MediaRequest {
    id: number
    type: MediaType
    mediaId: number
    title: string
    year: number | null
    poster: string | null
    seasons: number[] | null
    status: 'pending' | 'approved' | 'declined' | 'failed' | 'available'
    state: RequestState
    progress: number | null
    requestedBy: string
    decidedBy: string | null
    reason: string | null
    createdAt: string
}

export interface RequestsConfig {
    enabled: boolean
    movies: boolean
    tv: boolean
    policy: RequestPolicy
    isAdmin: boolean
}

export interface ArrSettings {
    url: string
    hasKey: boolean
    qualityProfileId: number
    rootFolderPath: string
    languageProfileId: number | null
}

export interface ArrTestResult {
    url: string
    version: string
    qualityProfiles: { id: number, name: string }[]
    rootFolders: { path: string, freeSpace: number | null }[]
    languageProfiles: { id: number, name: string }[]
}

export interface QuickLink {
    name: string
    url: string
    icon: string
    audience: 'admins' | 'everyone'
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
    // Who is watching: lets the service tell profiles (and plain Jellyfin users) apart.
    const token = ServerConnections.currentApiClient()?.accessToken();
    const res = await fetch(apiPath + path, {
        method,
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
            ...(token ? { 'X-Jellyfin-Token': token } : {})
        },
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
    /** Moving over from a Jellyfin login (homefin/move). */
    moveCheck: (username: string, password: string) =>
        request<{ name: string, keepsPassword: boolean }>('POST', '/auth/move/check', { username, password }),
    move: (fields: { username: string, password: string, mode: 'new' | 'join', email: string, profileName: string, newPassword?: string, accountPassword?: string }) =>
        request<Me>('POST', '/auth/move', fields),
    acceptInvite: (code: string, fields: { name: string, email: string, password: string }) =>
        request<Me>('POST', `/invites/${encodeURIComponent(code)}/accept`, fields),

    admin: {
        accounts: () => request<{ accounts: (Account & { profiles: Profile[] })[] }>('GET', '/admin/accounts'),
        createAccount: (fields: { name: string, email: string, password: string, isAdmin?: boolean }) =>
            request<{ account: Account & { profiles: Profile[] } }>('POST', '/admin/accounts', fields),
        updateAccount: (id: number, fields: { disabled?: boolean, isAdmin?: boolean, password?: string, name?: string, requestPolicy?: RequestPolicy }) =>
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

export const requestsApi = {
    config: () => request<RequestsConfig>('GET', '/requests/config'),
    search: (query: string) => request<{ results: MediaResult[] }>('GET', `/requests/search?q=${encodeURIComponent(query)}`),
    list: () => request<{ mine: MediaRequest[], household: MediaRequest[] }>('GET', '/requests'),
    create: (type: MediaType, id: number, seasons?: number[]) => request<{ request: MediaRequest }>('POST', '/requests', { type, id, seasons }),
    cancel: (id: number) => request<{ ok: boolean }>('DELETE', `/requests/${id}`),
    links: () => request<{ links: QuickLink[] }>('GET', '/links'),

    admin: {
        queue: () => request<{ pending: MediaRequest[], failed: MediaRequest[], recent: MediaRequest[] }>('GET', '/admin/requests'),
        approve: (id: number) => request<{ request: MediaRequest }>('POST', `/admin/requests/${id}/approve`),
        decline: (id: number, reason?: string) => request<{ request: MediaRequest }>('POST', `/admin/requests/${id}/decline`, { reason }),
        integrations: () => request<{ radarr: ArrSettings | null, sonarr: ArrSettings | null, defaultPolicy: RequestPolicy }>('GET', '/admin/integrations'),
        testIntegration: (service: 'radarr' | 'sonarr', fields: { url: string, apiKey?: string }) =>
            request<ArrTestResult>('POST', `/admin/integrations/${service}/test`, fields),
        saveIntegration: (service: 'radarr' | 'sonarr', fields: { url: string, apiKey?: string, qualityProfileId?: number, rootFolderPath?: string, languageProfileId?: number | null }) =>
            request<{ ok: boolean }>('PUT', `/admin/integrations/${service}`, fields),
        removeIntegration: (service: 'radarr' | 'sonarr') => request<{ ok: boolean }>('DELETE', `/admin/integrations/${service}`),
        setDefaultPolicy: (defaultPolicy: RequestPolicy) => request<{ defaultPolicy: RequestPolicy }>('PUT', '/admin/requests-settings', { defaultPolicy }),
        links: () => request<{ links: QuickLink[] }>('GET', '/admin/links'),
        saveLinks: (links: QuickLink[]) => request<{ links: QuickLink[] }>('PUT', '/admin/links', { links })
    }
};

let requestsConfigCache: { userId: string, promise: Promise<RequestsConfig | null> } | null = null;

/** Requests settings for whoever is watching; null when the accounts service isn't there. */
export function getRequestsConfig(refresh = false) {
    const userId = ServerConnections.currentApiClient()?.getCurrentUserId() || '';
    if (refresh || requestsConfigCache?.userId !== userId) {
        const promise = isAccountsEnabled()
            .then(enabled => (enabled && userId ? requestsApi.config() : null))
            .catch(() => {
                requestsConfigCache = null;
                return null;
            });
        requestsConfigCache = { userId, promise };
    }
    return requestsConfigCache.promise;
}

let avatarCache: Promise<AvatarPreset[]> | null = null;

/** The preset avatar catalogue (fetched once). */
export function getAvatars() {
    avatarCache ??= accountsApi.avatars().then(r => r.avatars).catch(() => {
        avatarCache = null;
        return [];
    });
    return avatarCache;
}
