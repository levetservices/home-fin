import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { RecommendationDto } from '@jellyfin/sdk/lib/generated-client/models/recommendation-dto';
import type { ApiClient } from 'jellyfin-apiclient';

import globalize from 'lib/globalize';

import { ROW_FIELDS, ROW_IMAGE_TYPES } from '../rows/artwork';
import { renderRow, type RowKind } from '../rows/mediaRow';

interface Row {
    title: string
    items: BaseItemDto[]
    kind?: RowKind
    /** Show the row even with few titles (e.g. a short My List). */
    alwaysShow?: boolean
}

const ROW_ITEM_LIMIT = 16;
/** Rows with fewer titles than this look sparse, so they are dropped. */
const MIN_ROW_ITEMS = 3;
const GENRE_ROW_COUNT = 2;

const TOP10_MIN_ITEMS = 5;
const ITEM_FIELDS = ROW_FIELDS;
const IMAGE_TYPES = ROW_IMAGE_TYPES;

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

/** Netflix-style "Top 10": the ten best-rated films and shows in the library. */
async function getTop10Row(apiClient: ApiClient): Promise<Row> {
    const result = await apiClient.getItems(apiClient.getCurrentUserId(), {
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        SortBy: 'CommunityRating,SortName',
        SortOrder: 'Descending',
        HasCommunityRating: true,
        Limit: 10,
        Fields: ITEM_FIELDS,
        ImageTypeLimit: 1,
        EnableImageTypes: IMAGE_TYPES,
        EnableTotalRecordCount: false
    });
    return { title: globalize.translate('HeaderTop10'), items: result.Items || [], kind: 'top10' };
}

/** "My List": the user's favourite films and shows, most recently added first. */
async function getMyListRow(apiClient: ApiClient): Promise<Row> {
    const result = await apiClient.getItems(apiClient.getCurrentUserId(), {
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        Filters: 'IsFavorite',
        SortBy: 'DateCreated',
        SortOrder: 'Descending',
        Limit: ROW_ITEM_LIMIT,
        Fields: ITEM_FIELDS,
        ImageTypeLimit: 1,
        EnableImageTypes: IMAGE_TYPES,
        EnableTotalRecordCount: false
    });
    return { title: globalize.translate('HeaderMyList'), items: result.Items || [] };
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

/**
 * Netflix-style personalised rows: "Because you watched…", Top 10, My List,
 * and genre rows. Each row is rendered into its own child element.
 */
export async function loadRecommendations(elem: HTMLElement, apiClient: ApiClient) {
    const [movieRows, showRows, top10, myList, genreRows] = await Promise.all([
        safely(() => getMovieRows(apiClient), []),
        safely(() => getShowRows(apiClient), []),
        safely(() => getTop10Row(apiClient), null),
        safely(() => getMyListRow(apiClient), null),
        safely(() => getGenreRows(apiClient), [])
    ]);

    // Interleave so personal rows lead and generic rows break them up.
    // Suggestions shouldn't repeat things the user has already finished.
    const personal = [...showRows, ...movieRows].map(row => ({
        ...row,
        items: row.items.filter(item => !item.UserData?.Played)
    }));
    const rows: Row[] = [];
    if (myList) rows.push({ ...myList, alwaysShow: true });
    if (personal.length) rows.push(personal.shift() as Row);
    if (top10 && top10.items.length >= TOP10_MIN_ITEMS) rows.push(top10);
    if (personal.length) rows.push(personal.shift() as Row);
    rows.push(...genreRows.slice(0, 1), ...personal, ...genreRows.slice(1));

    // Small libraries often produce near-identical rows; show each set of titles once.
    const seen = new Set<string>();
    const visible = rows.filter(row => {
        if (!row.title || !row.items.length) return false;
        if (row.alwaysShow || row.kind === 'top10') return true;
        if (row.items.length < MIN_ROW_ITEMS) return false;
        const key = row.items.slice(0, MIN_ROW_ITEMS * 2).map(item => item.Id ?? '').sort((a, b) => a.localeCompare(b)).join();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    if (!elem.isConnected) return;
    elem.innerHTML = '';
    for (const row of visible) {
        const rowElem = document.createElement('div');
        elem.appendChild(rowElem);
        renderRow(rowElem, row, apiClient);
    }
}
