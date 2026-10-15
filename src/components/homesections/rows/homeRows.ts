import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto';
import type { ApiClient } from 'jellyfin-apiclient';

import { appRouter } from 'components/router/appRouter';
import globalize from 'lib/globalize';
import type { UserSettings } from 'scripts/settings/userSettings';

import { renderLatestSection } from '../sections/recentlyAdded';
import type { SectionOptions } from '../sections/section';
import { ROW_FIELDS, ROW_IMAGE_TYPES } from './artwork';
import { renderRow, type RowElement, type RowOptions } from './mediaRow';

/** Rows that should re-query when the user comes back to Home (e.g. after watching). */
export type RefreshableRow = RowElement & { hfRefresh?: () => Promise<void> };

const ROW_LIMIT = 20;
/** Library types shown as Netflix rows; anything else keeps Jellyfin's own row. */
const VIDEO_VIEW_TYPES = new Set(['movies', 'tvshows', 'mixed', undefined, null]);

function makeRefreshable(elem: RefreshableRow, load: () => Promise<RowOptions | null>, apiClient: ApiClient, refreshOnResume = true) {
    elem.hfRefresh = async () => {
        const options = await load();
        if (options) {
            renderRow(elem, options, apiClient);
        } else {
            elem.classList.add('hide');
        }
    };
    if (refreshOnResume) elem.classList.add('hfRefreshable');
    return elem.hfRefresh().catch(err => {
        console.error('[HomeRows] row failed to load', err);
        elem.classList.add('hide');
    });
}

export function loadContinueWatchingRow(elem: RefreshableRow, apiClient: ApiClient, user: UserDto, userSettings: UserSettings) {
    return makeRefreshable(elem, async () => {
        const result = await apiClient.getResumableItems(apiClient.getCurrentUserId(), {
            Limit: ROW_LIMIT,
            Recursive: true,
            Fields: ROW_FIELDS,
            ImageTypeLimit: 1,
            EnableImageTypes: ROW_IMAGE_TYPES,
            EnableTotalRecordCount: false,
            MediaTypes: 'Video'
        });
        return {
            title: user.Name ? globalize.translate('HeaderContinueWatchingFor', user.Name) : globalize.translate('HeaderContinueWatching'),
            items: result.Items || [],
            useEpisodeImages: userSettings.useEpisodeImagesInNextUpAndResume()
        };
    }, apiClient);
}

export function loadNextUpRow(elem: RefreshableRow, apiClient: ApiClient, userSettings: UserSettings) {
    return makeRefreshable(elem, async () => {
        const oldest = new Date();
        oldest.setDate(oldest.getDate() - userSettings.maxDaysForNextUp());
        const result = await apiClient.getNextUpEpisodes({
            Limit: ROW_LIMIT,
            Fields: ROW_FIELDS,
            UserId: apiClient.getCurrentUserId(),
            ImageTypeLimit: 1,
            EnableImageTypes: ROW_IMAGE_TYPES,
            EnableTotalRecordCount: false,
            DisableFirstEpisode: false,
            NextUpDateCutoff: oldest.toISOString(),
            EnableResumable: false,
            EnableRewatching: userSettings.enableRewatchingInNextUp()
        });
        return {
            title: globalize.translate('NextUp'),
            href: appRouter.getRouteUrl('nextup', { serverId: apiClient.serverId() }),
            items: result.Items || [],
            useEpisodeImages: userSettings.useEpisodeImagesInNextUpAndResume()
        };
    }, apiClient);
}

/** "Recently Added in <library>" rows: Netflix rows for video libraries, stock rows for the rest. */
export function loadLatestRows(elem: HTMLElement, apiClient: ApiClient, user: UserDto, userViews: BaseItemDto[], options: SectionOptions) {
    elem.classList.remove('verticalSection');
    const excludeViewTypes = ['playlists', 'livetv', 'boxsets', 'channels', 'folders'];
    const userExcludeItems = user.Configuration?.LatestItemsExcludes ?? [];
    const loads: Promise<void>[] = [];

    for (const view of userViews) {
        if (!view.Id || userExcludeItems.includes(view.Id)) continue;
        if (view.CollectionType && excludeViewTypes.includes(view.CollectionType)) continue;

        const frag = document.createElement('div');
        frag.classList.add('verticalSection', 'hide');
        elem.appendChild(frag);

        if (!VIDEO_VIEW_TYPES.has(view.CollectionType)) {
            renderLatestSection(frag, apiClient, user, view, options);
            continue;
        }

        const parentId = view.Id;
        loads.push(makeRefreshable(frag, async () => {
            const items = await apiClient.getLatestItems({
                Limit: ROW_LIMIT,
                Fields: ROW_FIELDS,
                ImageTypeLimit: 1,
                EnableImageTypes: ROW_IMAGE_TYPES,
                ParentId: parentId
            });
            return {
                title: globalize.translate('LatestFromLibrary', view.Name || ''),
                href: appRouter.getRouteUrl(view, { section: 'latest' }),
                items
            };
        }, apiClient, false));
    }
    return Promise.all(loads);
}

/** Re-query every Netflix row on the page (cheap; called when Home is shown again). */
export function refreshRows(container: HTMLElement) {
    const rows = container.querySelectorAll<RefreshableRow>('.hfRefreshable');
    return Promise.all(Array.from(rows, row => row.hfRefresh?.().catch(err => console.error('[HomeRows] refresh failed', err))));
}
