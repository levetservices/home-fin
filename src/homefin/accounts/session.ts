// Turning a Home Fin profile into a Jellyfin session in this browser, and signing out.
import { appHost } from 'components/apphost';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import appSettings from 'scripts/settings/appSettings';

import { accountsApi, type Profile } from './api';

const PROFILE_KEY = 'homefin_profile';

/** The profile this browser is signed in as (display info only; Jellyfin holds the session). */
export function getCurrentProfile(): Profile | null {
    try {
        const raw = localStorage.getItem(PROFILE_KEY);
        return raw ? JSON.parse(raw) as Profile : null;
    } catch {
        return null;
    }
}

function setCurrentProfile(profile: Profile | null) {
    try {
        if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
        else localStorage.removeItem(PROFILE_KEY);
    } catch {
        // storage unavailable (private mode): the header just won't show the avatar
    }
}

/** Name to show for a Jellyfin user: the profile name for Home Fin profiles ("hf-…" users). */
export function getDisplayName(user: { Id?: string | null, Name?: string | null } | null | undefined) {
    const profile = getCurrentProfile();
    if (profile && user?.Id && profile.jellyfinUserId === user.Id) return profile.name;
    return user?.Name || '';
}

function getApiClient() {
    const apiClient = ServerConnections.currentApiClient() || ServerConnections.getApiClients?.()[0];
    if (!apiClient) throw new Error('No Jellyfin server is configured for this browser');
    return apiClient;
}

/** Reload into the app at a route, so every cache starts fresh for the new user. */
function reloadTo(route: string) {
    window.location.hash = `#${route}`;
    window.location.reload();
}

/**
 * Sign this browser in to Jellyfin as the given profile.
 * Throws an AccountsError (e.g. 403 bad_pin) for the caller to show.
 */
export async function activateProfile(profile: Profile, pin?: string) {
    const device = {
        id: appHost.deviceId(),
        name: appHost.deviceName(),
        client: appHost.appName(),
        version: appHost.appVersion()
    };
    const { authentication, profile: confirmed } = await accountsApi.profileSession(profile.id, device, pin);

    const apiClient = getApiClient();
    // End the previous profile's Jellyfin session on this device before switching.
    if (apiClient.accessToken?.()) {
        await apiClient.logout().catch(() => undefined);
    }

    appSettings.enableAutoLogin(true);
    await apiClient.onAuthenticated(apiClient, authentication);
    ServerConnections.setLocalApiClient(apiClient);
    setCurrentProfile(confirmed);
    reloadTo('/home');
}

/** Leave the current profile but stay signed in to the account ("Switch profile"). */
export async function leaveProfile() {
    await ServerConnections.logout().catch(() => undefined);
    setCurrentProfile(null);
    reloadTo('/homefin/profiles');
}

/** Sign out of Jellyfin and the Home Fin account. */
export async function signOutEverywhere() {
    await ServerConnections.logout().catch(() => undefined);
    await accountsApi.logout().catch(() => undefined);
    setCurrentProfile(null);
    reloadTo('/homefin/login');
}
