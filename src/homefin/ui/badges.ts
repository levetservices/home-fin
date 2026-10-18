// Card badges as on Netflix: a red "TOP 10" badge and "Recently Added" / "New Season" ribbons.
// Rows render before the data behind the badges arrives, so cards are decorated afterwards too.
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { ApiClient } from 'jellyfin-apiclient';

import type { SeriesNews } from 'homefin/recs/score';

import './badges.scss';

/** Titles added within this many days get a "Recently Added" ribbon. */
export const RECENT_DAYS = 14;
const DAY_MS = 86400000;
const NEW_EPISODE_SCAN_LIMIT = 300;
const CACHE_MS = 10 * 60 * 1000;

type RowElement = HTMLElement & { hfItems?: BaseItemDto[] };

let top10Ids = new Set<string>();
let seriesNews = new Map<string, SeriesNews>();
let newsLoaded: { at: number, promise: Promise<void> } | null = null;

function isRecent(date: string | null | undefined, now = Date.now()) {
    return !!date && now - new Date(date).getTime() <= RECENT_DAYS * DAY_MS;
}

/**
 * Series with episodes added recently: a new season when a recent episode opens a season
 * after the first, otherwise new episodes. One query for the whole library, cached briefly.
 */
export function loadSeriesNews(apiClient: ApiClient) {
    if (newsLoaded && Date.now() - newsLoaded.at < CACHE_MS) return newsLoaded.promise;
    const promise = apiClient.getItems(apiClient.getCurrentUserId(), {
        IncludeItemTypes: 'Episode',
        Recursive: true,
        SortBy: 'DateCreated',
        SortOrder: 'Descending',
        Fields: 'DateCreated',
        EnableImages: false,
        EnableUserData: false,
        EnableTotalRecordCount: false,
        Limit: NEW_EPISODE_SCAN_LIMIT
    }).then(result => {
        const news = new Map<string, SeriesNews>();
        const now = Date.now();
        for (const episode of result.Items || []) {
            if (!episode.SeriesId || !isRecent(episode.DateCreated, now)) continue;
            const opensSeason = episode.IndexNumber === 1 && (episode.ParentIndexNumber ?? 1) > 1;
            const addedAt = new Date(episode.DateCreated || 0).getTime();
            const known = news.get(episode.SeriesId);
            // Newest first, so the first sighting has the latest date; a new season outranks new episodes.
            if (opensSeason && known?.label !== 'New Season') news.set(episode.SeriesId, { label: 'New Season', addedAt: known?.addedAt ?? addedAt });
            else if (!known) news.set(episode.SeriesId, { label: 'New Episodes', addedAt });
        }
        seriesNews = news;
        decorateAll();
    }).catch(err => console.error('[HomeFin badges] could not load new episodes', err));
    newsLoaded = { at: Date.now(), promise };
    return promise;
}

/** Series with recently added episodes ("New Season" / "New Episodes"), as last loaded. */
export function getSeriesNews() {
    return seriesNews;
}

/** Remember the household Top 10 so its titles get a badge wherever they appear. */
export function setTop10(items: BaseItemDto[]) {
    top10Ids = new Set(items.map(item => item.Id).filter((id): id is string => !!id));
    decorateAll();
}

export function isTop10(item: BaseItemDto) {
    return !!item.Id && top10Ids.has(item.Id);
}

/** "New Season" / "New Episodes" for series, "Recently Added" for new films and series. */
export function getRibbon(item: BaseItemDto): string {
    if (item.Type === 'Series' && item.Id) {
        const news = seriesNews.get(item.Id);
        // A brand-new series is simply "Recently Added".
        if (news && !isRecent(item.DateCreated)) return news.label;
    }
    if ((item.Type === 'Movie' || item.Type === 'Series') && isRecent(item.DateCreated)) return 'Recently Added';
    return '';
}

function badgeHtml(item: BaseItemDto) {
    let html = '';
    if (isTop10(item)) html += '<span class="hfBadge-top10" aria-label="Top 10"><span>TOP</span><span>10</span></span>';
    const ribbon = getRibbon(item);
    if (ribbon) html += `<span class="hfBadge-ribbon">${ribbon}</span>`;
    return html;
}

/** Add (or refresh) the badges on every card in a row. */
export function decorateRow(row: RowElement) {
    if (row.classList.contains('hfRow-top10') || row.classList.contains('hfRow-noBadges')) return;
    for (const card of row.querySelectorAll<HTMLElement>('.hfCard')) {
        const item = row.hfItems?.[Number(card.dataset.index)];
        const art = card.querySelector('.hfCard-art');
        // Part-watched cards keep their progress bar clear.
        if (!item || !art || art.querySelector('.hfCard-progress')) continue;
        art.querySelector('.hfBadges')?.remove();
        const html = badgeHtml(item);
        if (html) art.insertAdjacentHTML('beforeend', `<span class="hfBadges">${html}</span>`);
    }
}

function decorateAll() {
    document.querySelectorAll<RowElement>('.hfRow').forEach(decorateRow);
}
