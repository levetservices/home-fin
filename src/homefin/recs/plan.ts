// Turning scores into the home screen (SPEC §7.3): billboard, then rows in page order.
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';

import { similarity } from './features';
import { type ScoreContext, type Scored, byScore, scoreItem } from './score';
import { type TasteProfile, type TitleSignal, hasTaste, topFeatures } from './taste';

const DAY_MS = 86400000;
const ROW_LIMIT = 16;
/** Rows with fewer titles than this look broken, so they are dropped. */
export const MIN_ROW_ITEMS = 3;
const TOP10_MIN_ITEMS = 5;
/** A title may appear in at most this many rows (billboard included; Top 10 and My List don't count). */
const MAX_APPEARANCES = 2;
const BECAUSE_ROWS = 2;
const GENRE_ROWS = 3;
const ACCLAIMED_QUALITY = 0.72;
const WATCH_AGAIN_DAYS = 60;
const NEW_DAYS = 30;
const LOVE_THRESHOLD = 0.25;
const STAR_THRESHOLD = 0.5;
const SIMILAR_THRESHOLD = 0.12;

export interface PlannedRow {
    title: string
    items: BaseItemDto[]
    kind?: 'top10'
    /** Show however few titles it has (My List). */
    alwaysShow?: boolean
}

export interface Billboard {
    item: BaseItemDto
    reasons: string[]
}

export interface HomePlan {
    billboard: Billboard | null
    rows: PlannedRow[]
    top10: BaseItemDto[]
}

export interface PlanInput {
    /** Every film and series the profile can see, with UserData and feature fields. */
    catalogue: BaseItemDto[]
    context: ScoreContext
    profileName: string
    /** Jellyfin's "similar" titles for the profile's most recent titles, keyed by that title's id. */
    similarBySeed: Map<string, BaseItemDto[]>
}

/** Genre → the phrase Netflix-style row titles use ("Critically Acclaimed Witty Series"). */
const GENRE_PHRASES: Record<string, string> = {
    'action': 'Exciting Action',
    'adventure': 'Exciting Adventure',
    'animation': 'Imaginative Animated',
    'comedy': 'Witty',
    'crime': 'Gritty Crime',
    'documentary': 'Fascinating Documentary',
    'drama': 'Emotional',
    'family': 'Feel-Good Family',
    'fantasy': 'Imaginative Fantasy',
    'history': 'Epic Historical',
    'horror': 'Scary',
    'music': 'Uplifting Music',
    'mystery': 'Intriguing Mystery',
    'romance': 'Romantic',
    'science fiction': 'Mind-Bending Sci-Fi',
    'sci-fi': 'Mind-Bending Sci-Fi',
    'thriller': 'Suspenseful',
    'war': 'Gritty War',
    'western': 'Rugged Western'
};

export function genreRowTitle(genre: string, kind: 'Series' | 'Films', acclaimed: boolean) {
    const phrase = GENRE_PHRASES[genre.toLowerCase()] || genre;
    return `${acclaimed ? 'Critically Acclaimed ' : ''}${phrase} ${kind}`;
}

function isRecent(date: string | null | undefined, days: number, now: number) {
    if (!date) return false;
    const age = now - new Date(date).getTime();
    return age >= 0 && age <= days * DAY_MS;
}

/** Keeps a title to MAX_APPEARANCES rows. */
class Appearances {
    private counts = new Map<string, number>();

    take(items: BaseItemDto[], limit = ROW_LIMIT) {
        const picked = items.filter(item => (this.counts.get(item.Id || '') || 0) < MAX_APPEARANCES).slice(0, limit);
        this.count(picked);
        return picked;
    }

    count(items: BaseItemDto[]) {
        for (const item of items) this.counts.set(item.Id || '', (this.counts.get(item.Id || '') || 0) + 1);
    }
}

function billboardReasons(pick: Scored, context: ScoreContext): string[] {
    const reasons: string[] = [];
    if (pick.taste >= LOVE_THRESHOLD) reasons.push('👍 We think you\'ll love this!');
    const star = pick.features.cast
        .map(name => ({ name, strength: context.profile.values.cast[name] || 0 }))
        .sort((a, b) => b.strength - a.strength)[0];
    if (star && star.strength >= STAR_THRESHOLD) reasons.push(`🎬 Starring ${star.name}`);
    if (pick.trendingRank) reasons.push(`🔥 #${pick.trendingRank} in ${pick.item.Type === 'Series' ? 'Series' : 'Films'} Today`);
    if (pick.item.Type === 'Series' && context.seriesNews.get(pick.item.Id || '')?.label === 'New Season') reasons.push('✨ New Season');
    else if (pick.freshness > 0) reasons.push('✨ New on Home Fin');
    return reasons.slice(0, 2);
}

function pickBillboard(scored: Scored[], context: ScoreContext): Billboard | null {
    const withArt = scored.filter(s => s.item.BackdropImageTags?.length);
    const pick = withArt.find(s => s.item.ImageTags?.Logo) || withArt[0];
    return pick ? { item: pick.item, reasons: billboardReasons(pick, context) } : null;
}

function top10Rows(catalogue: BaseItemDto[], visible: (item: BaseItemDto) => boolean, context: ScoreContext): PlannedRow[] {
    const byId = new Map(catalogue.map(item => [item.Id, item]));
    const fromTrending = (list: { id: string }[]) => list.map(entry => byId.get(entry.id)).filter((item): item is BaseItemDto => !!item && visible(item)).slice(0, 10);
    const series = fromTrending(context.trending?.series || []);
    const movies = fromTrending(context.trending?.movies || []);

    const rows: PlannedRow[] = [];
    if (series.length >= TOP10_MIN_ITEMS) rows.push({ title: 'Top 10 Series on Home Fin Today', items: series, kind: 'top10' });
    if (movies.length >= TOP10_MIN_ITEMS) rows.push({ title: 'Top 10 Films on Home Fin Today', items: movies, kind: 'top10' });
    if (rows.length) return rows;

    // Not enough household viewing yet: what the household watched, topped up with the best rated.
    const seen = new Set([...series, ...movies].map(item => item.Id));
    const best = catalogue
        .filter(item => visible(item) && !seen.has(item.Id))
        .map(item => ({ item, quality: scoreItem(item, context).quality }))
        .sort((a, b) => b.quality - a.quality)
        .map(entry => entry.item);
    const items = [...series, ...movies, ...best].slice(0, 10);
    const title = seen.size ? 'Top 10 on Home Fin Today' : 'Top 10 on Home Fin';
    return items.length >= TOP10_MIN_ITEMS ? [{ title, items, kind: 'top10' }] : [];
}

function becauseYouWatchedRows(seeds: TitleSignal[], candidates: Scored[], input: PlanInput, appearances: Appearances): PlannedRow[] {
    const rows: PlannedRow[] = [];
    const byId = new Map(candidates.map(s => [s.item.Id, s]));
    for (const seed of seeds) {
        const fromJellyfin = (input.similarBySeed.get(seed.id) || []).map(item => byId.get(item.Id)).filter((s): s is Scored => !!s);
        const pool = new Map(fromJellyfin.map(s => [s.item.Id, s]));
        // Top up from our own feature similarity (Jellyfin's can be empty on small libraries).
        for (const s of candidates) {
            if (pool.size >= ROW_LIMIT) break;
            if (s.item.Id !== seed.id && !pool.has(s.item.Id) && similarity(seed.features, s.features) >= SIMILAR_THRESHOLD) pool.set(s.item.Id, s);
        }
        const ranked = [...pool.values()]
            .filter(s => s.item.Id !== seed.id)
            .map(s => ({ s, rank: 0.6 * similarity(seed.features, s.features) + 0.4 * s.score }))
            .sort((a, b) => b.rank - a.rank)
            .map(entry => entry.s.item);
        const items = appearances.take(ranked);
        if (items.length >= MIN_ROW_ITEMS) rows.push({ title: `Because you watched ${seed.name}`, items });
        if (rows.length === BECAUSE_ROWS) break;
    }
    return rows;
}

/** The library's most common genres (for profiles with no taste yet). */
function commonGenres(catalogue: BaseItemDto[]) {
    const counts = new Map<string, number>();
    for (const item of catalogue) {
        for (const genre of item.Genres || []) counts.set(genre, (counts.get(genre) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([genre]) => genre);
}

/** A genre's candidates as one row: series or films (whichever has more), the acclaimed ones if enough. */
function genrePool(genre: string, candidates: Scored[]) {
    const pool = candidates.filter(s => s.features.genre.includes(genre));
    const series = pool.filter(s => s.item.Type === 'Series');
    const films = pool.filter(s => s.item.Type !== 'Series');
    const [kind, items] = series.length >= films.length ? ['Series', series] as const : ['Films', films] as const;
    const acclaimed = items.filter(s => s.quality >= ACCLAIMED_QUALITY);
    const useAcclaimed = acclaimed.length >= MIN_ROW_ITEMS + 1;
    return {
        title: genreRowTitle(genre, kind, useAcclaimed),
        items: (useAcclaimed ? acclaimed : items).map(s => s.item)
    };
}

function genreRows(candidates: Scored[], profile: TasteProfile, catalogue: BaseItemDto[], appearances: Appearances): PlannedRow[] {
    const favourites = topFeatures(profile, 'genre', 8);
    const genres = favourites.length ? favourites : commonGenres(catalogue);

    const rows: PlannedRow[] = [];
    const titles = new Set<string>();
    for (const genre of genres) {
        const { title, items } = genrePool(genre, candidates);
        if (titles.has(title)) continue;
        const picked = appearances.take(items);
        if (picked.length < MIN_ROW_ITEMS) continue;
        titles.add(title);
        rows.push({ title, items: picked });
        if (rows.length === GENRE_ROWS) break;
    }
    return rows;
}

function starringRow(profile: TasteProfile, catalogue: BaseItemDto[], scoreOf: Map<string | null | undefined, number>, visible: (item: BaseItemDto) => boolean, appearances: Appearances): PlannedRow | null {
    for (const actor of topFeatures(profile, 'cast', 5)) {
        const titles = catalogue
            .filter(item => visible(item) && (item.People || []).some(p => p.Type === 'Actor' && p.Name === actor))
            // Unwatched first, then by score.
            .sort((a, b) => Number(!!a.UserData?.Played) - Number(!!b.UserData?.Played) || (scoreOf.get(b.Id) || 0) - (scoreOf.get(a.Id) || 0));
        const items = appearances.take(titles);
        if (items.length >= MIN_ROW_ITEMS) return { title: `Starring ${actor}`, items };
    }
    return null;
}

function watchAgainRow(profile: TasteProfile, catalogue: BaseItemDto[], visible: (item: BaseItemDto) => boolean, now: number, appearances: Appearances): PlannedRow | null {
    const byId = new Map(catalogue.map(item => [item.Id, item]));
    const items = profile.titles
        .filter(title => (title.loved || title.weight >= 1.5) && title.lastPlayed && now - title.lastPlayed > WATCH_AGAIN_DAYS * DAY_MS)
        .map(title => byId.get(title.id))
        .filter((item): item is BaseItemDto => !!item && visible(item) && !!item.UserData?.Played);
    const picked = appearances.take(items);
    return picked.length >= MIN_ROW_ITEMS ? { title: 'Watch It Again', items: picked } : null;
}

/** Build the whole home screen from the catalogue, taste and household data. */
export function planHome(input: PlanInput): HomePlan {
    const { catalogue, context, profileName } = input;
    const { profile, now } = context;
    const hidden = new Set(profile.hidden);
    const visible = (item: BaseItemDto) => !hidden.has(item.Id || '') && item.UserData?.Likes !== false;
    const lastWatched = new Map(profile.titles.filter(t => t.lastPlayed || t.finished).map(t => [t.id, t.lastPlayed || 0]));

    // Candidates: unwatched films, untouched series, and series with a season added since you last watched.
    const isCandidate = (item: BaseItemDto) => {
        if (!visible(item)) return false;
        if (item.Type === 'Series') {
            const last = lastWatched.get(item.Id || '');
            const news = context.seriesNews.get(item.Id || '');
            return last === undefined || (news?.label === 'New Season' && news.addedAt > last);
        }
        return !item.UserData?.Played && !item.UserData?.PlaybackPositionTicks;
    };
    const scored = catalogue.filter(isCandidate).map(item => scoreItem(item, context)).sort(byScore);
    const scoreOf = new Map(scored.map(s => [s.item.Id, s.score]));
    const appearances = new Appearances();

    const billboard = pickBillboard(scored, context);
    if (billboard) appearances.count([billboard.item]);

    const rows: PlannedRow[] = [];
    // Small libraries: Top Picks takes at most half the candidates so later rows have something left.
    const topPicksLimit = Math.max(MIN_ROW_ITEMS * 2, Math.min(ROW_LIMIT, Math.ceil(scored.length / 2)));
    const topPicks = appearances.take(scored.map(s => s.item), topPicksLimit);
    if (topPicks.length >= MIN_ROW_ITEMS) rows.push({ title: profileName ? `Top Picks for ${profileName}` : 'Top Picks for You', items: topPicks });

    // Top 10 and My List repeat titles freely (as on Netflix); they don't count towards the limit.
    const top10 = top10Rows(catalogue, visible, context);
    rows.push(...top10);

    if (hasTaste(profile)) {
        const seeds = profile.titles.filter(t => t.lastPlayed && !t.disliked).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
        rows.push(...becauseYouWatchedRows(seeds, scored, input, appearances));
    }

    rows.push(...genreRows(scored, profile, catalogue, appearances));

    const myList = catalogue
        .filter(item => item.UserData?.IsFavorite)
        .sort((a, b) => (b.DateCreated || '').localeCompare(a.DateCreated || ''));
    if (myList.length) {
        rows.push({ title: 'My List', items: myList.slice(0, ROW_LIMIT), alwaysShow: true });
    }

    const fresh = appearances.take(catalogue
        .filter(item => visible(item) && !item.UserData?.Played && isRecent(item.DateCreated, NEW_DAYS, now))
        .sort((a, b) => (b.DateCreated || '').localeCompare(a.DateCreated || '')));
    if (fresh.length >= MIN_ROW_ITEMS) rows.push({ title: 'New on Home Fin', items: fresh });

    const starring = starringRow(profile, catalogue, scoreOf, visible, appearances);
    if (starring) rows.push(starring);

    const again = watchAgainRow(profile, catalogue, visible, now, appearances);
    if (again) rows.push(again);

    return { billboard, rows, top10: top10.flatMap(row => row.items) };
}
