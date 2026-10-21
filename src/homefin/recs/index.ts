// Home Fin recommendations (SPEC §7): fetches what the engine needs from Jellyfin and the
// accounts service, caches the taste profile, and plans the home screen.
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { ApiClient } from 'jellyfin-apiclient';

import { accountsApi, isAccountsEnabled } from 'homefin/accounts/api';
import { getCurrentProfile } from 'homefin/accounts/session';
import { getSeriesNews, loadSeriesNews } from 'homefin/ui/badges';

import { FEATURE_FIELDS, getFeatures, similarity } from './features';
import { type HomePlan, planHome } from './plan';
import { type ScoreContext, type Trending, meanQuality } from './score';
import { type History, type TasteProfile, buildProfile, collectSignals } from './taste';

export type { BillboardReason, HomePlan, PlannedRow } from './plan';

const TASTE_TTL_MS = 30 * 60 * 1000;
const CATALOGUE_TTL_MS = 10 * 60 * 1000;
const HISTORY_LIMIT = 300;
// Each title carries its cast list, so keep this modest for big libraries on small servers.
const CATALOGUE_TOP_RATED = 800;
const CATALOGUE_NEWEST = 200;
const SEED_COUNT = 3;
const SIMILAR_LIMIT = 16;
const TASTE_KEY = 'homefin_taste_v1_';

/** Fields every catalogue title carries: what cards, previews and the engine read. */
export const CATALOGUE_FIELDS = `${FEATURE_FIELDS},Overview,OfficialRating,CommunityRating,CriticRating,RunTimeTicks,ChildCount,DateCreated,PrimaryImageAspectRatio,MediaSourceCount`;
const IMAGE_TYPES = 'Primary,Backdrop,Thumb,Logo';

let catalogueCache: { userId: string, at: number, promise: Promise<BaseItemDto[]> } | null = null;

// ── catalogue ────────────────────────────────────────────────────────────

async function fetchCatalogue(apiClient: ApiClient) {
    const userId = apiClient.getCurrentUserId();
    const base = {
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        Fields: CATALOGUE_FIELDS,
        ImageTypeLimit: 1,
        EnableImageTypes: IMAGE_TYPES,
        EnableTotalRecordCount: false
    };
    // Big libraries: the best rated plus the newest is plenty to recommend from.
    const [rated, newest] = await Promise.all([
        apiClient.getItems(userId, { ...base, SortBy: 'CommunityRating,SortName', SortOrder: 'Descending', Limit: CATALOGUE_TOP_RATED }),
        apiClient.getItems(userId, { ...base, SortBy: 'DateCreated', SortOrder: 'Descending', Limit: CATALOGUE_NEWEST })
    ]);
    const byId = new Map<string, BaseItemDto>();
    for (const item of [...(rated.Items || []), ...(newest.Items || [])]) {
        if (item.Id) byId.set(item.Id, item);
    }
    return [...byId.values()];
}

function getCatalogue(apiClient: ApiClient) {
    const userId = apiClient.getCurrentUserId();
    if (catalogueCache?.userId === userId && Date.now() - catalogueCache.at < CATALOGUE_TTL_MS) return catalogueCache.promise;
    const promise = fetchCatalogue(apiClient);
    catalogueCache = { userId, at: Date.now(), promise };
    promise.catch(() => {
        catalogueCache = null;
    });
    return promise;
}

// ── taste ────────────────────────────────────────────────────────────────

async function fetchHistory(apiClient: ApiClient): Promise<History> {
    const userId = apiClient.getCurrentUserId();
    const query = (extra: Record<string, unknown>) => apiClient.getItems(userId, {
        Recursive: true,
        Fields: FEATURE_FIELDS,
        EnableImages: false,
        EnableTotalRecordCount: false,
        ...extra
    }).then(result => result.Items || []);

    const [played, resumable, favourites, likes, dislikes] = await Promise.all([
        query({ IncludeItemTypes: 'Movie,Episode', Filters: 'IsPlayed', SortBy: 'DatePlayed', SortOrder: 'Descending', Limit: HISTORY_LIMIT }),
        query({ IncludeItemTypes: 'Movie,Episode', Filters: 'IsResumable', SortBy: 'DatePlayed', SortOrder: 'Descending', Limit: 100 }),
        query({ IncludeItemTypes: 'Movie,Series', Filters: 'IsFavorite', Limit: 200 }),
        query({ IncludeItemTypes: 'Movie,Series,Episode', Filters: 'Likes', Limit: 200 }),
        query({ IncludeItemTypes: 'Movie,Series,Episode', Filters: 'Dislikes', Limit: 200 })
    ]);

    // Episodes roll up into their series, which carry the features.
    const seriesIds = [...new Set([...played, ...resumable, ...likes, ...dislikes]
        .filter(item => item.Type === 'Episode' && item.SeriesId)
        .map(item => item.SeriesId as string))];
    const series: BaseItemDto[] = [];
    for (let i = 0; i < seriesIds.length; i += 100) {
        series.push(...await query({ Ids: seriesIds.slice(i, i + 100).join(',') }));
    }
    return { played, resumable, favourites, likes, dislikes, series };
}

function readCachedTaste(userId: string): TasteProfile | null {
    try {
        const raw = sessionStorage.getItem(TASTE_KEY + userId);
        const profile = raw ? JSON.parse(raw) as TasteProfile : null;
        return profile && Date.now() - profile.builtAt < TASTE_TTL_MS ? profile : null;
    } catch {
        return null;
    }
}

function writeCachedTaste(userId: string, profile: TasteProfile) {
    try {
        sessionStorage.setItem(TASTE_KEY + userId, JSON.stringify(profile));
    } catch {
        // Storage full or blocked: the profile is simply rebuilt next time.
    }
}

export async function getTasteProfile(apiClient: ApiClient) {
    const userId = apiClient.getCurrentUserId();
    const cached = readCachedTaste(userId);
    if (cached) return cached;
    const now = Date.now();
    const profile = buildProfile(collectSignals(await fetchHistory(apiClient), now), now);
    writeCachedTaste(userId, profile);
    return profile;
}

/** Forget cached taste and catalogue, e.g. after a thumbs up / down, so the next Home reflects it. */
export function forgetTaste(apiClient: ApiClient) {
    catalogueCache = null;
    try {
        sessionStorage.removeItem(TASTE_KEY + apiClient.getCurrentUserId());
    } catch {
        // nothing cached
    }
}

// ── household ────────────────────────────────────────────────────────────

async function getTrending(): Promise<Trending | null> {
    try {
        if (!getCurrentProfile() || !(await isAccountsEnabled())) return null;
        return await accountsApi.trending();
    } catch {
        return null;
    }
}

function dayKey(now: number) {
    return new Date(now).toISOString().slice(0, 10);
}

// ── public API ───────────────────────────────────────────────────────────

/** Everything the home screen shows from the recommender: billboard, rows and the Top 10. */
export async function buildHomePlan(apiClient: ApiClient, profileName: string): Promise<HomePlan> {
    const now = Date.now();
    const [catalogue, profile, trending] = await Promise.all([
        getCatalogue(apiClient),
        getTasteProfile(apiClient),
        getTrending(),
        loadSeriesNews(apiClient)
    ]);

    const seeds = profile.titles
        .filter(title => title.lastPlayed && !title.disliked)
        .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))
        .slice(0, SEED_COUNT);
    const similar = await Promise.all(seeds.map(async (seed): Promise<[string, BaseItemDto[]]> => {
        const result = await apiClient.getSimilarItems(seed.id, {
            userId: apiClient.getCurrentUserId(),
            limit: SIMILAR_LIMIT,
            fields: CATALOGUE_FIELDS
        }).catch(() => null);
        return [seed.id, result?.Items || []];
    }));

    const context: ScoreContext = {
        profile,
        trending,
        seriesNews: getSeriesNews(),
        meanQuality: meanQuality(catalogue),
        daySeed: `${apiClient.getCurrentUserId()}:${dayKey(now)}`,
        now
    };
    return planHome({ catalogue, context, profileName, similarBySeed: new Map(similar) });
}

/**
 * "More Like This": Jellyfin's similar titles, topped up from the catalogue by feature
 * similarity (Jellyfin's list can be short or empty on small libraries).
 */
export async function getMoreLikeThis(item: BaseItemDto, apiClient: ApiClient, limit: number, fields: string) {
    const fromJellyfin = await apiClient.getSimilarItems(item.Id || '', {
        userId: apiClient.getCurrentUserId(),
        limit,
        fields
    }).then(result => result.Items || []).catch(() => [] as BaseItemDto[]);

    const result = fromJellyfin.filter(similar => similar.UserData?.Likes !== false);
    if (result.length >= limit) return result.slice(0, limit);

    const seen = new Set([item.Id, ...result.map(similar => similar.Id)]);
    const seed = getFeatures(item);
    const extra = (await getCatalogue(apiClient))
        .filter(other => !seen.has(other.Id) && other.UserData?.Likes !== false)
        .map(other => ({ other, score: similarity(seed, getFeatures(other)) }))
        .filter(entry => entry.score > 0.1)
        .sort((a, b) => b.score - a.score)
        .map(entry => entry.other);
    return [...result, ...extra].slice(0, limit);
}
