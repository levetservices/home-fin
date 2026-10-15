import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import escapeHtml from 'escape-html';
import type { ApiClient } from 'jellyfin-apiclient';

import { playbackManager } from 'components/playback/playbackmanager';
import { appRouter } from 'components/router/appRouter';
import globalize from 'lib/globalize';

import { formatRuntime, getCardArt, getProgressPercent, getRemainingTicks } from './artwork';

/** Hover must settle on a card this long before the preview opens (as on Netflix). */
const OPEN_DELAY_MS = 450;
const SCALE = 1.5;
const EDGE_GAP = 12;

type RowElement = HTMLElement & { hfItems?: BaseItemDto[] };

let openPreview: { el: HTMLElement, close: () => void } | null = null;

const canHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

function getResumeTicks(item: BaseItemDto) {
    return item.Type === 'Series' ? 0 : item.UserData?.PlaybackPositionTicks || 0;
}

function circleButton(action: string, icon: string, label: string, extraClass = '') {
    const text = escapeHtml(label);
    return `<button type="button" class="hfPreview-btn ${extraClass}" data-action="${action}" title="${text}" aria-label="${text}"><span class="material-icons" aria-hidden="true">${icon}</span></button>`;
}

function getMetaHtml(item: BaseItemDto) {
    let html = '<div class="hfPreview-meta">';
    if (item.CommunityRating) {
        html += `<span class="hfPreview-score"><span class="material-icons" aria-hidden="true">star</span>${item.CommunityRating.toFixed(1)}</span>`;
    }
    if (item.OfficialRating) html += `<span class="hfPreview-age">${escapeHtml(item.OfficialRating)}</span>`;

    if (item.Type === 'Episode') {
        const code = item.ParentIndexNumber != null && item.IndexNumber != null ? `S${item.ParentIndexNumber}:E${item.IndexNumber}` : '';
        html += `<span>${escapeHtml([code, item.Name].filter(Boolean).join(' · '))}</span>`;
    } else if (item.Type === 'Series') {
        if (item.ChildCount) {
            html += `<span>${escapeHtml(globalize.translate(item.ChildCount === 1 ? 'ValueOneSeason' : 'ValueSeasonCount', item.ChildCount))}</span>`;
        }
    } else if (item.RunTimeTicks) {
        html += `<span>${formatRuntime(item.RunTimeTicks)}</span>`;
    }
    if (item.ProductionYear && item.Type !== 'Episode') html += `<span>${item.ProductionYear}</span>`;
    html += '</div>';
    return html;
}

function getPreviewHtml(item: BaseItemDto, apiClient: ApiClient) {
    const art = getCardArt(item, apiClient, { width: 960 });
    const isFavourite = !!item.UserData?.IsFavorite;
    const isLiked = item.UserData?.Likes === true;
    const resume = getResumeTicks(item);

    let html = `<div class="hfPreview-art" style="background-image:url('${art.url}')" data-action="info">`;
    if (!art.titleInArt) {
        html += art.logoUrl ?
            `<img class="hfPreview-logo" src="${art.logoUrl}" alt="" />` :
            `<span class="hfPreview-title">${escapeHtml(art.title)}</span>`;
    }
    html += '</div>';

    html += '<div class="hfPreview-body">';
    html += '<div class="hfPreview-actions">';
    html += circleButton('play', 'play_arrow', globalize.translate(resume ? 'ButtonResume' : 'Play'), 'hfPreview-btn-play');
    html += circleButton('favourite', isFavourite ? 'check' : 'add', globalize.translate(isFavourite ? 'Favorite' : 'AddToFavorites'), isFavourite ? 'is-on' : '');
    html += circleButton('like', isLiked ? 'thumb_up' : 'thumb_up_off_alt', globalize.translate('Like'), isLiked ? 'is-on' : '');
    html += circleButton('info', 'expand_more', globalize.translate('MoreInfo'), 'hfPreview-btn-info');
    html += '</div>';
    html += getMetaHtml(item);

    const progress = getProgressPercent(item);
    if (progress) {
        const left = formatRuntime(getRemainingTicks(item));
        const leftHtml = left ? '<span>' + escapeHtml(globalize.translate('ValueTimeLeft', left)) + '</span>' : '';
        html += `<div class="hfPreview-progress"><div class="hfPreview-bar"><span style="width:${progress}%"></span></div>${leftHtml}</div>`;
    }

    if (item.Genres?.length) {
        html += '<div class="hfPreview-genres">' + item.Genres.slice(0, 3).map(g => `<span>${escapeHtml(g)}</span>`).join('') + '</div>';
    }
    html += '</div>';
    return html;
}

function closeCurrent() {
    openPreview?.close();
}

function open(card: HTMLElement, item: BaseItemDto, apiClient: ApiClient) {
    closeCurrent();

    const rect = card.getBoundingClientRect();
    const width = rect.width * SCALE;
    const artHeight = width * 9 / 16;
    const centreX = rect.left + rect.width / 2;
    const left = Math.min(Math.max(centreX - width / 2, EDGE_GAP), window.innerWidth - width - EDGE_GAP);
    const top = rect.top + rect.height / 2 - artHeight / 2;

    const el = document.createElement('div');
    el.className = 'hfPreview';
    el.style.left = `${left + window.scrollX}px`;
    el.style.top = `${top + window.scrollY}px`;
    el.style.width = `${width}px`;
    // Grow out of the card: the transform origin is the card's centre.
    el.style.transformOrigin = `${centreX - left}px ${artHeight / 2}px`;
    el.innerHTML = getPreviewHtml(item, apiClient);
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-open'));

    const close = () => {
        if (openPreview?.el === el) openPreview = null;
        el.classList.remove('is-open');
        el.classList.add('is-closing');
        window.setTimeout(() => el.remove(), 200);
    };
    openPreview = { el, close };

    el.addEventListener('mouseleave', close);
    el.addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
        const userId = apiClient.getCurrentUserId();
        switch (button?.dataset.action) {
            case 'play':
                close();
                playbackManager.play({ items: [item], startPositionTicks: getResumeTicks(item) })
                    .catch((err: unknown) => console.error('[HoverPreview] playback failed', err));
                break;
            case 'favourite': {
                const next = !item.UserData?.IsFavorite;
                apiClient.updateFavoriteStatus(userId, item.Id || '', next).then(() => {
                    item.UserData = { ...item.UserData, IsFavorite: next };
                    button.classList.toggle('is-on', next);
                    button.querySelector('.material-icons')!.textContent = next ? 'check' : 'add';
                }).catch((err: unknown) => console.error('[HoverPreview] favourite failed', err));
                break;
            }
            case 'like': {
                const next = item.UserData?.Likes !== true;
                const request = next ?
                    apiClient.updateUserItemRating(userId, item.Id || '', true) :
                    apiClient.clearUserItemRating(userId, item.Id || '');
                request.then(() => {
                    item.UserData = { ...item.UserData, Likes: next ? true : null };
                    button.classList.toggle('is-on', next);
                    button.querySelector('.material-icons')!.textContent = next ? 'thumb_up' : 'thumb_up_off_alt';
                }).catch((err: unknown) => console.error('[HoverPreview] rating failed', err));
                break;
            }
            case 'info':
                close();
                appRouter.showItem(item);
                break;
            default:
                break;
        }
    });
}

/** Netflix-style hover previews for the cards in a row (mouse/trackpad only). */
export function attachHoverPreview(row: RowElement, apiClient: ApiClient) {
    let timer: number | undefined;

    const cancel = () => {
        window.clearTimeout(timer);
        timer = undefined;
    };

    row.addEventListener('mouseover', (e) => {
        if (!canHover()) return;
        const card = (e.target as HTMLElement).closest<HTMLElement>('.hfCard');
        if (!card || card.contains(e.relatedTarget as Node)) return;
        cancel();
        timer = window.setTimeout(() => {
            const item = row.hfItems?.[Number(card.dataset.index)];
            if (item && card.isConnected && card.matches(':hover')) open(card, item, apiClient);
        }, OPEN_DELAY_MS);
    });
    row.addEventListener('mouseleave', cancel);

    // Paging the row moves the cards out from under an open preview.
    row.querySelector('.hfRow-track')?.addEventListener('scroll', () => {
        cancel();
        closeCurrent();
    }, { passive: true });
}

/** Close any open preview, e.g. when the page is left. */
export function closeHoverPreview() {
    closeCurrent();
}
