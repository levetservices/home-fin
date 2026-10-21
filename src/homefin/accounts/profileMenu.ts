// Netflix-style profile button and menu for the header (plain DOM: libraryMenu.js renders the
// header). Home Fin profiles show their avatar and profile switching; plain Jellyfin users get
// the same look with their picture (or initial) and the same menu minus the account items.
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto';
import escapeHtml from 'escape-html';

import { ServerConnections } from 'lib/jellyfin-apiclient';
import Dashboard from 'utils/dashboard';

import { type QuickLink, accountsApi, getAvatars, isAccountsEnabled, requestsApi, type Profile } from './api';
import { avatarHtml, findAvatar } from './avatar';
import { activateProfile, getCurrentProfile } from './session';

import './profileMenu.scss';

let menu: HTMLElement | null = null;
let anchor: HTMLElement | null = null;
let profilesPromise: Promise<Profile[]> | null = null;

/** The account's profiles, fetched once per page load (switching profile reloads the page). */
function getProfiles() {
    profilesPromise ??= accountsApi.me().then(me => me.profiles).catch(() => {
        profilesPromise = null;
        return [];
    });
    return profilesPromise;
}

/** True when the browser is on a Home Fin profile (avatar, profile switching, Kids shortcut). */
export function isProfileMenuEnabled() {
    // A stale profile (e.g. after signing in through Jellyfin's own page) doesn't count.
    const profile = getCurrentProfile();
    if (!profile || profile.jellyfinUserId !== ServerConnections.currentApiClient()?.getCurrentUserId()) return Promise.resolve(false);
    return isAccountsEnabled().catch(() => false);
}

const INITIAL_COLOURS = ['#e50914', '#2f6fdb', '#1f9d55', '#d97706', '#7c3aed', '#0e9aa7', '#c2185b'];

/** A coloured square with the user's initial, for Jellyfin users without a picture. */
function initialAvatarHtml(name: string, className: string) {
    let hash = 0;
    for (const char of name) hash = Math.trunc(hash * 31 + char.charCodeAt(0)) % 1000003;
    const colour = INITIAL_COLOURS[Math.abs(hash) % INITIAL_COLOURS.length];
    const initial = escapeHtml((name.trim()[0] || '?').toUpperCase());
    return `<span class="${className} hfAvatar-initial" style="background:${colour}" aria-hidden="true">${initial}</span>`;
}

/** The avatar for whoever is signed in: Home Fin profile, Jellyfin picture, or initial. */
async function currentAvatarHtml(className: string, user?: UserDto | null, imageUrl?: string | null) {
    const profile = (await isProfileMenuEnabled()) ? getCurrentProfile() : null;
    if (profile) return avatarHtml(findAvatar(await getAvatars(), profile.avatar), `hfAvatar ${className}`);
    if (imageUrl) return `<span class="hfAvatar hfAvatar-photo ${className}" style="background-image:url('${escapeHtml(imageUrl)}')" aria-hidden="true"></span>`;
    return initialAvatarHtml(user?.Name || '', `hfAvatar ${className}`);
}

/** Avatar + caret for the header user button (Netflix style for every user). */
export async function renderProfileButton(button: HTMLElement, user?: UserDto | null, imageUrl?: string | null) {
    const profile = (await isProfileMenuEnabled()) ? getCurrentProfile() : null;
    button.classList.add('hfProfileButton');
    button.classList.remove('headerUserButtonRound');
    button.innerHTML = await currentAvatarHtml('hfProfileButton-avatar', user, imageUrl)
        + '<span class="material-icons hfProfileButton-caret" aria-hidden="true">arrow_drop_down</span>';
    button.title = profile?.name || user?.Name || '';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
}

/** Top of the phone menu: avatar, name and (on a Home Fin profile) Switch Profiles. */
export async function renderDrawerProfile(container: HTMLElement, user?: UserDto | null, imageUrl?: string | null) {
    const profile = (await isProfileMenuEnabled()) ? getCurrentProfile() : null;
    const name = escapeHtml(profile?.name || user?.Name || '');
    container.innerHTML = await currentAvatarHtml('hfDrawerProfile-avatar', user, imageUrl)
        + `<span class="hfDrawerProfile-text"><strong>${name}</strong>`
        + (profile ? '<a class="hfDrawerProfile-switch" href="#/homefin/profiles">Switch Profiles</a>' : '')
        + '</span>';
}

/** A "Kids" link in the header that switches to the account's kids profile (Netflix has one). */
export async function renderKidsShortcut(container: HTMLElement) {
    const current = getCurrentProfile();
    container.querySelector('.hfKidsLink')?.remove();
    if (!current || current.maturity === 'kids') return;
    const kids = (await getProfiles()).find(p => p.maturity === 'kids' && p.id !== current.id);
    if (!kids) return;
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'hfKidsLink';
    link.textContent = 'Kids';
    link.title = `Switch to ${kids.name}`;
    link.addEventListener('click', () => switchTo(kids));
    // Netflix order: search, Kids, bell, profile.
    const before = container.querySelector('.headerBellButton:not(.hide)') || container.querySelector('.headerUserButton');
    container.insertBefore(link, before);
}

function switchTo(profile: Profile) {
    closeProfileMenu();
    // Locked profiles ask for their PIN on Who's watching?
    if (profile.locked) {
        window.location.hash = '#/homefin/profiles';
        return;
    }
    activateProfile(profile).catch(() => {
        window.location.hash = '#/homefin/profiles';
    });
}

function onDocumentPointerDown(e: Event) {
    const target = e.target as Node;
    if (menu?.contains(target) || anchor?.contains(target)) return;
    closeProfileMenu();
}

function onDocumentKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        closeProfileMenu();
        anchor?.focus();
    }
}

export function closeProfileMenu() {
    if (!menu) return;
    menu.remove();
    menu = null;
    anchor?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    document.removeEventListener('keydown', onDocumentKeyDown, true);
    window.removeEventListener('hashchange', closeProfileMenu);
}

const MENU_ROUTES: Record<string, string> = {
    manage: '#/homefin/profiles/manage',
    account: '#/homefin/account',
    tv: '#/quickconnect',
    settings: '#/homefin/settings',
    dashboard: '#/dashboard',
    metadata: '#/metadata'
};

/** Quick links to the rest of the stack (Settings → Quick links); none without the accounts service. */
async function getQuickLinks(): Promise<QuickLink[]> {
    if (!(await isAccountsEnabled().catch(() => false))) return [];
    return requestsApi.links().then(result => result.links).catch(() => []);
}

function linkItem(link: QuickLink) {
    return `<a class="hfProfileMenu-item" role="menuitem" data-action="link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">`
        + `<span class="material-icons" aria-hidden="true">${escapeHtml(link.icon)}</span><span>${escapeHtml(link.name)}</span>`
        + '<span class="material-icons hfProfileMenu-external" aria-hidden="true">open_in_new</span></a>';
}

function item(action: string, icon: string, label: string, extra = '') {
    return `<button type="button" class="hfProfileMenu-item" role="menuitem" data-action="${action}"${extra}>`
        + `<span class="material-icons" aria-hidden="true">${icon}</span><span>${escapeHtml(label)}</span></button>`;
}

async function buildMenu(user?: UserDto | null, imageUrl?: string | null) {
    const onProfile = await isProfileMenuEnabled();
    const current = onProfile ? getCurrentProfile() : null;
    const [[profiles, avatars], links] = await Promise.all([
        onProfile ? Promise.all([getProfiles(), getAvatars()]) : Promise.resolve([[], []] as [Profile[], never[]]),
        getQuickLinks()
    ]);
    const others = profiles.filter(p => p.id !== current?.id);

    let html = '<div class="hfProfileMenu-arrow" aria-hidden="true"></div>';
    if (!onProfile && user?.Name) {
        html += `<div class="hfProfileMenu-who">${await currentAvatarHtml('hfProfileMenu-avatar', user, imageUrl)}<span>${escapeHtml(user.Name)}</span></div>`;
    }
    html += others.map(p => (
        `<button type="button" class="hfProfileMenu-item hfProfileMenu-profile" role="menuitem" data-action="switch" data-id="${p.id}">`
        + avatarHtml(findAvatar(avatars, p.avatar), 'hfAvatar hfProfileMenu-avatar')
        + `<span>${escapeHtml(p.name)}</span>`
        + (p.locked ? '<span class="material-icons hfProfileMenu-lock" aria-label="Locked">lock</span>' : '')
        + '</button>'
    )).join('');
    if (onProfile) {
        html += item('manage', 'edit', 'Manage Profiles');
        html += item('account', 'person_outline', 'Account');
    }
    html += item('tv', 'tv', 'Sign in a TV');
    html += item('settings', 'settings', 'Settings');
    // What Jellyfin's sidebar used to hold for administrators.
    if (user?.Policy?.IsAdministrator) {
        html += item('dashboard', 'dashboard', 'Dashboard');
        html += item('metadata', 'edit_note', 'Metadata Manager');
    }
    if (links.length) {
        html += '<div class="hfProfileMenu-divider" role="separator"></div>';
        html += links.map(linkItem).join('');
    }
    html += '<div class="hfProfileMenu-divider" role="separator"></div>';
    html += `<button type="button" class="hfProfileMenu-signout" role="menuitem" data-action="signout">${onProfile ? 'Sign out of Home Fin' : 'Sign out'}</button>`;
    return { html, profiles: others };
}

/** Open (or close) the menu under the header user button. */
export async function toggleProfileMenu(button: HTMLElement, user?: UserDto | null, imageUrl?: string | null) {
    if (menu) {
        closeProfileMenu();
        return;
    }
    anchor = button;
    const { html, profiles } = await buildMenu(user, imageUrl);

    menu = document.createElement('div');
    menu.className = 'hfProfileMenu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Profile menu');
    menu.innerHTML = html;

    const rect = button.getBoundingClientRect();
    menu.style.top = `${Math.round(rect.bottom + 12)}px`;
    menu.style.right = `${Math.max(8, Math.round(window.innerWidth - rect.right))}px`;

    menu.addEventListener('click', e => {
        const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
        if (!target) return;
        const action = target.dataset.action;
        if (action === 'link') {
            // Let the link open (new tab) before the menu goes.
            setTimeout(closeProfileMenu);
            return;
        }
        if (action === 'switch') {
            const profile = profiles.find(p => String(p.id) === target.dataset.id);
            if (profile) switchTo(profile);
            return;
        }
        closeProfileMenu();
        if (action === 'signout') {
            // Signs out of Home Fin too when accounts are on.
            Dashboard.logout();
        } else if (action && MENU_ROUTES[action]) {
            window.location.hash = MENU_ROUTES[action];
        }
    });

    document.body.appendChild(menu);
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    document.addEventListener('keydown', onDocumentKeyDown, true);
    window.addEventListener('hashchange', closeProfileMenu);
}
