// Settings everyone has: profile, playback, subtitles and display.
import React, { type FC, useCallback, useEffect, useMemo, useState } from 'react';

import { getCurrentProfile } from 'homefin/accounts/session';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import Dashboard from 'utils/dashboard';
import appSettings from 'scripts/settings/appSettings';
import * as userSettings from 'scripts/settings/userSettings';
import { getThemes } from 'scripts/settings/webSettings';
import skinManager from 'scripts/themeManager';

import { Choice, LinkRow, type Option, Panel, Row, Toggle, failed, saved, useLanguages, useUserConfig } from './controls';

const ANY_LANGUAGE: Option = { value: '', label: 'Any' };

// Netflix-style quality steps (Jellyfin's maximum bitrate per stream).
const QUALITY: Option[] = [
    { value: '', label: 'Auto: the best your connection allows' },
    { value: '40000000', label: 'Best: up to 4K (40 Mbps)' },
    { value: '20000000', label: 'High: 1080p (20 Mbps)' },
    { value: '8000000', label: 'Medium: 1080p (8 Mbps)' },
    { value: '3000000', label: 'Low: 720p (3 Mbps)' },
    { value: '1500000', label: 'Data saver: 720p (1.5 Mbps)' }
];

const SKIP: Option[] = [5, 10, 15, 20, 30, 60].map(seconds => ({ value: String(seconds * 1000), label: `${seconds} seconds` }));

const SUBTITLE_MODES: Option[] = [
    { value: 'Smart', label: 'When the audio isn\'t in my language' },
    { value: 'Always', label: 'Always' },
    { value: 'OnlyForced', label: 'Only for foreign dialogue and signs' },
    { value: 'Default', label: 'When the file says so' },
    { value: 'None', label: 'Off' }
];

const SUBTITLE_SIZES: Option[] = [
    { value: 'smaller', label: 'Smallest' },
    { value: 'small', label: 'Small' },
    { value: '', label: 'Medium' },
    { value: 'large', label: 'Large' },
    { value: 'larger', label: 'Larger' },
    { value: 'extralarge', label: 'Largest' }
];

// Netflix's subtitle "styles": shadow, outline or a dark box behind the text.
const SUBTITLE_STYLES: Option[] = [
    { value: 'shadow', label: 'Drop shadow' },
    { value: 'outline', label: 'Outline' },
    { value: 'box', label: 'Dark box' }
];

const SUBTITLE_COLOURS: Option[] = [
    { value: '#ffffff', label: 'White' },
    { value: '#ffff00', label: 'Yellow' },
    { value: '#00ffff', label: 'Cyan' },
    { value: '#d3d3d3', label: 'Light grey' }
];

// Preview sizes; Jellyfin's "normal" size is the empty string.
const SIZE_EM = new Map([['smaller', 0.8], ['small', 1], ['', 1.2], ['large', 1.45], ['larger', 1.7], ['extralarge', 2]]);

const SHADOWS: Record<string, string> = {
    outline: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
    shadow: '2px 2px 4px rgba(0, 0, 0, 0.9)',
    box: 'none'
};

// ── profile ──────────────────────────────────────────────────────────────

export const ProfileSection: FC = () => {
    const profile = getCurrentProfile();
    const apiClient = ServerConnections.currentApiClient();
    const userId = apiClient?.getCurrentUserId() || '';
    const onProfile = !!profile && profile.jellyfinUserId === userId;
    const signOut = useCallback(() => Dashboard.logout(), []);

    return (
        <>
            <Panel title={onProfile ? `Watching as ${profile.name}` : 'Your profile'}>
                {onProfile ? (
                    <>
                        <LinkRow label='Edit profiles' description='Names, pictures, maturity and profile locks' href='#/homefin/profiles/manage' />
                        <LinkRow label='Switch profiles' href='#/homefin/profiles' />
                        <LinkRow label='Account' description='Email, password and signing out everywhere' href='#/homefin/account' />
                    </>
                ) : (
                    <LinkRow label='Name, picture and password' href={`#/userprofile?userId=${userId}`} />
                )}
            </Panel>
            <Panel title='TVs and phones'>
                <LinkRow label='Sign in a TV' description='Enter the Quick Connect code shown on the TV or phone app' href={`#/quickconnect?userId=${userId}`} />
            </Panel>
            <div className='hfSet-signOut'>
                <button type='button' className='hfSet-button' onClick={signOut}>{onProfile ? 'Sign out of Home Fin' : 'Sign out'}</button>
            </div>
        </>
    );
};

// ── playback ─────────────────────────────────────────────────────────────

function qualityValue(isInNetwork: boolean) {
    return appSettings.enableAutomaticBitrateDetection(isInNetwork, 'Video') ? '' : String(appSettings.maxStreamingBitrate(isInNetwork, 'Video'));
}

function setQuality(isInNetwork: boolean, value: string) {
    if (value) {
        appSettings.maxStreamingBitrate(isInNetwork, 'Video', value);
        appSettings.enableAutomaticBitrateDetection(isInNetwork, 'Video', false);
    } else {
        appSettings.enableAutomaticBitrateDetection(isInNetwork, 'Video', true);
    }
}

/** A setting kept in this browser / on the user's display preferences (userSettings, appSettings). */
function useLocalSetting<T>(read: () => T, write: (value: T) => void) {
    const [value, setValue] = useState<T>(read);
    const change = useCallback((next: T) => {
        try {
            write(next);
            setValue(next);
            saved();
        } catch (err) {
            failed(err);
        }
    }, [write]);
    return [value, change] as const;
}

const readNextOverlay = () => userSettings.enableNextVideoInfoOverlay(undefined);
const writeNextOverlay = (value: boolean) => userSettings.enableNextVideoInfoOverlay(value);
const readCinema = () => userSettings.enableCinemaMode(undefined);
const writeCinema = (value: boolean) => userSettings.enableCinemaMode(value);
const readAwayQuality = () => qualityValue(false);
const writeAwayQuality = (value: string) => setQuality(false, value);
const readHomeQuality = () => qualityValue(true);
const writeHomeQuality = (value: string) => setQuality(true, value);
const readSkipBack = () => String(userSettings.skipBackLength(undefined));
const writeSkipBack = (value: string) => userSettings.skipBackLength(Number(value));
const readSkipForward = () => String(userSettings.skipForwardLength(undefined));
const writeSkipForward = (value: string) => userSettings.skipForwardLength(Number(value));

export const PlaybackSection: FC = () => {
    const { config, save } = useUserConfig();
    const languages = useLanguages();
    const [nextOverlay, setNextOverlay] = useLocalSetting(readNextOverlay, writeNextOverlay);
    const [cinema, setCinema] = useLocalSetting(readCinema, writeCinema);
    const [away, setAway] = useLocalSetting(readAwayQuality, writeAwayQuality);
    const [home, setHome] = useLocalSetting(readHomeQuality, writeHomeQuality);
    const [skipBack, setSkipBack] = useLocalSetting(readSkipBack, writeSkipBack);
    const [skipForward, setSkipForward] = useLocalSetting(readSkipForward, writeSkipForward);

    const setAutoplay = useCallback((value: boolean) => save({ EnableNextEpisodeAutoPlay: value }), [save]);
    const setAudio = useCallback((value: string) => save({ AudioLanguagePreference: value || undefined }), [save]);
    const setDefaultTrack = useCallback((value: boolean) => save({ PlayDefaultAudioTrack: value }), [save]);
    const setRemember = useCallback((value: boolean) => save({ RememberAudioSelections: value, RememberSubtitleSelections: value }), [save]);
    const languageOptions = useMemo(() => [ANY_LANGUAGE, ...languages], [languages]);

    return (
        <>
            <Panel title='Autoplay'>
                <Toggle id='hfSetAutoplay' label='Play the next episode automatically' checked={!!config?.EnableNextEpisodeAutoPlay} onChange={setAutoplay} />
                <Toggle id='hfSetNextOverlay' label={'Show what\'s next before an episode ends'} checked={nextOverlay} onChange={setNextOverlay} />
                <Toggle id='hfSetCinema' label='Play trailers before films' description='Like the cinema: trailers from your library first' checked={cinema} onChange={setCinema} />
            </Panel>
            <Panel title='Streaming quality' description='Higher quality uses more data. Saved for this device.'>
                <Choice id='hfSetQualityAway' label='Away from home' value={away} options={QUALITY} onChange={setAway} />
                <Choice id='hfSetQualityHome' label='On your home network' value={home} options={QUALITY} onChange={setHome} />
            </Panel>
            <Panel title='Audio'>
                <Choice id='hfSetAudioLang' label='Preferred audio language' value={config?.AudioLanguagePreference || ''} options={languageOptions} onChange={setAudio} />
                <Toggle id='hfSetDefaultTrack' label='Use the main audio track' description='Play the track the file marks as main, even in another language' checked={!!config?.PlayDefaultAudioTrack} onChange={setDefaultTrack} />
                <Toggle id='hfSetRemember' label='Remember my audio and subtitle choices' description='Within a series, keep what you picked last time' checked={!!config?.RememberAudioSelections} onChange={setRemember} />
            </Panel>
            <Panel title='Player controls'>
                <Choice id='hfSetSkipBack' label='Skip back' value={skipBack} options={SKIP} onChange={setSkipBack} />
                <Choice id='hfSetSkipForward' label='Skip forward' value={skipForward} options={SKIP} onChange={setSkipForward} />
            </Panel>
        </>
    );
};

// ── subtitles ────────────────────────────────────────────────────────────

interface Appearance {
    textSize?: string
    dropShadow?: string
    textBackground?: string
    textColor?: string
    [key: string]: unknown
}

function styleOf(appearance: Appearance) {
    if (appearance.textBackground && appearance.textBackground !== 'transparent') return 'box';
    return appearance.dropShadow === 'uniform' ? 'outline' : 'shadow';
}

export const SubtitlesSection: FC = () => {
    const { config, save } = useUserConfig();
    const languages = useLanguages();
    const [appearance, setAppearance] = useState<Appearance>(() => ({ ...userSettings.getSubtitleAppearanceSettings() }));
    const languageOptions = useMemo(() => [ANY_LANGUAGE, ...languages], [languages]);

    const update = useCallback((patch: Appearance) => {
        setAppearance(current => {
            const next = { ...current, ...patch };
            userSettings.setSubtitleAppearanceSettings(next, undefined);
            return next;
        });
        saved();
    }, []);

    const setLanguage = useCallback((value: string) => save({ SubtitleLanguagePreference: value || undefined }), [save]);
    const setMode = useCallback((value: string) => save({ SubtitleMode: value as never }), [save]);
    const setSize = useCallback((textSize: string) => update({ textSize }), [update]);
    const setColour = useCallback((textColor: string) => update({ textColor }), [update]);
    const setStyle = useCallback((style: string) => update({
        dropShadow: style === 'outline' ? 'uniform' : '',
        textBackground: style === 'box' ? 'rgba(0, 0, 0, 0.75)' : 'transparent'
    }), [update]);

    const style = styleOf(appearance);
    const previewStyle: React.CSSProperties = {
        fontSize: `${SIZE_EM.get(appearance.textSize || '') ?? 1.2}em`,
        color: appearance.textColor || '#fff',
        background: style === 'box' ? 'rgba(0, 0, 0, 0.75)' : 'transparent',
        textShadow: SHADOWS[style]
    };

    return (
        <>
            <Panel title='When to show subtitles'>
                <Choice id='hfSetSubLang' label='Subtitle language' value={config?.SubtitleLanguagePreference || ''} options={languageOptions} onChange={setLanguage} />
                <Choice id='hfSetSubMode' label='Show subtitles' value={config?.SubtitleMode || 'Default'} options={SUBTITLE_MODES} onChange={setMode} />
            </Panel>
            <Panel title='Subtitle appearance' description='Saved for this device.'>
                <div className='hfSet-subPreview' aria-hidden='true'>
                    <span style={previewStyle}>The quick brown fox jumps over the lazy dog.</span>
                </div>
                <Choice id='hfSetSubSize' label='Size' value={appearance.textSize || ''} options={SUBTITLE_SIZES} onChange={setSize} />
                <Choice id='hfSetSubStyle' label='Style' value={style} options={SUBTITLE_STYLES} onChange={setStyle} />
                <Choice id='hfSetSubColour' label='Colour' value={appearance.textColor || '#ffffff'} options={SUBTITLE_COLOURS} onChange={setColour} />
            </Panel>
        </>
    );
};

// ── display ──────────────────────────────────────────────────────────────

const readBackdrops = () => userSettings.enableBackdrops();
const writeBackdrops = (value: boolean) => userSettings.enableBackdrops(value);
const readThemeSongs = () => userSettings.enableThemeSongs();
const writeThemeSongs = (value: boolean) => userSettings.enableThemeSongs(value);
const readBlurhash = () => userSettings.enableBlurhash();
const writeBlurhash = (value: boolean) => userSettings.enableBlurhash(value);

export const DisplaySection: FC = () => {
    const [themes, setThemes] = useState<Option[]>([]);
    const [theme, setThemeValue] = useState(() => userSettings.theme() as string);
    const [backdrops, setBackdrops] = useLocalSetting(readBackdrops, writeBackdrops);
    const [themeSongs, setThemeSongs] = useLocalSetting(readThemeSongs, writeThemeSongs);
    const [blurhash, setBlurhash] = useLocalSetting(readBlurhash, writeBlurhash);

    useEffect(() => {
        getThemes().then((list: { id: string, name: string }[]) => setThemes(list.map(t => ({ value: t.id, label: t.name })))).catch(() => setThemes([]));
    }, []);

    const changeTheme = useCallback((value: string) => {
        userSettings.theme(value);
        setThemeValue(value);
        skinManager.setTheme(value).then(saved).catch(failed);
    }, []);

    return (
        <Panel title='Look and feel'>
            {themes.length > 0 && (
                <Choice id='hfSetTheme' label='Theme' description='Cinema is the Home Fin look' value={theme || themes[0].value} options={themes} onChange={changeTheme} />
            )}
            <Toggle id='hfSetBackdrops' label='Artwork behind pages' checked={backdrops} onChange={setBackdrops} />
            <Toggle id='hfSetThemeSongs' label='Theme music on title pages' checked={themeSongs} onChange={setThemeSongs} />
            <Toggle id='hfSetBlurhash' label='Blurred previews while artwork loads' checked={blurhash} onChange={setBlurhash} />
        </Panel>
    );
};

/** Jellyfin's own preference pages, for everything not covered here. */
export const MoreSection: FC = () => {
    const userId = ServerConnections.currentApiClient()?.getCurrentUserId() || '';
    return (
        <Panel title='More settings' description={'Jellyfin\'s full preference pages, for the less common options.'}>
            <LinkRow label='Display' description='Language, date format, screensaver' href={`#/mypreferencesdisplay?userId=${userId}`} />
            <LinkRow label='Playback' description='Codecs, audio channels, transcoding limits' href={`#/mypreferencesplayback?userId=${userId}`} />
            <LinkRow label='Subtitles' description='Fonts, position, burn-in' href={`#/mypreferencessubtitles?userId=${userId}`} />
            <LinkRow label='Controls' description='Gamepads and keyboard' href={`#/mypreferencescontrols?userId=${userId}`} />
            <Row label='Web client' description='Home Fin, built on Jellyfin Web'>
                <span className='hfSet-muted'>{__PACKAGE_JSON_VERSION__}</span>
            </Row>
        </Panel>
    );
};
