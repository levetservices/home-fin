// "Play" as Netflix does it: films resume where you left off, series continue with your next episode.
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { ApiClient } from 'jellyfin-apiclient';

import { playbackManager } from 'components/playback/playbackmanager';

function resumeTicks(item: BaseItemDto) {
    return item.UserData?.PlaybackPositionTicks || 0;
}

/** The episode Play should start for a series: the one in progress, else Next Up, else the first. */
export async function getEpisodeToPlay(series: BaseItemDto, apiClient: ApiClient): Promise<BaseItemDto | null> {
    const userId = apiClient.getCurrentUserId();
    const nextUp = await apiClient.getNextUpEpisodes({
        SeriesId: series.Id,
        UserId: userId,
        Limit: 1,
        EnableResumable: true,
        DisableFirstEpisode: false,
        EnableTotalRecordCount: false
    });
    if (nextUp.Items?.[0]) return nextUp.Items[0];
    const first = await apiClient.getEpisodes(series.Id || '', { userId, Limit: 1 });
    return first.Items?.[0] || null;
}

export async function playTitle(item: BaseItemDto, apiClient: ApiClient) {
    let target = item;
    if (item.Type === 'Series') target = (await getEpisodeToPlay(item, apiClient)) || item;
    return playbackManager.play({ items: [target], startPositionTicks: resumeTicks(target) });
}

/** Play from a click handler, logging failures. */
export function playTitleNow(item: BaseItemDto, apiClient: ApiClient) {
    playTitle(item, apiClient).catch((err: unknown) => console.error('[HomeFin] playback failed', err));
}
