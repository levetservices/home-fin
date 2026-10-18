import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { describe, expect, it } from 'vitest';

import { getRatingBand } from '../ui/rating';

import { getFeatures, similarity } from './features';
import { genreRowTitle, planHome } from './plan';
import { type ScoreContext, meanQuality, quality, stableRandom } from './score';
import { type History, buildProfile, collectSignals, decay, tasteMatch, topFeatures } from './taste';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 18);

function ago(days: number) {
    return new Date(NOW - days * DAY).toISOString();
}

let nextId = 1;
function title(fields: Partial<BaseItemDto> & { cast?: string[] }): BaseItemDto {
    const { cast = [], ...rest } = fields;
    return {
        Id: `id${nextId++}`,
        Type: 'Movie',
        Name: 'Untitled',
        Genres: [],
        Tags: [],
        Studios: [],
        People: cast.map(Name => ({ Name, Type: 'Actor' })),
        ProductionYear: 2020,
        DateCreated: ago(400),
        UserData: {},
        BackdropImageTags: ['b'],
        ImageTags: { Logo: 'l' },
        ...rest
    } as BaseItemDto;
}

function emptyHistory(): History {
    return { played: [], resumable: [], favourites: [], likes: [], dislikes: [], series: [] };
}

function context(history: History, extra: Partial<ScoreContext> = {}): ScoreContext {
    return {
        profile: buildProfile(collectSignals(history, NOW), NOW),
        trending: null,
        seriesNews: new Map(),
        meanQuality: 0.65,
        daySeed: 'test',
        now: NOW,
        ...extra
    };
}

describe('taste profile', () => {
    it('halves a signal every 45 days', () => {
        expect(decay(NOW, NOW)).toBe(1);
        expect(decay(NOW - 45 * DAY, NOW)).toBeCloseTo(0.5);
        expect(decay(null, NOW)).toBe(1);
    });

    it('rolls episodes up into their series, log-scaled', () => {
        const show = title({ Type: 'Series', Name: 'Remains', Genres: ['Crime'] });
        const episodes = Array.from({ length: 7 }, () => title({ Type: 'Episode', SeriesId: show.Id, UserData: { LastPlayedDate: ago(0), PlayCount: 1 } }));
        const [signal] = collectSignals({ ...emptyHistory(), played: episodes, series: [show] }, NOW);
        expect(signal.id).toBe(show.Id);
        expect(signal.weight).toBeCloseTo(3); // log2(1 + 7)
    });

    it('caps re-watches and marks thumbs down as hidden', () => {
        const film = title({ UserData: { LastPlayedDate: ago(0), PlayCount: 10 } });
        const disliked = title({ Name: 'Nope' });
        const signals = collectSignals({ ...emptyHistory(), played: [film], dislikes: [disliked] }, NOW);
        expect(signals.find(s => s.id === film.Id)?.weight).toBeCloseTo(2);
        const profile = buildProfile(signals, NOW);
        expect(profile.hidden).toEqual([disliked.Id]);
    });

    it('prefers what was watched and keeps values within [-1, 1]', () => {
        const crime = title({ Genres: ['Crime'], cast: ['Dane Calloway'], UserData: { LastPlayedDate: ago(2) } });
        const comedy = title({ Genres: ['Comedy'] });
        const profile = buildProfile(collectSignals({ ...emptyHistory(), played: [crime], dislikes: [comedy] }, NOW), NOW);
        for (const values of Object.values(profile.values)) {
            for (const value of Object.values(values)) expect(Math.abs(value)).toBeLessThanOrEqual(1);
        }
        const newCrime = getFeatures(title({ Genres: ['Crime'], cast: ['Dane Calloway'] }));
        const newComedy = getFeatures(title({ Genres: ['Comedy'] }));
        expect(tasteMatch(newCrime, profile)).toBeGreaterThan(tasteMatch(newComedy, profile));
        expect(tasteMatch(newComedy, profile)).toBeLessThan(0);
        expect(topFeatures(profile, 'cast', 1)).toEqual(['Dane Calloway']);
    });
});

describe('scoring helpers', () => {
    it('measures overlap between titles', () => {
        const a = getFeatures(title({ Genres: ['Crime', 'Drama'], cast: ['A', 'B'] }));
        expect(similarity(a, a)).toBeCloseTo(1);
        const b = getFeatures(title({ Genres: ['Comedy'], cast: ['C'], ProductionYear: 1990 }));
        expect(similarity(a, b)).toBeLessThan(0.1);
    });

    it('shrinks sparse ratings towards the mean', () => {
        expect(quality(title({ CommunityRating: 9, CriticRating: 90 }), 0.6)).toBeCloseTo(0.8);
        expect(quality(title({}), 0.6)).toBeCloseTo(0.6);
        expect(meanQuality([])).toBe(0.65);
    });

    it('jitters the same way all day', () => {
        expect(stableRandom('day:a')).toBe(stableRandom('day:a'));
        const value = stableRandom('day:b');
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
    });

    it('maps age ratings onto BBFC colours', () => {
        expect(getRatingBand('15')).toBe('15');
        expect(getRatingBand('GB-12A')).toBe('12');
        expect(getRatingBand('TV-14')).toBe('15');
        expect(getRatingBand('PG-13')).toBe('12');
        expect(getRatingBand('X')).toBeNull();
    });
});

describe('home plan', () => {
    it('names genre rows the Netflix way', () => {
        expect(genreRowTitle('Comedy', 'Series', true)).toBe('Critically Acclaimed Witty Series');
        expect(genreRowTitle('Crime', 'Films', false)).toBe('Gritty Crime Films');
        expect(genreRowTitle('Polka', 'Films', false)).toBe('Polka Films');
    });

    it('builds personal rows, hides thumbs-down titles and shows a title at most twice', () => {
        const watched = title({ Name: 'Cold Ledger', Genres: ['Crime'], cast: ['Dane Calloway'], UserData: { Played: true, LastPlayedDate: ago(1) } });
        const disliked = title({ Name: 'Hated', Genres: ['Horror'], cast: ['Someone Else'], UserData: { Likes: false } });
        const crime = Array.from({ length: 30 }, (_, i) => title({ Name: `Crime ${i}`, Genres: ['Crime'], cast: ['Dane Calloway'], CommunityRating: 8 }));
        const comedy = Array.from({ length: 4 }, (_, i) => title({ Name: `Comedy ${i}`, Genres: ['Comedy'] }));
        const catalogue = [watched, disliked, ...crime, ...comedy];
        const history = { ...emptyHistory(), played: [watched], dislikes: [disliked] };

        const plan = planHome({ catalogue, context: context(history), profileName: 'Hayden', similarBySeed: new Map() });

        expect(plan.billboard?.item.Genres).toContain('Crime');
        expect(plan.billboard?.reasons).toContain('🎬 Starring Dane Calloway');
        const titles = plan.rows.map(row => row.title);
        expect(titles[0]).toBe('Top Picks for Hayden');
        expect(titles).toContain('Because you watched Cold Ledger');
        expect(titles).toContain('Top 10 on Home Fin');
        expect(titles).toContain('Starring Dane Calloway');

        const shown = plan.rows.flatMap(row => row.items);
        expect(shown.some(item => item.Id === disliked.Id)).toBe(false);
        // Top Picks never offers what you've already watched.
        expect(plan.rows[0].items.some(item => item.Id === watched.Id)).toBe(false);

        const counts = new Map<string, number>();
        for (const row of plan.rows.filter(r => r.kind !== 'top10' && !r.alwaysShow)) {
            for (const item of row.items) counts.set(item.Id || '', (counts.get(item.Id || '') || 0) + 1);
        }
        if (plan.billboard) counts.set(plan.billboard.item.Id || '', (counts.get(plan.billboard.item.Id || '') || 0) + 1);
        expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    });

    it('brings back a watched series only for a season added since it was last watched', () => {
        const show = title({ Type: 'Series', Name: 'Remains' });
        const episode = title({ Type: 'Episode', SeriesId: show.Id, UserData: { LastPlayedDate: ago(10) } });
        const others = Array.from({ length: 4 }, (_, i) => title({ Name: `Film ${i}` }));
        const history = { ...emptyHistory(), played: [episode], series: [show] };
        const pickIds = (addedDaysAgo: number) => {
            const seriesNews = new Map([[show.Id || '', { label: 'New Season' as const, addedAt: NOW - addedDaysAgo * DAY }]]);
            const plan = planHome({ catalogue: [show, ...others], context: context(history, { seriesNews }), profileName: '', similarBySeed: new Map() });
            return [plan.billboard?.item.Id, ...plan.rows[0].items.map(item => item.Id)];
        };
        expect(pickIds(20)).not.toContain(show.Id);
        expect(pickIds(2)).toContain(show.Id);
    });

    it('uses household viewing for the Top 10 when there is enough', () => {
        const shows = Array.from({ length: 6 }, (_, i) => title({ Type: 'Series', Name: `Show ${i}` }));
        const trending = { series: shows.map((s, i) => ({ id: s.Id || '', viewers: 6 - i, plays: 1 })), movies: [] };
        const plan = planHome({ catalogue: shows, context: context(emptyHistory(), { trending }), profileName: '', similarBySeed: new Map() });
        const top10 = plan.rows.find(row => row.kind === 'top10');
        expect(top10?.title).toBe('Top 10 Series on Home Fin Today');
        expect(top10?.items.map(item => item.Id)).toEqual(shows.map(s => s.Id));
        expect(plan.billboard?.reasons).toContain('🔥 #1 in Series Today');
    });
});
