import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { RecommendationDto } from '@jellyfin/sdk/lib/generated-client/models/recommendation-dto';
import escapeHtml from 'escape-html';
import type { ApiClient } from 'jellyfin-apiclient';

import cardBuilder from 'components/cardbuilder/cardBuilder';
import imageLoader from 'components/images/imageLoader';
import globalize from 'lib/globalize';
import { getBackdropShape } from 'utils/card';

import type { SectionOptions } from './section';

interface Row {
    title: string
    items: BaseItemDto[]
}

const ROW_ITEM_LIMIT = 16;
/** Rows with fewer titles than this look sparse, so they are dropped. */
const MIN_ROW_ITEMS = 3;
const GENRE_ROW_COUNT = 2;

const ITEM_FIELDS = 'PrimaryImageAspectRatio,MediaSourceCount';
const IMAGE_TYPES = 'Primary,Backdrop,Thumb';

function getRecommendationTitle(rec: RecommendationDto) {
    const name = rec.BaselineItemName || '';
    switch (rec.RecommendationType) {
        case 'SimilarToRecentlyPlayed':
            return globalize.translate('RecommendationBecauseYouWatched', name);
        case 'SimilarToLikedItem':
            return globalize.translate('RecommendationBecauseYouLike', name);
        case 'HasDirectorFromRecentlyPlayed':
        case 'HasLikedDirector':
            return globalize.translate('RecommendationDirectedBy', name);
        case 'HasActorFromRecentlyPlayed':
        case 'HasLikedActor':
            return globalize.translate('RecommendationStarring', name);
        default:
            return '';
    }
}

/** Jellyfin's own movie recommendations: "Because you watched", "Starring", ... */
async function getMovieRows(apiClient: ApiClient): Promise<Row[]> {
    const url = apiClient.getUrl('Movies/Recommendations', {
        userId: apiClient.getCurrentUserId(),
        categoryLimit: 4,
        ItemLimit: ROW_ITEM_LIMIT,
        Fields: ITEM_FIELDS,
        ImageTypeLimit: 1,
        EnableImageTypes: IMAGE_TYPES
    });
    const recs: RecommendationDto[] = await apiClient.getJSON(url);
    return recs.map(rec => ({ title: getRecommendationTitle(rec), items: rec.Items || [] }));
}

/** "Because you watched <show>" for the shows watched most recently. */
async function getShowRows(apiClient: ApiClient): Promise<Row[]> {
    const userId = apiClient.getCurrentUserId();
    const recent = await apiClient.getItems(userId, {
        IncludeItemTypes: 'Episode',
        Recursive: true,
        SortBy: 'DatePlayed',
        SortOrder: 'Descending',
        Limit: 30,
        EnableImageTypes: 'Primary',
        EnableTotalRecordCount: false
    });

    const series: { id: string, name: string }[] = [];
    for (const episode of recent.Items || []) {
        if (!episode.UserData?.LastPlayedDate || !episode.SeriesId) continue;
        if (series.some(s => s.id === episode.SeriesId)) continue;
        series.push({ id: episode.SeriesId, name: episode.SeriesName || '' });
        if (series.length === 2) break;
    }

    return Promise.all(series.map(async ({ id, name }) => {
        const similar = await apiClient.getSimilarItems(id, {
            userId,
            limit: ROW_ITEM_LIMIT,
            fields: ITEM_FIELDS,
            EnableImageTypes: IMAGE_TYPES
        });
        return {
            title: globalize.translate('RecommendationBecauseYouWatched', name),
            items: similar.Items || []
        };
    }));
}

/** The best-rated films and shows the user hasn't watched yet. */
async function getTopRatedRow(apiClient: ApiClient): Promise<Row> {
    const result = await apiClient.getItems(apiClient.getCurrentUserId(), {
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        IsPlayed: false,
        SortBy: 'CommunityRating,SortName',
        SortOrder: 'Descending',
        MinCommunityRating: 6,
        Limit: ROW_ITEM_LIMIT,
        Fields: ITEM_FIELDS,
        ImageTypeLimit: 1,
        EnableImageTypes: IMAGE_TYPES,
        EnableTotalRecordCount: false
    });
    return { title: globalize.translate('HeaderTopRated'), items: result.Items || [] };
}

function shuffle<T>(list: T[]) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
        // eslint-disable-next-line sonarjs/pseudo-random -- shuffling rows for variety, not security
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

/** A couple of genre rows ("Thriller", "Comedy", ...) that change on each visit. */
async function getGenreRows(apiClient: ApiClient): Promise<Row[]> {
    const userId = apiClient.getCurrentUserId();
    const genres = await apiClient.getGenres(userId, {
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        EnableTotalRecordCount: false
    });
    const picks = shuffle(genres.Items || []).slice(0, GENRE_ROW_COUNT * 2);

    const rows = await Promise.all(picks.map(async genre => {
        const result = await apiClient.getItems(userId, {
            IncludeItemTypes: 'Movie,Series',
            Recursive: true,
            GenreIds: genre.Id,
            SortBy: 'Random',
            Limit: ROW_ITEM_LIMIT,
            Fields: ITEM_FIELDS,
            ImageTypeLimit: 1,
            EnableImageTypes: IMAGE_TYPES,
            EnableTotalRecordCount: false
        });
        return { title: genre.Name || '', items: result.Items || [] };
    }));

    return rows.filter(row => row.items.length >= MIN_ROW_ITEMS).slice(0, GENRE_ROW_COUNT);
}

/** Run a row source, treating failure as "no rows" so one bad call can't blank the section. */
async function safely<T>(source: () => Promise<T>, fallback: T): Promise<T> {
    try {
        return await source();
    } catch (err) {
        console.error('[HomeRecommendations] row failed to load', err);
        return fallback;
    }
}

function getRowHtml(row: Row, { enableOverflow }: SectionOptions) {
    let html = '<div class="verticalSection homeRecommendationRow">';
    html += `<h2 class="sectionTitle sectionTitle-cards padded-left">${escapeHtml(row.title)}</h2>`;
    if (enableOverflow) {
        html += '<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">';
        html += '<div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x">';
    } else {
        html += '<div is="emby-itemscontainer" class="itemsContainer padded-left padded-right vertical-wrap focuscontainer-x">';
    }

    html += cardBuilder.getCardsHtml({
        items: row.items,
        shape: getBackdropShape(enableOverflow),
        preferThumb: true,
        inheritThumb: false,
        showTitle: true,
        showYear: true,
        centerText: true,
        overlayPlayButton: true,
        allowBottomPadding: false,
        lazy: true,
        context: 'home',
        lines: 2
    });

    if (enableOverflow) {
        html += '</div>';
    }
    html += '</div></div>';
    return html;
}

/**
 * Netflix-style personalised rows: Jellyfin's movie recommendations, shows
 * similar to what was watched last, top rated unwatched titles and genre rows.
 */
export async function loadRecommendations(elem: HTMLElement, apiClient: ApiClient, options: SectionOptions) {
    const [movieRows, showRows, topRated, genreRows] = await Promise.all([
        safely(() => getMovieRows(apiClient), []),
        safely(() => getShowRows(apiClient), []),
        safely(() => getTopRatedRow(apiClient), null),
        safely(() => getGenreRows(apiClient), [])
    ]);

    // Interleave so personal rows lead and generic rows break them up.
    // Suggestions shouldn't repeat things the user has already finished.
    const personal = [...showRows, ...movieRows].map(row => ({
        ...row,
        items: row.items.filter(item => !item.UserData?.Played)
    }));
    const rows: Row[] = [];
    if (personal.length) rows.push(personal.shift() as Row);
    if (topRated) rows.push(topRated);
    if (personal.length) rows.push(personal.shift() as Row);
    rows.push(...genreRows.slice(0, 1), ...personal, ...genreRows.slice(1));

    // Small libraries often produce near-identical rows; show each set of titles once.
    const seen = new Set<string>();
    const visible = rows.filter(row => {
        if (!row.title || row.items.length < MIN_ROW_ITEMS) return false;
        const key = row.items.slice(0, MIN_ROW_ITEMS * 2).map(item => item.Id ?? '').sort((a, b) => a.localeCompare(b)).join();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    if (!visible.length || !elem.isConnected) {
        elem.innerHTML = '';
        return;
    }

    elem.innerHTML = visible.map(row => getRowHtml(row, options)).join('');
    imageLoader.lazyChildren(elem);
}
