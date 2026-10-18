// Scoring a candidate title (SPEC §7.2).
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';

import { type Features, getFeatures } from './features';
import { type TasteProfile, tasteMatch } from './taste';

const DAY_MS = 86400000;
export const FRESH_DAYS = 30;

export const SCORE_WEIGHTS = {
    taste: 0.55,
    quality: 0.2,
    freshness: 0.1,
    household: 0.1,
    exploration: 0.05
};

/** A series with recently added episodes, and when the newest arrived. */
export interface SeriesNews {
    label: 'New Season' | 'New Episodes'
    addedAt: number
}

export interface Trending {
    series: { id: string, viewers: number, plays: number }[]
    movies: { id: string, viewers: number, plays: number }[]
}

export interface ScoreContext {
    profile: TasteProfile
    /** Household viewing over the last week (accounts service), if available. */
    trending: Trending | null
    seriesNews: Map<string, SeriesNews>
    /** Library mean quality, what sparse ratings shrink towards. */
    meanQuality: number
    /** Seed for exploration jitter that changes once a day per profile. */
    daySeed: string
    now: number
}

export interface Scored {
    item: BaseItemDto
    features: Features
    score: number
    taste: number
    quality: number
    freshness: number
    household: number
    /** Rank in the household Top 10 for its type (1-based), if any. */
    trendingRank: number | null
}

/** FNV-1a: a stable 0–1 value per string, so rows rotate daily instead of shuffling on every visit. */
export function stableRandom(text: string) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0) / 0x100000000;
}

/** Community (0–10) and critic (0–100) ratings averaged, shrunk towards the mean when only one or none exist. */
export function quality(item: BaseItemDto, mean: number) {
    const sources: number[] = [];
    if (item.CommunityRating) sources.push(Math.min(1, item.CommunityRating / 10));
    if (item.CriticRating) sources.push(Math.min(1, item.CriticRating / 100));
    const sum = sources.reduce((total, value) => total + value, 0);
    return (sum + mean) / (sources.length + 1);
}

export function meanQuality(items: BaseItemDto[]) {
    const rated = items.filter(item => item.CommunityRating || item.CriticRating);
    if (!rated.length) return 0.65;
    return rated.reduce((total, item) => total + quality(item, 0.65), 0) / rated.length;
}

function freshness(item: BaseItemDto, context: ScoreContext) {
    if (item.Type === 'Series' && item.Id && context.seriesNews.get(item.Id)?.label === 'New Season') return 1;
    if (!item.DateCreated) return 0;
    const days = (context.now - new Date(item.DateCreated).getTime()) / DAY_MS;
    return days >= 0 && days < FRESH_DAYS ? 1 - days / FRESH_DAYS : 0;
}

function trendingList(item: BaseItemDto, trending: Trending | null) {
    if (!trending) return [];
    return item.Type === 'Series' ? trending.series : trending.movies;
}

function household(item: BaseItemDto, trending: Trending | null) {
    const list = trendingList(item, trending);
    const entry = list.find(e => e.id === item.Id);
    if (!entry) return 0;
    const top = Math.max(...list.map(e => e.viewers), 1);
    return entry.viewers / top;
}

function trendingRank(item: BaseItemDto, trending: Trending | null) {
    const index = trendingList(item, trending).findIndex(e => e.id === item.Id);
    return index >= 0 && index < 10 ? index + 1 : null;
}

export function scoreItem(item: BaseItemDto, context: ScoreContext): Scored {
    const features = getFeatures(item);
    const taste = tasteMatch(features, context.profile);
    const q = quality(item, context.meanQuality);
    const fresh = freshness(item, context);
    const house = household(item, context.trending);
    const explore = stableRandom(`${context.daySeed}:${item.Id}`);
    const score = SCORE_WEIGHTS.taste * taste
        + SCORE_WEIGHTS.quality * q
        + SCORE_WEIGHTS.freshness * fresh
        + SCORE_WEIGHTS.household * house
        + SCORE_WEIGHTS.exploration * explore;
    return { item, features, score, taste, quality: q, freshness: fresh, household: house, trendingRank: trendingRank(item, context.trending) };
}

export function byScore(a: Scored, b: Scored) {
    return b.score - a.score;
}
