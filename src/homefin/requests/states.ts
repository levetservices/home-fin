// Labels for where a requested title stands, shared by cards, the pop-up and lists.
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';

import type { MediaResult, RequestState } from 'homefin/accounts/api';
import { openMoreInfo } from 'homefin/moreInfo/moreInfo';
import { ServerConnections } from 'lib/jellyfin-apiclient';

export function stateLabel(state: RequestState, progress?: number | null) {
    switch (state) {
        case 'available': return 'In the library';
        case 'partial': return 'Partly here';
        case 'downloading': return progress === null || progress === undefined ? 'Downloading' : `Downloading ${progress}%`;
        case 'processing': return 'On its way';
        case 'pending': return 'Requested';
        case 'declined': return 'Declined';
        case 'failed': return 'Couldn\'t add';
        default: return '';
    }
}

/** Can this title be asked for (again)? Shows that are partly here can ask for more seasons. */
export function canRequest(state: RequestState, type: MediaResult['type']) {
    return state === null || state === 'declined' || state === 'failed' || (type === 'tv' && state === 'partial');
}

/** Open a title that's in the library in More Info (matched by name and year). */
export async function openInLibrary(result: Pick<MediaResult, 'type' | 'title' | 'year'>) {
    const apiClient = ServerConnections.currentApiClient();
    if (!apiClient) return false;
    const found = await apiClient.getItems(apiClient.getCurrentUserId(), {
        searchTerm: result.title,
        IncludeItemTypes: result.type === 'movie' ? 'Movie' : 'Series',
        Recursive: true,
        Limit: 10,
        Fields: 'Overview,Genres,ProductionYear'
    });
    const items: BaseItemDto[] = found.Items || [];
    const match = items.find(item => item.ProductionYear === result.year) || items[0];
    if (!match) return false;
    openMoreInfo(match, apiClient);
    return true;
}
