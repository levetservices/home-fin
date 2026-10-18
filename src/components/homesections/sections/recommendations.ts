import type { ApiClient } from 'jellyfin-apiclient';

import type { HomePlan, PlannedRow } from 'homefin/recs';
import { setTop10 } from 'homefin/ui/badges';

import { MIN_ROW_ITEMS } from 'homefin/recs/plan';
import { renderRow } from '../rows/mediaRow';

function isWorthShowing(row: PlannedRow) {
    if (!row.title || !row.items.length) return false;
    return row.alwaysShow || row.items.length >= MIN_ROW_ITEMS;
}

/**
 * Netflix-style personalised rows from the Home Fin recommender (homefin/recs):
 * Top Picks, Top 10, Because you watched…, genre rows, My List, New on Home Fin,
 * Starring…, Watch It Again. Each row is rendered into its own child element.
 */
export async function loadRecommendations(elem: HTMLElement, apiClient: ApiClient, plan: Promise<HomePlan>) {
    const { rows, top10 } = await plan;
    setTop10(top10);
    if (!elem.isConnected) return;

    elem.innerHTML = '';
    for (const row of rows.filter(isWorthShowing)) {
        const rowElem = document.createElement('div');
        elem.appendChild(rowElem);
        renderRow(rowElem, row, apiClient);
    }
}
