// Settings for admins: Sonarr / Radarr for requests, quick links to the rest of the stack, server tools.
import React, { type ChangeEvent, type FC, type FormEvent, type MouseEvent, useCallback, useEffect, useState } from 'react';

import {
    type ArrSettings, type ArrTestResult, type QuickLink, type RequestPolicy, getRequestsConfig, requestsApi
} from 'homefin/accounts/api';
import { errorMessage, fireAndForget } from 'homefin/accounts/components';

import { Choice, LinkRow, type Option, Panel, failed, saved, toast } from './controls';

type Service = 'radarr' | 'sonarr';

const SERVICE_INFO: Record<Service, { name: string, port: number, what: string }> = {
    radarr: { name: 'Radarr', port: 7878, what: 'films' },
    sonarr: { name: 'Sonarr', port: 8989, what: 'shows' }
};

export const POLICY_OPTIONS: Option[] = [
    { value: 'approve', label: 'Need my approval' },
    { value: 'auto', label: 'Go straight through' },
    { value: 'off', label: 'Can\'t request' }
];

function gigabytes(bytes: number | null) {
    return bytes ? ` (${Math.round(bytes / 1e9).toLocaleString()} GB free)` : '';
}

// ── Sonarr / Radarr ──────────────────────────────────────────────────────

interface ArrFormProps {
    service: Service
    saved: ArrSettings | null
    onChanged: () => void
}

const ArrForm: FC<ArrFormProps> = ({ service, saved: current, onChanged }) => {
    const info = SERVICE_INFO[service];
    const [url, setUrl] = useState(current?.url || '');
    const [apiKey, setApiKey] = useState('');
    const [test, setTest] = useState<ArrTestResult | null>(null);
    const [quality, setQuality] = useState(String(current?.qualityProfileId ?? ''));
    const [folder, setFolder] = useState(current?.rootFolderPath ?? '');
    const [language, setLanguage] = useState(String(current?.languageProfileId ?? ''));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const runTest = useCallback((fields: { url: string, apiKey?: string }) => {
        setBusy(true);
        setError('');
        return requestsApi.admin.testIntegration(service, fields)
            .then(result => {
                setTest(result);
                setQuality(q => q || String(result.qualityProfiles[0]?.id ?? ''));
                setFolder(f => f || (result.rootFolders[0]?.path ?? ''));
                setLanguage(l => l || String(result.languageProfiles[0]?.id ?? ''));
                return result;
            })
            .catch(err => {
                setTest(null);
                setError(errorMessage(err));
                return null;
            })
            .finally(() => setBusy(false));
    }, [service]);

    // Already connected: load its quality profiles and folders with the saved key.
    useEffect(() => {
        if (current?.url) fireAndForget(runTest({ url: current.url }));
    }, [current?.url, runTest]);

    const onUrl = useCallback((e: ChangeEvent<HTMLInputElement>) => setUrl(e.target.value), []);
    const onKey = useCallback((e: ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value), []);
    const onQuality = useCallback((e: ChangeEvent<HTMLSelectElement>) => setQuality(e.target.value), []);
    const onFolder = useCallback((e: ChangeEvent<HTMLSelectElement>) => setFolder(e.target.value), []);
    const onLanguage = useCallback((e: ChangeEvent<HTMLSelectElement>) => setLanguage(e.target.value), []);

    const onTest = useCallback(() => {
        fireAndForget(runTest({ url, apiKey: apiKey || undefined }));
    }, [runTest, url, apiKey]);

    const onSave = useCallback((e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        requestsApi.admin.saveIntegration(service, {
            url,
            apiKey: apiKey || undefined,
            qualityProfileId: quality ? Number(quality) : undefined,
            rootFolderPath: folder || undefined,
            languageProfileId: language ? Number(language) : null
        })
            .then(() => {
                setApiKey('');
                saved();
                getRequestsConfig(true).catch(() => null);
                onChanged();
            })
            .catch(err => setError(errorMessage(err)))
            .finally(() => setBusy(false));
    }, [service, url, apiKey, quality, folder, language, onChanged]);

    const onRemove = useCallback(() => {
        // eslint-disable-next-line no-restricted-globals -- a plain yes / no
        if (!confirm(`Disconnect ${info.name}? Requests for ${info.what} stop until you connect it again.`)) return;
        requestsApi.admin.removeIntegration(service)
            .then(() => {
                setUrl('');
                setTest(null);
                toast(`${info.name} disconnected`);
                getRequestsConfig(true).catch(() => null);
                onChanged();
            })
            .catch(failed);
    }, [service, info, onChanged]);

    let statusText = 'Not connected';
    if (current) statusText = test ? `Connected: v${test.version}` : 'Connected';

    return (
        <form className='hfSet-arr' onSubmit={onSave}>
            <div className='hfSet-arrHead'>
                <h3>{info.name}</h3>
                <span className={`hfSet-status${current ? ' is-on' : ''}`}>{statusText}</span>
            </div>
            <div className='hfSet-fields'>
                <label className='hfSet-field'>
                    <span>Address</span>
                    <input type='url' value={url} onChange={onUrl} placeholder={`http://192.168.1.20:${info.port}`} required />
                </label>
                <label className='hfSet-field'>
                    <span>API key</span>
                    <input
                        type='password'
                        value={apiKey}
                        onChange={onKey}
                        placeholder={current ? 'Saved (type a new one to change it)' : `${info.name} → Settings → General`}
                        autoComplete='off'
                        required={!current}
                    />
                </label>
                {test && (
                    <>
                        <label className='hfSet-field'>
                            <span>Quality</span>
                            <select value={quality} onChange={onQuality}>
                                {test.qualityProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </label>
                        <label className='hfSet-field'>
                            <span>Save {info.what} to</span>
                            <select value={folder} onChange={onFolder}>
                                {test.rootFolders.map(f => <option key={f.path} value={f.path}>{f.path}{gigabytes(f.freeSpace)}</option>)}
                            </select>
                        </label>
                        {test.languageProfiles.length > 0 && (
                            <label className='hfSet-field'>
                                <span>Language</span>
                                <select value={language} onChange={onLanguage}>
                                    {test.languageProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                            </label>
                        )}
                    </>
                )}
            </div>
            {error && <p className='hfSet-error' role='alert'>{error}</p>}
            <div className='hfSet-actions'>
                <button type='button' className='hfSet-button' onClick={onTest} disabled={busy || !url}>Test</button>
                <button type='submit' className='hfSet-button hfSet-button-primary' disabled={busy || !url || (!current && !apiKey)}>
                    {current ? 'Save' : 'Connect'}
                </button>
                {current && <button type='button' className='hfSet-linkButton' onClick={onRemove}>Disconnect</button>}
            </div>
        </form>
    );
};

export const AppsSection: FC = () => {
    const [settings, setSettings] = useState<Awaited<ReturnType<typeof requestsApi.admin.integrations>> | null>(null);
    const [error, setError] = useState('');

    const load = useCallback(() => {
        requestsApi.admin.integrations().then(setSettings).catch(err => setError(errorMessage(err)));
    }, []);
    useEffect(load, [load]);

    const setDefault = useCallback((value: string) => {
        requestsApi.admin.setDefaultPolicy(value as RequestPolicy)
            .then(() => {
                setSettings(current => (current ? { ...current, defaultPolicy: value as RequestPolicy } : current));
                saved();
            })
            .catch(failed);
    }, []);

    if (error) return <Panel title='Requests'><p className='hfSet-error'>{error}</p></Panel>;
    if (!settings) return <Panel title='Requests'><p className='hfSet-muted'>Loading…</p></Panel>;

    return (
        <>
            <Panel
                title='Requests'
                description={'Connect Radarr (films) and Sonarr (shows). Everyone can then search for titles that aren\'t here and ask for them under Requests.'}
            >
                <ArrForm service='radarr' saved={settings.radarr} onChanged={load} />
                <ArrForm service='sonarr' saved={settings.sonarr} onChanged={load} />
            </Panel>
            <Panel title='Who can request'>
                <Choice
                    id='hfSetDefaultPolicy'
                    label='People still on a Jellyfin login'
                    description='Home Fin accounts each have their own setting, under People.'
                    value={settings.defaultPolicy}
                    options={POLICY_OPTIONS}
                    onChange={setDefault}
                />
                <LinkRow label='People' description='Choose per account: approval first, straight through, or no requests' href='#/homefin/admin' />
                <LinkRow label='Requests waiting for you' href='#/homefin/requests' />
            </Panel>
        </>
    );
};

// ── quick links ──────────────────────────────────────────────────────────

const LINK_ICONS: Option[] = [
    { value: 'tv', label: 'TV' },
    { value: 'movie', label: 'Film' },
    { value: 'travel_explore', label: 'Search' },
    { value: 'subtitles', label: 'Subtitles' },
    { value: 'library_music', label: 'Music' },
    { value: 'menu_book', label: 'Books' },
    { value: 'download', label: 'Download' },
    { value: 'insights', label: 'Stats' },
    { value: 'dashboard', label: 'Dashboard' },
    { value: 'dns', label: 'Server' },
    { value: 'link', label: 'Link' }
];

const PRESETS: { name: string, port: number, icon: string }[] = [
    { name: 'Sonarr', port: 8989, icon: 'tv' },
    { name: 'Radarr', port: 7878, icon: 'movie' },
    { name: 'Prowlarr', port: 9696, icon: 'travel_explore' },
    { name: 'Bazarr', port: 6767, icon: 'subtitles' },
    { name: 'Lidarr', port: 8686, icon: 'library_music' },
    { name: 'Readarr', port: 8787, icon: 'menu_book' },
    { name: 'qBittorrent', port: 8080, icon: 'download' },
    { name: 'SABnzbd', port: 8080, icon: 'download' },
    { name: 'Jellystat', port: 3000, icon: 'insights' }
];

const LAN_SCHEME = 'http';

const AUDIENCE: Option[] = [
    { value: 'admins', label: 'Admins' },
    { value: 'everyone', label: 'Everyone' }
];

export const LinksSection: FC = () => {
    const [links, setLinks] = useState<QuickLink[] | null>(null);
    const [error, setError] = useState('');
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        requestsApi.admin.links().then(result => setLinks(result.links)).catch(err => setError(errorMessage(err)));
    }, []);

    const change = useCallback((index: number, patch: Partial<QuickLink>) => {
        setLinks(current => current?.map((link, i) => (i === index ? { ...link, ...patch } : link)) ?? null);
        setDirty(true);
    }, []);

    const onField = useCallback((e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const index = Number(e.currentTarget.dataset.index);
        change(index, { [e.currentTarget.name]: e.currentTarget.value } as Partial<QuickLink>);
    }, [change]);

    const onMove = useCallback((e: MouseEvent<HTMLButtonElement>) => {
        const index = Number(e.currentTarget.dataset.index);
        const to = index + Number(e.currentTarget.dataset.step);
        setLinks(current => {
            if (!current || to < 0 || to >= current.length) return current;
            const next = [...current];
            [next[index], next[to]] = [next[to], next[index]];
            return next;
        });
        setDirty(true);
    }, []);

    const onRemove = useCallback((e: MouseEvent<HTMLButtonElement>) => {
        const index = Number(e.currentTarget.dataset.index);
        setLinks(current => current?.filter((_, i) => i !== index) ?? null);
        setDirty(true);
    }, []);

    const onAdd = useCallback((e: MouseEvent<HTMLButtonElement>) => {
        const preset = PRESETS.find(p => p.name === e.currentTarget.dataset.preset);
        // Most of the stack runs on plain http on the home network; the admin can change it.
        const base = `${LAN_SCHEME}://${window.location.hostname}`;
        setLinks(current => [...(current || []), {
            name: preset?.name || '',
            url: preset ? `${base}:${preset.port}` : `${LAN_SCHEME}://`,
            icon: preset?.icon || 'link',
            audience: 'admins'
        }]);
        setDirty(true);
    }, []);

    const onSave = useCallback((e: FormEvent) => {
        e.preventDefault();
        if (!links) return;
        setError('');
        requestsApi.admin.saveLinks(links)
            .then(result => {
                setLinks(result.links);
                setDirty(false);
                saved();
            })
            .catch(err => setError(errorMessage(err)));
    }, [links]);

    return (
        <Panel
            title='Quick links'
            description='Shortcuts to the rest of your stack, in the profile menu. Admins see them all; choose Everyone to show one to the household too.'
        >
            {!links && !error && <p className='hfSet-muted'>Loading…</p>}
            {links && (
                <form onSubmit={onSave} className='hfSet-links'>
                    {links.length === 0 && <p className='hfSet-muted'>No links yet. Add your apps below.</p>}
                    {links.map((link, i) => (
                        // eslint-disable-next-line react/no-array-index-key -- rows have no id; order is the identity
                        <div className='hfSet-linkEdit' key={i}>
                            <span className='material-icons hfSet-linkIcon' aria-hidden='true'>{link.icon}</span>
                            <select name='icon' data-index={i} value={link.icon} onChange={onField} aria-label='Icon'>
                                {LINK_ICONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <input name='name' data-index={i} value={link.name} onChange={onField} placeholder='Name' aria-label='Name' maxLength={40} required />
                            <input name='url' data-index={i} type='url' value={link.url} onChange={onField} placeholder='Address' aria-label='Address' required />
                            <select name='audience' data-index={i} value={link.audience} onChange={onField} aria-label='Who sees it'>
                                {AUDIENCE.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <span className='hfSet-linkButtons'>
                                <button type='button' data-index={i} data-step={-1} onClick={onMove} aria-label='Move up' disabled={i === 0}>
                                    <span className='material-icons' aria-hidden='true'>arrow_upward</span>
                                </button>
                                <button type='button' data-index={i} data-step={1} onClick={onMove} aria-label='Move down' disabled={i === links.length - 1}>
                                    <span className='material-icons' aria-hidden='true'>arrow_downward</span>
                                </button>
                                <button type='button' data-index={i} onClick={onRemove} aria-label='Remove'>
                                    <span className='material-icons' aria-hidden='true'>delete_outline</span>
                                </button>
                            </span>
                        </div>
                    ))}
                    <div className='hfSet-presets'>
                        <span>Add:</span>
                        {PRESETS.map(p => (
                            <button key={p.name} type='button' data-preset={p.name} onClick={onAdd} disabled={links.some(l => l.name === p.name)}>{p.name}</button>
                        ))}
                        <button type='button' onClick={onAdd}>Other…</button>
                    </div>
                    {error && <p className='hfSet-error' role='alert'>{error}</p>}
                    <div className='hfSet-actions'>
                        <button type='submit' className='hfSet-button hfSet-button-primary' disabled={!dirty}>Save links</button>
                    </div>
                </form>
            )}
            {!links && error && <p className='hfSet-error'>{error}</p>}
        </Panel>
    );
};

// ── server ───────────────────────────────────────────────────────────────

export const ServerSection: FC = () => (
    <Panel title='Server'>
        <LinkRow label='Jellyfin Dashboard' description='Libraries, users, transcoding, plugins, logs' href='#/dashboard' />
        <LinkRow label='Metadata manager' description='Fix titles, artwork and details' href='#/metadata' />
        <LinkRow label='People' description='Accounts, invites, moving people over from Jellyfin logins' href='#/homefin/admin' />
    </Panel>
);
