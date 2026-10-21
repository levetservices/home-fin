import { StorageManager } from '@mui/material/styles';

import Events, { type Event } from 'utils/events';
import { EventType } from 'constants/eventType';

/** Themes built on MUI's light palette; every other theme is dark. */
const LIGHT_THEMES = new Set(['appletv', 'light']);

const modeFor = (themeId: string) => (LIGHT_THEMES.has(themeId) ? 'light' : 'dark');

/**
 * A custom MUI StorageManager.
 *
 * Since we switch the theme based on the current page, we handle getting/setting the current theme via autoTheme +
 * themeManager. We need to implement `subscribe` so MUI is aware of theme changes though otherwise the `useTheme` hook
 * will always return the default theme.
 *
 * Home Fin: themeManager may have applied the theme before a React root mounts (its change event is then already
 * gone), so `get` reads the theme already on the page. Without this, MUI starts on "dark" and the dashboard keeps
 * Jellyfin's blue under the Cinema theme. The mode key gets light / dark, the color scheme keys the theme id.
 */
export const ThemeStorageManager: StorageManager = ({ key }) => {
    const isModeKey = !key.includes('color-scheme');
    const toValue = (themeId: string) => (isModeKey ? modeFor(themeId) : themeId);

    return {
        get: defaultValue => {
            const current = document.documentElement.dataset.theme;
            return current ? toValue(current) : defaultValue;
        },
        set: () => { /* no-op */ },
        subscribe: handler => {
            const wrappedHandler = (_e: Event, value: string) => handler(toValue(value));
            Events.on(document, EventType.THEME_CHANGE, wrappedHandler);
            return () => Events.off(document, EventType.THEME_CHANGE, wrappedHandler);
        }
    };
};
