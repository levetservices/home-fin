import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import escapeHtml from 'escape-html';
import type { ApiClient } from 'jellyfin-apiclient';

import imageLoader from 'components/images/imageLoader';
import { openMoreInfo } from 'homefin/moreInfo/moreInfo';
import { decorateRow } from 'homefin/ui/badges';
import { playTitleNow } from 'homefin/ui/play';
import globalize from 'lib/globalize';

import { attachHoverPreview } from './hoverPreview';
import { getCardArt, getPosterUrl, getProgressPercent } from './artwork';

import './rows.scss';

export type RowKind = 'landscape' | 'top10';

export interface RowOptions {
    title: string
    items: BaseItemDto[]
    kind?: RowKind
    /** Optional link for the row title ("Explore all"). */
    href?: string
    /** Prefer each episode's own still over its show's artwork. */
    useEpisodeImages?: boolean
    /** "TOP 10" badges and "Recently Added" ribbons (off for Continue Watching / Next Up). */
    badges?: boolean
}

/** Elements that own a rendered row keep a reference to its data. */
export type RowElement = HTMLElement & { hfItems?: BaseItemDto[] };

const TOP10_LIMIT = 10;

/** class/data-src attributes for a lazily loaded background image (handled by imageLoader). */
function lazyBackground(className: string, url: string) {
    return url ? `class="${className} lazy" data-src="${url}"` : `class="${className}"`;
}

function getLandscapeCardHtml(item: BaseItemDto, index: number, apiClient: ApiClient, options: RowOptions) {
    const art = getCardArt(item, apiClient, { width: 640, useEpisodeImages: options.useEpisodeImages });
    const label = escapeHtml(art.title);
    let html = `<button type="button" class="hfCard" data-index="${index}" aria-label="${label}">`;
    html += `<div ${lazyBackground('hfCard-art', art.url)}>`;
    if (!art.titleInArt) {
        html += art.logoUrl ?
            `<img class="hfCard-logo" src="${art.logoUrl}" alt="" loading="lazy" />` :
            `<span class="hfCard-title">${label}</span>`;
    }
    const progress = getProgressPercent(item);
    if (progress) {
        html += `<div class="hfCard-progress"><span style="width:${progress}%"></span></div>`;
    }
    html += '</div></button>';
    return html;
}

function getTop10CardHtml(item: BaseItemDto, index: number, apiClient: ApiClient) {
    const url = getPosterUrl(item, apiClient, 360);
    const label = escapeHtml(item.Name || '');
    let html = `<button type="button" class="hfCard hfCard-top10" data-index="${index}" aria-label="${index + 1}. ${label}">`;
    html += `<span class="hfCard-rank" aria-hidden="true">${index + 1}</span>`;
    html += `<div ${lazyBackground('hfCard-poster', url)}>`;
    if (!url) html += `<span class="hfCard-title">${label}</span>`;
    html += '</div></button>';
    return html;
}

function getRowHtml(options: RowOptions, apiClient: ApiClient) {
    const kind = options.kind || 'landscape';
    const items = kind === 'top10' ? options.items.slice(0, TOP10_LIMIT) : options.items;
    const title = escapeHtml(options.title);

    let html = '<div class="hfRow-header padded-left padded-right">';
    html += options.href ?
        `<a class="hfRow-title" href="${options.href}">${title}<span class="hfRow-explore">${escapeHtml(globalize.translate('ExploreAll'))}<span class="material-icons" aria-hidden="true">chevron_right</span></span></a>` :
        `<h2 class="hfRow-title">${title}</h2>`;
    html += '<div class="hfRow-pager" aria-hidden="true"></div>';
    html += '</div>';

    html += '<div class="hfRow-viewport">';
    html += `<button type="button" class="hfRow-arrow hfRow-arrow-prev" data-step="-1" aria-label="${escapeHtml(globalize.translate('Previous'))}" tabindex="-1"><span class="material-icons hfRow-arrowIcon" aria-hidden="true">chevron_left</span></button>`;
    html += '<div class="hfRow-track focuscontainer-x">';
    items.forEach((item, index) => {
        html += kind === 'top10' ? getTop10CardHtml(item, index, apiClient) : getLandscapeCardHtml(item, index, apiClient, options);
    });
    html += '</div>';
    html += `<button type="button" class="hfRow-arrow hfRow-arrow-next" data-step="1" aria-label="${escapeHtml(globalize.translate('Next'))}" tabindex="-1"><span class="material-icons hfRow-arrowIcon" aria-hidden="true">chevron_right</span></button>`;
    html += '</div>';
    return { html, items };
}

/** Page the row by whole screens of cards and keep arrows / page dashes in sync. */
function bindSlider(row: HTMLElement) {
    const track = row.querySelector<HTMLElement>('.hfRow-track');
    const pager = row.querySelector<HTMLElement>('.hfRow-pager');
    const prev = row.querySelector<HTMLElement>('.hfRow-arrow-prev');
    const next = row.querySelector<HTMLElement>('.hfRow-arrow-next');
    if (!track || !pager || !prev || !next) return;

    const getPageWidth = () => {
        const card = track.querySelector<HTMLElement>('.hfCard');
        if (!card) return track.clientWidth;
        const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
        const step = card.offsetWidth + gap;
        const perPage = Math.max(1, Math.floor((track.clientWidth - card.offsetLeft * 2 + gap) / step));
        return perPage * step;
    };

    let frame = 0;
    const update = () => {
        frame = 0;
        const max = track.scrollWidth - track.clientWidth;
        prev.classList.toggle('is-hidden', track.scrollLeft <= 2);
        next.classList.toggle('is-hidden', track.scrollLeft >= max - 2);

        const pageWidth = getPageWidth();
        const pages = max > 2 ? Math.ceil(max / pageWidth) + 1 : 0;
        const active = Math.min(pages - 1, Math.round(track.scrollLeft / pageWidth));
        if (pager.childElementCount !== pages) {
            pager.innerHTML = '<span></span>'.repeat(pages);
        }
        Array.from(pager.children).forEach((dash, i) => {
            dash.classList.toggle('is-active', i === active);
        });
    };
    const schedule = () => {
        if (!frame) frame = requestAnimationFrame(update);
    };

    row.addEventListener('click', (e) => {
        const arrow = (e.target as HTMLElement).closest<HTMLElement>('.hfRow-arrow');
        if (!arrow) return;
        track.scrollBy({ left: Number(arrow.dataset.step) * getPageWidth(), behavior: 'smooth' });
    });
    track.addEventListener('scroll', schedule, { passive: true });
    const onResize = () => {
        if (row.isConnected) {
            schedule();
        } else {
            window.removeEventListener('resize', onResize);
        }
    };
    window.addEventListener('resize', onResize);
    update();
}

/**
 * Render a Netflix-style row of cards into `elem`. Replaces any previous row in
 * the element. Returns false (and hides the element) when there is nothing to show.
 */
export function renderRow(elem: RowElement, options: RowOptions, apiClient: ApiClient) {
    if (!options.items.length) {
        elem.innerHTML = '';
        elem.classList.add('hide');
        return false;
    }

    const { html, items } = getRowHtml(options, apiClient);
    elem.hfItems = items;
    elem.classList.remove('hide');
    elem.classList.add('hfRow', `hfRow-${options.kind || 'landscape'}`);
    elem.innerHTML = html;

    imageLoader.lazyChildren(elem);
    bindSlider(elem);
    elem.classList.toggle('hfRow-noBadges', options.badges === false);
    decorateRow(elem);

    elem.querySelector('.hfRow-track')?.addEventListener('click', (e) => {
        const card = (e.target as HTMLElement).closest<HTMLElement>('.hfCard');
        const item = card && elem.hfItems?.[Number(card.dataset.index)];
        if (!item) return;
        // Something part-watched carries on playing; anything else opens More Info.
        if (getProgressPercent(item)) playTitleNow(item, apiClient);
        else openMoreInfo(item, apiClient);
    });

    attachHoverPreview(elem, apiClient);
    return true;
}
