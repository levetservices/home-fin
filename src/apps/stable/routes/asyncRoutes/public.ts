import { AsyncRoute } from '../../../../components/router/AsyncRoute';

export const ASYNC_PUBLIC_ROUTES: AsyncRoute[] = [
    { path: 'forgotpassword', page: 'session/forgotPassword' },
    // Home Fin accounts: no Jellyfin session needed, the accounts service has its own.
    { path: 'homefin/login', page: 'homefin/login' },
    { path: 'homefin/join', page: 'homefin/join' },
    { path: 'homefin/move', page: 'homefin/move' },
    { path: 'homefin/profiles', page: 'homefin/profiles' },
    { path: 'homefin/profiles/manage', page: 'homefin/manage' },
    { path: 'homefin/account', page: 'homefin/account' },
    { path: 'homefin/admin', page: 'homefin/admin' }
];
