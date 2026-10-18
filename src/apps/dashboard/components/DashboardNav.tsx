// Home Fin: the dashboard's sections as a row of menus under the header, in place of the
// permanent sidebar (phones still get the slide-out drawer).
import ArrowDropDown from '@mui/icons-material/ArrowDropDown';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import React, { type FC, type MouseEvent, useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { useConfigurationPages } from 'apps/dashboard/features/plugins/api/useConfigurationPages';
import globalize from 'lib/globalize';
import Dashboard from 'utils/dashboard';

interface NavLink {
    label: string
    to: string
    /** Shown as given rather than translated (plugin names). */
    raw?: boolean
}

interface NavSection {
    label: string
    items: NavLink[]
    /** Other paths that belong to this section (e.g. a plugin's settings). */
    prefixes?: string[]
}

// Labels are translation keys, as in the drawer sections.
const SECTIONS: NavSection[] = [
    { label: 'TabServer', items: [
        { label: 'General', to: '/dashboard/settings' },
        { label: 'HeaderBranding', to: '/dashboard/branding' },
        { label: 'HeaderUsers', to: '/dashboard/users' }
    ], prefixes: [ '/dashboard/users/' ] },
    { label: 'HeaderLibraries', items: [
        { label: 'HeaderLibraries', to: '/dashboard/libraries' },
        { label: 'Display', to: '/dashboard/libraries/display' },
        { label: 'LabelMetadata', to: '/dashboard/libraries/metadata' },
        { label: 'TabNfoSettings', to: '/dashboard/libraries/nfo' }
    ] },
    { label: 'TitlePlayback', items: [
        { label: 'Transcoding', to: '/dashboard/playback/transcoding' },
        { label: 'ButtonResume', to: '/dashboard/playback/resume' },
        { label: 'TabStreaming', to: '/dashboard/playback/streaming' },
        { label: 'Trickplay', to: '/dashboard/playback/trickplay' }
    ] },
    { label: 'HeaderDevices', items: [
        { label: 'HeaderDevices', to: '/dashboard/devices' },
        { label: 'HeaderActivity', to: '/dashboard/activity' }
    ] },
    { label: 'LiveTV', items: [
        { label: 'LiveTV', to: '/dashboard/livetv' },
        { label: 'HeaderDVR', to: '/dashboard/livetv/recordings' }
    ], prefixes: [ '/dashboard/livetv/' ] },
    { label: 'TabPlugins', items: [
        { label: 'TabPlugins', to: '/dashboard/plugins' }
    ], prefixes: [ '/dashboard/plugins', '/configurationpage' ] },
    { label: 'TabAdvanced', items: [
        { label: 'TabNetworking', to: '/dashboard/networking' },
        { label: 'HeaderApiKeys', to: '/dashboard/keys' },
        { label: 'HeaderBackups', to: '/dashboard/backups' },
        { label: 'TabLogs', to: '/dashboard/logs' },
        { label: 'TabScheduledTasks', to: '/dashboard/tasks' }
    ], prefixes: [ '/dashboard/tasks/', '/dashboard/logs/' ] }
];

const navButtonSx = (active: boolean) => ({
    px: 1.5,
    py: 0.5,
    minWidth: 0,
    borderRadius: 999,
    textTransform: 'none',
    fontSize: '0.92rem',
    fontWeight: active ? 700 : 500,
    whiteSpace: 'nowrap',
    color: active ? 'common.white' : 'rgba(255, 255, 255, 0.72)',
    backgroundColor: active ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
    '&:hover': {
        color: 'common.white',
        backgroundColor: 'rgba(255, 255, 255, 0.08)'
    }
});

function isInSection(section: NavSection, pathname: string) {
    return section.items.some(item => item.to === pathname)
        || Boolean(section.prefixes?.some(prefix => pathname.startsWith(prefix)));
}

const NavMenu: FC<{ section: NavSection, pathname: string }> = ({ section, pathname }) => {
    const [ anchor, setAnchor ] = useState<HTMLElement | null>(null);
    const onOpen = useCallback((e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget), []);
    const onClose = useCallback(() => setAnchor(null), []);
    const id = `hfDashNav-${section.label}`;

    return (
        <>
            <Button
                id={`${id}-button`}
                aria-controls={anchor ? id : undefined}
                aria-haspopup='true'
                aria-expanded={anchor ? 'true' : undefined}
                endIcon={<ArrowDropDown sx={{ ml: -0.75 }} />}
                sx={navButtonSx(isInSection(section, pathname))}
                onClick={onOpen}
            >
                {globalize.translate(section.label)}
            </Button>
            <Menu
                id={id}
                anchorEl={anchor}
                open={Boolean(anchor)}
                onClose={onClose}
                slotProps={{
                    list: { 'aria-labelledby': `${id}-button`, dense: true },
                    paper: { sx: { mt: 0.5, minWidth: 200, borderRadius: 2 } }
                }}
            >
                {section.items.map(item => (
                    <MenuItem
                        key={item.to}
                        component={Link}
                        to={item.to}
                        selected={item.to === pathname}
                        onClick={onClose}
                    >
                        {item.raw ? item.label : globalize.translate(item.label)}
                    </MenuItem>
                ))}
            </Menu>
        </>
    );
};

const DashboardNav: FC = () => {
    const { pathname } = useLocation();
    const { data: pluginPages, error } = useConfigurationPages({ enableInMainMenu: true });

    useEffect(() => {
        if (error) console.error('[DashboardNav] unable to fetch plugin config pages', error);
    }, [ error ]);

    // Plugins that ask for a menu entry sit under Plugins, as they did in the sidebar.
    const sections = SECTIONS.map(section => (section.label === 'TabPlugins' && pluginPages?.length ? {
        ...section,
        items: [
            ...section.items,
            ...pluginPages.map(page => ({ label: page.DisplayName || page.Name || '', to: `/${Dashboard.getPluginUrl(page.Name)}`, raw: true }))
        ]
    } : section));

    return (
        <Box
            component='nav'
            aria-label={globalize.translate('TabDashboard')}
            className='hfDashNav'
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                height: '2.75rem',
                px: 'max(16px, env(safe-area-inset-left))',
                overflowX: 'auto',
                scrollbarWidth: 'none',
                borderTop: '1px solid rgba(255, 255, 255, 0.06)'
            }}
        >
            <Button
                component={Link}
                to='/dashboard'
                sx={navButtonSx(pathname === '/dashboard')}
            >
                {globalize.translate('TabDashboard')}
            </Button>
            {sections.map(section => (
                <NavMenu key={section.label} section={section} pathname={pathname} />
            ))}
        </Box>
    );
};

export default DashboardNav;
