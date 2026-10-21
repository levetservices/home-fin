import React, { type FC, useEffect, useState } from 'react';

import Page from 'components/Page';
import { getRequestsConfig } from 'homefin/accounts/api';
import { AppsSection, LinksSection, ServerSection } from 'homefin/settings/AdminSections';
import { DisplaySection, MoreSection, PlaybackSection, ProfileSection, SubtitlesSection } from 'homefin/settings/PersonalSections';
import useSearchParam from 'hooks/useSearchParam';
import { ServerConnections } from 'lib/jellyfin-apiclient';

import 'homefin/settings/settings.scss';

interface Section {
    id: string
    label: string
    icon: string
    admin?: boolean
    Component: FC
}

const SECTIONS: Section[] = [
    { id: 'profile', label: 'Profile', icon: 'person', Component: ProfileSection },
    { id: 'playback', label: 'Playback', icon: 'play_circle_outline', Component: PlaybackSection },
    { id: 'subtitles', label: 'Subtitles', icon: 'subtitles', Component: SubtitlesSection },
    { id: 'display', label: 'Display', icon: 'palette', Component: DisplaySection },
    { id: 'apps', label: 'Requests', icon: 'playlist_add', admin: true, Component: AppsSection },
    { id: 'links', label: 'Quick links', icon: 'link', admin: true, Component: LinksSection },
    { id: 'server', label: 'Server', icon: 'dns', admin: true, Component: ServerSection },
    { id: 'more', label: 'More', icon: 'tune', Component: MoreSection }
];

/** Is whoever is watching an admin (a Jellyfin administrator, or a Home Fin admin account's profile)? */
async function isAdmin() {
    const apiClient = ServerConnections.currentApiClient();
    if (!apiClient) return false;
    const user = await apiClient.getCurrentUser().catch(() => null);
    if (user?.Policy?.IsAdministrator) return true;
    return !!(await getRequestsConfig())?.isAdmin;
}

/** Home Fin settings: one page with a section menu, in place of Jellyfin's preference pages. */
export default function HomefinSettings() {
    const [section, setSection] = useSearchParam('section');
    const [admin, setAdmin] = useState(false);

    useEffect(() => {
        isAdmin().then(setAdmin).catch(() => setAdmin(false));
    }, []);

    const visible = SECTIONS.filter(s => !s.admin || admin);
    const current = visible.find(s => s.id === section) || visible[0];
    const { Component } = current;

    return (
        <Page id='homefinSettingsPage' title='Settings' className='mainAnimatedPage libraryPage allLibraryPage noSecondaryNavPage hfSetPage'>
            <div className='hfSet'>
                <h1>Settings</h1>
                <div className='hfSet-layout'>
                    <nav className='hfSet-nav' aria-label='Settings sections'>
                        {visible.map((s, i) => (
                            <React.Fragment key={s.id}>
                                {s.admin && !visible[i - 1]?.admin && <span className='hfSet-navHeading'>Admin</span>}
                                <SectionLink section={s} active={s.id === current.id} onPick={setSection} />
                            </React.Fragment>
                        ))}
                    </nav>
                    <div className='hfSet-content' key={current.id}>
                        <Component />
                    </div>
                </div>
            </div>
        </Page>
    );
}

const SectionLink: FC<{ section: Section, active: boolean, onPick: (id: string) => void }> = ({ section, active, onPick }) => {
    const pick = React.useCallback(() => onPick(section.id), [onPick, section.id]);
    return (
        <button type='button' className={`hfSet-navItem${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={pick}>
            <span className='material-icons' aria-hidden='true'>{section.icon}</span>
            {section.label}
        </button>
    );
};
