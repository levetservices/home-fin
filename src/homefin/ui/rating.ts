// Age ratings as Netflix UK shows them: a coloured circle (BBFC colours), US ratings mapped onto the same bands.
import escapeHtml from 'escape-html';

import './rating.scss';

type Band = 'u' | 'pg' | '12' | '15' | '18';

const BANDS = new Map<string, Band>([
    // BBFC
    ['U', 'u'], ['UC', 'u'], ['PG', 'pg'], ['12', '12'], ['12A', '12'], ['15', '15'], ['18', '18'], ['R18', '18'],
    // US film
    ['G', 'u'], ['PG-13', '12'], ['R', '15'], ['NC-17', '18'],
    // US TV
    ['TV-Y', 'u'], ['TV-Y7', 'u'], ['TV-Y7-FV', 'u'], ['TV-G', 'u'], ['TV-PG', 'pg'], ['TV-14', '15'], ['TV-MA', '18']
]);

/** Country prefixes Jellyfin keeps on some ratings, e.g. "GB-15", "UK:12A", "US-PG-13". */
const PREFIX = /^(?:GB|UK|US)[-:\s]/i;

function normalise(rating: string) {
    return rating.trim().replace(PREFIX, '').toUpperCase();
}

export function getRatingBand(rating: string | null | undefined): Band | null {
    if (!rating) return null;
    return BANDS.get(normalise(rating)) ?? null;
}

/** The rating badge: a circle for short BBFC-style labels, a rounded pill for longer ones ("TV-14"). */
export function ratingBadgeHtml(rating: string | null | undefined, className = '') {
    if (!rating) return '';
    const label = normalise(rating);
    const band = getRatingBand(rating);
    const shape = label.length > 3 ? ' hfRating-pill' : '';
    const colour = band ? ` hfRating-${band}` : ' hfRating-unknown';
    return `<span class="hfRating${colour}${shape}${className ? ' ' + className : ''}" title="${escapeHtml(rating)}">${escapeHtml(label)}</span>`;
}
