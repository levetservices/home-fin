import { AsyncRoute } from '../../../../components/router/AsyncRoute';

export const ASYNC_USER_ROUTES: AsyncRoute[] = [
    { path: 'homefin/requests', page: 'homefin/requests' },
    { path: 'homefin/settings', page: 'homefin/settings' },
    // Home Fin's settings replace Jellyfin's preferences menu (its sub-pages stay, under More).
    { path: 'mypreferencesmenu', page: 'homefin/settings' },
    { path: 'quickconnect', page: 'quickConnect' },
    { path: 'search', page: 'search' },
    { path: 'userprofile', page: 'user/userprofile' }
];
