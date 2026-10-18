// Netflix's header bell: what arrived recently, with a count of what's new since you last looked.
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import escapeHtml from 'escape-html';
import type { ApiClient } from 'jellyfin-apiclient';

import { openMoreInfo } from 'homefin/moreInfo/moreInfo';

import { RECENT_DAYS, getRibbon } from './badges';

import './notifications.scss';

const LIMIT = 8;
const DAY_MS = 86400000;
const SEEN_KEY = 'homefin_bell_seen_';

let panel: HTMLElement | null = null;
let anchor: HTMLElement | null = null;

function seenKey(apiClient: ApiClient) {
    return SEEN_KEY + apiClient.getCurrentUserId();
}

function lastSeen(apiClient: ApiClient) {
    try {
        return Number(localStorage.getItem(seenKey(apiClient))) || 0;
    } catch {
        return 0;
    }
}

function markSeen(apiClient: ApiClient) {
    try {
        localStorage.setItem(seenKey(apiClient), String(Date.now()));
    } catch {
        // storage blocked: the count just stays
    }
}

function added(item: BaseItemDto) {
    return new Date(item.DateCreated || 0).getTime();
}

function ago(time: number) {
    const days = Math.floor((Date.now() - time) / DAY_MS);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
}

/** Films and series added recently (episodes count towards their series). */
async function fetchArrivals(apiClient: ApiClient) {
    const items = await apiClient.getLatestItems({
        Limit: LIMIT * 2,
        Fields: 'DateCreated,Overview,ProductionYear',
        ImageTypeLimit: 1,
        EnableImageTypes: 'Backdrop,Thumb,Primary',
        GroupItems: true
    });
    const cutoff = Date.now() - RECENT_DAYS * DAY_MS;
    return items
        .filter(item => (item.Type === 'Movie' || item.Type === 'Series') && added(item) >= cutoff)
        .sort((a, b) => added(b) - added(a))
        .slice(0, LIMIT);
}

function art(item: BaseItemDto, apiClient: ApiClient) {
    const tag = item.BackdropImageTags?.[0];
    if (tag && item.Id) return apiClient.getScaledImageUrl(item.Id, { type: 'Backdrop', maxWidth: 240, tag });
    if (item.ImageTags?.Primary && item.Id) return apiClient.getScaledImageUrl(item.Id, { type: 'Primary', maxWidth: 240, tag: item.ImageTags.Primary });
    return '';
}

function close() {
    panel?.remove();
    panel = null;
    anchor?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('hashchange', close);
}

function onOutside(e: Event) {
    const target = e.target as Node;
    if (!panel?.contains(target) && !anchor?.contains(target)) close();
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        close();
        anchor?.focus();
    }
}

async function open(button: HTMLElement, apiClient: ApiClient) {
    anchor = button;
    const items = await fetchArrivals(apiClient);
    const seen = lastSeen(apiClient);

    panel = document.createElement('div');
    panel.className = 'hfBell-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'New arrivals');
    const html = items.length ? '<ul>' + items.map((item, i) => (
        `<li><button type="button" class="hfBell-item${added(item) > seen ? ' is-new' : ''}" data-index="${i}">`
        + `<span class="hfBell-art" style="background-image:url('${art(item, apiClient)}')"></span>`
        + '<span class="hfBell-text">'
        + `<span class="hfBell-kicker">${escapeHtml(getRibbon(item) || 'New Arrival')}</span>`
        + `<span class="hfBell-title">${escapeHtml(item.Name || '')}</span>`
        + `<span class="hfBell-when">${ago(added(item))}</span>`
        + '</span></button></li>'
    )).join('') + '</ul>' : '<p class="hfBell-empty">Nothing new in the last two weeks.</p>';
    panel.innerHTML = html;

    const rect = button.getBoundingClientRect();
    panel.style.top = `${Math.round(rect.bottom + 12)}px`;
    panel.style.right = `${Math.max(8, Math.round(window.innerWidth - rect.right - 8))}px`;
    panel.addEventListener('click', e => {
        const entry = (e.target as HTMLElement).closest<HTMLElement>('.hfBell-item');
        const item = entry && items[Number(entry.dataset.index)];
        if (!item) return;
        close();
        openMoreInfo(item, apiClient);
    });
    document.body.appendChild(panel);
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('hashchange', close);

    markSeen(apiClient);
    button.querySelector('.hfBell-count')?.remove();
}

/** Show the unread count on the bell (titles added since the bell was last opened). */
export async function refreshBell(button: HTMLElement, apiClient: ApiClient) {
    const seen = lastSeen(apiClient);
    const fresh = (await fetchArrivals(apiClient)).filter(item => added(item) > seen).length;
    button.querySelector('.hfBell-count')?.remove();
    if (fresh) button.insertAdjacentHTML('beforeend', `<span class="hfBell-count" aria-label="${fresh} new">${fresh}</span>`);
}

export function toggleBell(button: HTMLElement, apiClient: ApiClient) {
    if (panel) {
        close();
        return Promise.resolve();
    }
    return open(button, apiClient);
}
