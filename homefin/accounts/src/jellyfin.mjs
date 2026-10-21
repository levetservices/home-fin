// Minimal Jellyfin client for the companion service. Uses the admin API key for
// management calls and per-device headers when signing a profile in.

const CLIENT = 'Home Fin Accounts';
const VERSION = '1.0.0';

/** Jellyfin parental rating ceilings for each profile maturity level. */
export const MATURITY_RATINGS = { kids: 10, teen: 13, all: null };

function quote(value) {
    return String(value ?? '').replace(/["\\\r\n]/g, '');
}

export function createJellyfinClient({ url, apiKey, fetchImpl = fetch }) {
    if (!url) throw new Error('JELLYFIN_URL is required');
    const base = url.replace(/\/+$/, '');

    async function call(path, { method = 'GET', body, auth = 'admin', device, token } = {}) {
        const headers = { Accept: 'application/json' };
        if (auth === 'admin') {
            if (!apiKey) throw new Error('JELLYFIN_API_KEY is required');
            headers.Authorization = `MediaBrowser Token="${quote(apiKey)}"`;
        } else if (auth === 'token') {
            headers.Authorization = `MediaBrowser Token="${quote(token)}"`;
        } else if (auth === 'device') {
            headers.Authorization = `MediaBrowser Client="${quote(device?.client || CLIENT)}", Device="${quote(device?.name || 'Browser')}", DeviceId="${quote(device?.id)}", Version="${quote(device?.version || VERSION)}"`;
        }
        if (body !== undefined) headers['Content-Type'] = 'application/json';

        const res = await fetchImpl(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            const err = new Error(`Jellyfin ${method} ${path} failed: ${res.status} ${text.slice(0, 200)}`);
            err.status = res.status;
            throw err;
        }
        if (res.status === 204) return null;
        const type = res.headers.get('content-type') || '';
        return type.includes('json') ? res.json() : null;
    }

    return {
        systemInfo: () => call('/System/Info'),
        publicInfo: () => call('/System/Info/Public', { auth: 'none' }),
        listUsers: () => call('/Users'),
        getUser: id => call(`/Users/${encodeURIComponent(id)}`),

        async createUser(name, password) {
            return call('/Users/New', { method: 'POST', body: { Name: name, Password: password } });
        },
        deleteUser: id => call(`/Users/${encodeURIComponent(id)}`, { method: 'DELETE' }),

        /** Admin password reset: sets a new password without the old one. */
        setPassword: (id, password) => call(`/Users/${encodeURIComponent(id)}/Password`, { method: 'POST', body: { NewPw: password } }),

        /** Hide the user from the login screen and apply the maturity ceiling (and the account's disabled state). */
        async applyProfilePolicy(id, maturity, { disabled = false } = {}) {
            const user = await call(`/Users/${encodeURIComponent(id)}`);
            const rating = MATURITY_RATINGS[maturity] ?? null;
            const policy = {
                ...user.Policy,
                IsHidden: true,
                IsAdministrator: false,
                IsDisabled: disabled,
                EnableContentDeletion: false,
                EnableRemoteAccess: true,
                MaxParentalRating: rating,
                BlockUnratedItems: maturity === 'kids' ? ['Movie', 'Series', 'Trailer', 'Book', 'LiveTvChannel', 'LiveTvProgram'] : []
            };
            if (rating === null) delete policy.MaxParentalRating;
            await call(`/Users/${encodeURIComponent(id)}/Policy`, { method: 'POST', body: policy });
        },

        /** Turn a user on or off; Jellyfin rejects a disabled user's existing tokens straight away. */
        async setDisabled(id, disabled) {
            const user = await call(`/Users/${encodeURIComponent(id)}`);
            await call(`/Users/${encodeURIComponent(id)}/Policy`, { method: 'POST', body: { ...user.Policy, IsDisabled: !!disabled } });
        },

        /** Sign in as a profile's Jellyfin user on behalf of the person's own device. */
        authenticate: (username, password, device) => call('/Users/AuthenticateByName', {
            method: 'POST', auth: 'device', device, body: { Username: username, Pw: password }
        }),

        /** The user a viewer's own token belongs to (proves who is asking). */
        me: token => call('/Users/Me', { auth: 'token', token }),

        /** End the session behind a token (e.g. one used only to check a password). */
        logout: token => call('/Sessions/Logout', { method: 'POST', auth: 'token', token }),

        /** Films and episodes a user has played, most recent first. */
        recentlyPlayed: (userId, limit = 100) => call(`/Items?${new URLSearchParams({
            userId,
            Recursive: 'true',
            IncludeItemTypes: 'Movie,Episode',
            SortBy: 'DatePlayed',
            SortOrder: 'Descending',
            Limit: String(limit),
            Fields: 'SeriesId',
            EnableImageTypes: 'None',
            EnableTotalRecordCount: 'false'
        })}`),

        getItems: params => call(`/Items?${new URLSearchParams(params)}`)
    };
}
