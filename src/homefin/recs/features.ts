// Content features of a title (SPEC §7.1): what the taste profile and similarity are built from.
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';

export type Family = 'genre' | 'cast' | 'director' | 'studio' | 'tag' | 'decade' | 'kind';

/** How much each family counts towards taste match / similarity. */
export const FAMILY_WEIGHTS: Record<Family, number> = {
    genre: 0.34,
    cast: 0.2,
    tag: 0.16,
    director: 0.1,
    decade: 0.08,
    studio: 0.06,
    kind: 0.06
};

export const FAMILIES = Object.keys(FAMILY_WEIGHTS) as Family[];

/** Feature keys grouped by family, e.g. { genre: ['Crime', 'Drama'], cast: ['Dane Calloway', …] }. */
export type Features = Record<Family, string[]>;

const TOP_CAST = 5;
const TOP_TAGS = 8;

/** Fields a query must ask for so `getFeatures` has something to read. */
export const FEATURE_FIELDS = 'Genres,Tags,Studios,People,ProductionYear';

function clean(values: (string | null | undefined)[]) {
    return [...new Set(values.filter((v): v is string => !!v).map(v => v.trim()).filter(Boolean))];
}

export function getFeatures(item: BaseItemDto): Features {
    const people = item.People || [];
    const year = item.ProductionYear;
    return {
        genre: clean(item.Genres || []),
        cast: clean(people.filter(p => p.Type === 'Actor').slice(0, TOP_CAST).map(p => p.Name)),
        director: clean(people.filter(p => p.Type === 'Director').map(p => p.Name)),
        studio: clean((item.Studios || []).map(s => s.Name)),
        tag: clean((item.Tags || []).slice(0, TOP_TAGS)).map(t => t.toLowerCase()),
        decade: year ? [`${Math.floor(year / 10) * 10}s`] : [],
        kind: [item.Type === 'Series' ? 'series' : 'film']
    };
}

/**
 * Overlap between two titles' features, 0–1: per family, shared keys over the
 * geometric mean of their sizes (cosine for binary vectors), weighted by family.
 */
export function similarity(a: Features, b: Features) {
    let score = 0;
    let weight = 0;
    for (const family of FAMILIES) {
        const left = a[family];
        const right = b[family];
        // A family neither title has says nothing; one only one side has counts as no overlap.
        if (!left.length && !right.length) continue;
        weight += FAMILY_WEIGHTS[family];
        if (!left.length || !right.length) continue;
        const shared = left.filter(key => right.includes(key)).length;
        score += FAMILY_WEIGHTS[family] * (shared / Math.sqrt(left.length * right.length));
    }
    return weight ? score / weight : 0;
}
