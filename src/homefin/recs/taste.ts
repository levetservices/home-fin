// A profile's taste (SPEC §7.1): weighted, time-decayed features of what it watched and rated.
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';

import { FAMILIES, FAMILY_WEIGHTS, type Family, type Features, getFeatures } from './features';

const DAY_MS = 86400000;
export const HALF_LIFE_DAYS = 45;

export const WEIGHTS = {
    finished: 1,
    partialMin: 0.2,
    rewatchStep: 0.3,
    rewatchCap: 2,
    favourite: 1.5,
    like: 2,
    dislike: -3
};

/** What the profile did with one title (a film, or a series with its episodes rolled up). */
export interface TitleSignal {
    id: string
    name: string
    type: 'Movie' | 'Series'
    features: Features
    weight: number
    lastPlayed: number | null
    finished: boolean
    loved: boolean
    disliked: boolean
}

export interface TasteProfile {
    /** Per family, feature → normalised strength in [-1, 1]. */
    values: Record<Family, Record<string, number>>
    /** Titles with any signal, strongest first. */
    titles: TitleSignal[]
    /** Ids never to recommend (thumbs down). */
    hidden: string[]
    builtAt: number
}

export interface History {
    /** Finished films and episodes (with UserData), most recent first. */
    played: BaseItemDto[]
    /** Part-watched films and episodes. */
    resumable: BaseItemDto[]
    favourites: BaseItemDto[]
    likes: BaseItemDto[]
    dislikes: BaseItemDto[]
    /** Series (with features) for every episode above. */
    series: BaseItemDto[]
}

export function decay(date: string | number | null | undefined, now: number) {
    if (!date) return 1;
    const time = typeof date === 'number' ? date : new Date(date).getTime();
    if (!Number.isFinite(time)) return 1;
    const days = Math.max(0, (now - time) / DAY_MS);
    return 0.5 ** (days / HALF_LIFE_DAYS);
}

function playedTime(item: BaseItemDto) {
    const date = item.UserData?.LastPlayedDate;
    return date ? new Date(date).getTime() : null;
}

function rewatchFactor(item: BaseItemDto) {
    const extra = Math.max(0, (item.UserData?.PlayCount || 1) - 1);
    return Math.min(WEIGHTS.rewatchCap, 1 + WEIGHTS.rewatchStep * extra);
}

function partialWeight(item: BaseItemDto) {
    return Math.max(WEIGHTS.partialMin, (item.UserData?.PlayedPercentage || 0) / 100);
}

/** Accumulates one signal per film / series from individual plays and ratings. */
class SignalCollector {
    private titles = new Map<string, TitleSignal>();
    /** Episode weight per series, log-scaled at the end so one binge doesn't drown everything. */
    private episodes = new Map<string, { total: number, last: number | null }>();
    private seriesById: Map<string, BaseItemDto>;

    constructor(series: BaseItemDto[], private now: number) {
        this.seriesById = new Map(series.map(s => [s.Id || '', s]));
    }

    private titleFor(item: BaseItemDto): TitleSignal | null {
        const source = item.Type === 'Episode' ? this.seriesById.get(item.SeriesId || '') : item;
        if (!source?.Id || (source.Type !== 'Movie' && source.Type !== 'Series')) return null;
        let title = this.titles.get(source.Id);
        if (!title) {
            title = {
                id: source.Id,
                name: source.Name || '',
                type: source.Type,
                features: getFeatures(source),
                weight: 0,
                lastPlayed: null,
                finished: false,
                loved: false,
                disliked: false
            };
            this.titles.set(source.Id, title);
        }
        return title;
    }

    private addEpisode(episode: BaseItemDto, amount: number) {
        const title = this.titleFor(episode);
        if (!title) return;
        const when = playedTime(episode);
        noteLastPlayed(title, when);
        const entry = this.episodes.get(title.id) || { total: 0, last: null };
        entry.total += amount;
        if (when && (!entry.last || when > entry.last)) entry.last = when;
        this.episodes.set(title.id, entry);
    }

    /** A finished film or episode. */
    finished(item: BaseItemDto) {
        if (item.Type === 'Episode') {
            this.addEpisode(item, rewatchFactor(item));
            return;
        }
        const title = this.titleFor(item);
        if (!title) return;
        noteLastPlayed(title, playedTime(item));
        title.finished = true;
        title.weight += WEIGHTS.finished * rewatchFactor(item) * decay(playedTime(item), this.now);
    }

    /** A part-watched film or episode. */
    partial(item: BaseItemDto) {
        if (item.Type === 'Episode') {
            this.addEpisode(item, partialWeight(item));
            return;
        }
        const title = this.titleFor(item);
        if (!title) return;
        noteLastPlayed(title, playedTime(item));
        title.weight += partialWeight(item) * decay(playedTime(item), this.now);
    }

    /** My List, thumbs up or thumbs down: not decayed, they are deliberate. */
    rated(item: BaseItemDto, weight: number) {
        const title = this.titleFor(item);
        if (!title) return;
        title.weight += weight;
        if (weight > 0) title.loved = true;
        else title.disliked = true;
    }

    result() {
        for (const [id, { total, last }] of this.episodes) {
            const title = this.titles.get(id);
            if (title) title.weight += Math.log2(1 + total) * decay(last, this.now);
        }
        return [...this.titles.values()].sort((a, b) => b.weight - a.weight);
    }
}

function noteLastPlayed(title: TitleSignal, when: number | null) {
    if (when && (!title.lastPlayed || when > title.lastPlayed)) title.lastPlayed = when;
}

/** Roll the history up to one signal per film / series. */
export function collectSignals(history: History, now = Date.now()): TitleSignal[] {
    const collector = new SignalCollector(history.series, now);
    for (const item of history.played) collector.finished(item);
    for (const item of history.resumable) collector.partial(item);
    for (const item of history.favourites) collector.rated(item, WEIGHTS.favourite);
    for (const item of history.likes) collector.rated(item, WEIGHTS.like);
    for (const item of history.dislikes) collector.rated(item, WEIGHTS.dislike);
    return collector.result();
}

/** Scale likes by the strongest like and dislikes by whichever is stronger, in place. */
function normalise(values: Record<string, number>) {
    const all = Object.values(values);
    const maxLike = Math.max(0, ...all);
    const maxDislike = Math.max(maxLike, ...all.map(v => -v));
    for (const [key, value] of Object.entries(values)) {
        if (value > 0) values[key] = value / maxLike;
        else if (value < 0) values[key] = value / maxDislike;
    }
}

/**
 * Families a thumbs-down counts against. "Not for me" is about what a title is (its genres,
 * people, themes), not about every film from the same decade.
 */
const DISLIKE_FAMILIES = new Set<Family>(['genre', 'cast', 'director', 'tag']);

/**
 * Sum each title's weight onto its features, then scale each family into [-1, 1]:
 * likes by the strongest like, dislikes by whichever is stronger, so one thumbs-down
 * can't flatten everything the profile actually watched.
 */
export function buildProfile(titles: TitleSignal[], now = Date.now()): TasteProfile {
    const values = Object.fromEntries(FAMILIES.map(f => [f, {}])) as Record<Family, Record<string, number>>;
    for (const title of titles) {
        for (const family of FAMILIES) {
            if (title.weight < 0 && !DISLIKE_FAMILIES.has(family)) continue;
            for (const key of title.features[family]) {
                values[family][key] = (values[family][key] || 0) + title.weight;
            }
        }
    }
    for (const family of FAMILIES) normalise(values[family]);
    return {
        values,
        titles,
        hidden: titles.filter(t => t.disliked).map(t => t.id),
        builtAt: now
    };
}

/** How well a title matches the taste, -1 to 1 (families it has no features in don't count). */
export function tasteMatch(features: Features, profile: TasteProfile) {
    let score = 0;
    let weight = 0;
    for (const family of FAMILIES) {
        const keys = features[family];
        if (!keys.length) continue;
        const strengths = keys.map(key => profile.values[family][key] || 0);
        score += FAMILY_WEIGHTS[family] * (strengths.reduce((sum, v) => sum + v, 0) / keys.length);
        weight += FAMILY_WEIGHTS[family];
    }
    return weight ? score / weight : 0;
}

/** Strongest features of a family, e.g. the profile's favourite genres or actors. */
export function topFeatures(profile: TasteProfile, family: Family, count: number) {
    return Object.entries(profile.values[family])
        .filter(([, value]) => value > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, count)
        .map(([key]) => key);
}

/** True once the profile has watched or rated enough to personalise anything. */
export function hasTaste(profile: TasteProfile) {
    return profile.titles.some(title => title.weight > 0);
}
