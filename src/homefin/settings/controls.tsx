// Building blocks for Home Fin settings: titled panels, rows with a label and a control,
// switches and selects that save as soon as they change.
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto';
import type { UserConfiguration } from '@jellyfin/sdk/lib/generated-client/models/user-configuration';
import React, { type ChangeEvent, type FC, type PropsWithChildren, type ReactNode, useCallback, useEffect, useState } from 'react';

import { errorMessage } from 'homefin/accounts/components';
import { ServerConnections } from 'lib/jellyfin-apiclient';

export interface Option {
    value: string
    label: string
}

export const Panel: FC<PropsWithChildren<{ title: string, description?: ReactNode }>> = ({ title, description, children }) => (
    <section className='hfSet-panel'>
        <h2>{title}</h2>
        {description && <p className='hfSet-panelNote'>{description}</p>}
        <div className='hfSet-rows'>{children}</div>
    </section>
);

interface RowProps {
    label: string
    description?: ReactNode
    htmlFor?: string
    className?: string
}

export const Row: FC<PropsWithChildren<RowProps>> = ({ label, description, htmlFor, className = '', children }) => (
    <div className={`hfSet-row ${className}`.trim()}>
        <div className='hfSet-rowText'>
            {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className='hfSet-rowLabel'>{label}</span>}
            {description && <span className='hfSet-rowNote'>{description}</span>}
        </div>
        <div className='hfSet-rowControl'>{children}</div>
    </div>
);

interface ToggleProps {
    id: string
    label: string
    description?: ReactNode
    checked: boolean
    onChange: (checked: boolean) => void
}

/** An on/off switch row. */
export const Toggle: FC<ToggleProps> = ({ id, label, description, checked, onChange }) => {
    const change = useCallback((e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked), [onChange]);
    return (
        <Row label={label} description={description} htmlFor={id} className='hfSet-row-switch'>
            <input id={id} type='checkbox' role='switch' className='hfSet-switch' checked={checked} onChange={change} />
        </Row>
    );
};

interface ChoiceProps {
    id: string
    label: string
    description?: ReactNode
    value: string
    options: Option[]
    onChange: (value: string) => void
}

/** A select row. */
export const Choice: FC<ChoiceProps> = ({ id, label, description, value, options, onChange }) => {
    const change = useCallback((e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value), [onChange]);
    return (
        <Row label={label} description={description} htmlFor={id}>
            <select id={id} className='hfSet-select' value={value} onChange={change}>
                {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
        </Row>
    );
};

/** A link row ("Edit profiles ›"). */
export const LinkRow: FC<{ label: string, description?: ReactNode, href: string, external?: boolean }> = ({ label, description, href, external }) => (
    <a className='hfSet-row hfSet-linkRow' href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        <span className='hfSet-rowText'>
            <span className='hfSet-rowLabel'>{label}</span>
            {description && <span className='hfSet-rowNote'>{description}</span>}
        </span>
        <span className='material-icons' aria-hidden='true'>{external ? 'open_in_new' : 'chevron_right'}</span>
    </a>
);

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** A brief "Saved" (or error) note at the bottom of the screen. */
export function toast(message: string, isError = false) {
    let el = document.querySelector<HTMLElement>('.hfSet-toast');
    if (!el) {
        el = document.createElement('div');
        el.className = 'hfSet-toast';
        el.setAttribute('role', 'status');
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.toggle('is-error', isError);
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el?.classList.remove('is-visible'), isError ? 5000 : 1800);
}

export function saved() {
    toast('Saved');
}

export function failed(err: unknown) {
    toast(errorMessage(err), true);
}

/** The signed-in Jellyfin user and a saver for their server-side settings (audio, subtitles, autoplay). */
export function useUserConfig() {
    const [user, setUser] = useState<UserDto | null>(null);

    useEffect(() => {
        const apiClient = ServerConnections.currentApiClient();
        if (!apiClient) return;
        apiClient.getUser(apiClient.getCurrentUserId()).then(setUser).catch(failed);
    }, []);

    const save = useCallback((patch: Partial<UserConfiguration>) => {
        const apiClient = ServerConnections.currentApiClient();
        if (!apiClient || !user?.Id) return;
        const config = { ...user.Configuration, ...patch } as UserConfiguration;
        setUser({ ...user, Configuration: config });
        apiClient.updateUserConfiguration(user.Id, config).then(saved).catch(failed);
    }, [user]);

    return { user, config: user?.Configuration, save };
}

/** Languages Jellyfin knows, for audio and subtitle preferences. */
export function useLanguages() {
    const [languages, setLanguages] = useState<Option[]>([]);
    useEffect(() => {
        ServerConnections.currentApiClient()?.getCultures().then(cultures => {
            const seen = new Set<string>();
            setLanguages(cultures
                .filter(c => c.ThreeLetterISOLanguageName && !seen.has(c.ThreeLetterISOLanguageName) && seen.add(c.ThreeLetterISOLanguageName))
                .map(c => ({ value: c.ThreeLetterISOLanguageName as string, label: c.DisplayName as string }))
                .sort((a, b) => a.label.localeCompare(b.label)));
        }).catch(() => setLanguages([]));
    }, []);
    return languages;
}
