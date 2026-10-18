// Netflix-style profile menu for the header (plain DOM: libraryMenu.js renders the header).
import escapeHtml from 'escape-html';

import { ServerConnections } from 'lib/jellyfin-apiclient';

import { accountsApi, getAvatars, isAccountsEnabled, type Profile } from './api';
import { avatarHtml, findAvatar } from './avatar';
import { activateProfile, getCurrentProfile, signOutEverywhere } from './session';

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

/** True when the header should show the Home Fin profile button and menu. */
export function isProfileMenuEnabled() {
    // A stale profile (e.g. after signing in through Jellyfin's own page) doesn't count.
    const profile = getCurrentProfile();
    if (!profile || profile.jellyfinUserId !== ServerConnections.currentApiClient()?.getCurrentUserId()) return Promise.resolve(false);
    return isAccountsEnabled().catch(() => false);
}

/** Avatar + caret for the header user button. */
export async function renderProfileButton(button: HTMLElement) {
    const profile = getCurrentProfile();
    if (!profile) return;
    const avatar = findAvatar(await getAvatars(), profile.avatar);
    button.classList.add('hfProfileButton');
    button.innerHTML = avatarHtml(avatar, 'hfAvatar hfProfileButton-avatar')
        + '<span class="material-icons hfProfileButton-caret" aria-hidden="true">arrow_drop_down</span>';
    button.title = profile.name;
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
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
    settings: '#/mypreferencesmenu'
};

function item(action: string, icon: string, label: string, extra = '') {
    return `<button type="button" class="hfProfileMenu-item" role="menuitem" data-action="${action}"${extra}>`
        + `<span class="material-icons" aria-hidden="true">${icon}</span><span>${escapeHtml(label)}</span></button>`;
}

async function buildMenu() {
    const current = getCurrentProfile();
    const [profiles, avatars] = await Promise.all([getProfiles(), getAvatars()]);
    const others = profiles.filter(p => p.id !== current?.id);

    let html = '<div class="hfProfileMenu-arrow" aria-hidden="true"></div>';
    html += others.map(p => (
        `<button type="button" class="hfProfileMenu-item hfProfileMenu-profile" role="menuitem" data-action="switch" data-id="${p.id}">`
        + avatarHtml(findAvatar(avatars, p.avatar), 'hfAvatar hfProfileMenu-avatar')
        + `<span>${escapeHtml(p.name)}</span>`
        + (p.locked ? '<span class="material-icons hfProfileMenu-lock" aria-label="Locked">lock</span>' : '')
        + '</button>'
    )).join('');
    html += item('manage', 'edit', 'Manage Profiles');
    html += item('account', 'person_outline', 'Account');
    html += item('tv', 'tv', 'Sign in a TV');
    html += item('settings', 'settings', 'Settings');
    html += '<div class="hfProfileMenu-divider" role="separator"></div>';
    html += '<button type="button" class="hfProfileMenu-signout" role="menuitem" data-action="signout">Sign out of Home Fin</button>';
    return { html, profiles: others };
}

/** Open (or close) the menu under the header user button. */
export async function toggleProfileMenu(button: HTMLElement) {
    if (menu) {
        closeProfileMenu();
        return;
    }
    anchor = button;
    const { html, profiles } = await buildMenu();

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
        if (action === 'switch') {
            const profile = profiles.find(p => String(p.id) === target.dataset.id);
            if (profile) switchTo(profile);
            return;
        }
        closeProfileMenu();
        if (action === 'signout') {
            signOutEverywhere().catch(err => console.error('[Home Fin] sign out failed', err));
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
