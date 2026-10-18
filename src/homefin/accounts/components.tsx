import React, { type FC, type FormEvent, type PropsWithChildren, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Page from 'components/Page';

import { AccountsError, accountsApi, getAvatars, isAccountsEnabled, type AvatarPreset, type Maturity, type Me, type Profile } from './api';
import { Avatar, findAvatar } from './avatar';

import './accounts.scss';

export const BRAND_NAME = 'HOMEFIN';

export function errorMessage(err: unknown) {
    if (err instanceof AccountsError) return err.message;
    if (err instanceof Error) return err.message;
    return 'Something went wrong';
}

// ── layout ────────────────────────────────────────────────────────────────

interface ScreenProps {
    id: string
    title: string
    variant?: 'auth' | 'profiles' | 'plain'
    headerRight?: React.ReactNode
}

/** Full-screen Home Fin page without Jellyfin's header (sign in, profiles, account). */
export const Screen: FC<PropsWithChildren<ScreenProps>> = ({ id, title, variant = 'plain', headerRight, children }) => (
    <Page
        id={id}
        title={title}
        className={`hfAccountsPage hfScreen hfScreen-${variant}`}
        isBackButtonEnabled={false}
        isNowPlayingBarEnabled={false}
    >
        <header className='hfScreen-header'>
            <a className='hfScreen-wordmark' href='#/home'>{BRAND_NAME}</a>
            {headerRight}
        </header>
        <main className='hfScreen-main'>{children}</main>
    </Page>
);

// ── data hooks ───────────────────────────────────────────────────────────

/** Loads the signed-in account; sends signed-out visitors to the Home Fin sign-in page. */
export function useMe() {
    const navigate = useNavigate();
    const [me, setMe] = useState<Me | null>(null);
    const [error, setError] = useState('');

    const reload = useCallback(async () => {
        try {
            if (!(await isAccountsEnabled())) {
                navigate('/login');
                return;
            }
            setMe(await accountsApi.me());
        } catch (err) {
            if (err instanceof AccountsError && err.status === 401) navigate('/homefin/login');
            else setError(errorMessage(err));
        }
    }, [navigate]);

    useEffect(() => {
        void reload();
    }, [reload]);

    return { me, setMe, error, reload };
}

export function useAvatars() {
    const [avatars, setAvatars] = useState<AvatarPreset[]>([]);
    useEffect(() => {
        let alive = true;
        void getAvatars().then(list => {
            if (alive) setAvatars(list);
        });
        return () => {
            alive = false;
        };
    }, []);
    return avatars;
}

// ── small controls ───────────────────────────────────────────────────────

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label: string
}

/** Netflix-style input with a floating label. */
export const Field: FC<FieldProps> = ({ label, id, ...props }) => (
    <label className='hfField' htmlFor={id}>
        <input id={id} placeholder=' ' {...props} />
        <span>{label}</span>
    </label>
);

export const ErrorBanner: FC<{ message: string }> = ({ message }) => (
    message ? <div className='hfError' role='alert'>{message}</div> : null
);

// ── PIN pad ──────────────────────────────────────────────────────────────

interface PinPadProps {
    title: string
    subtitle?: string
    error?: string
    onSubmit: (pin: string) => void
    onCancel: () => void
}

/** Four-box PIN entry shown over the page, submits on the fourth digit. */
export const PinPad: FC<PinPadProps> = ({ title, subtitle, error, onSubmit, onCancel }) => {
    const [digits, setDigits] = useState(['', '', '', '']);
    const inputs = useRef<(HTMLInputElement | null)[]>([]);

    useEffect(() => {
        inputs.current[0]?.focus();
    }, []);

    useEffect(() => {
        if (error) {
            setDigits(['', '', '', '']);
            inputs.current[0]?.focus();
        }
    }, [error]);

    const setDigit = (index: number, value: string) => {
        const digit = value.replace(/\D/g, '').slice(-1);
        const next = [...digits];
        next[index] = digit;
        setDigits(next);
        if (digit && index < 3) inputs.current[index + 1]?.focus();
        if (digit && next.every(Boolean)) onSubmit(next.join(''));
    };

    const onKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) inputs.current[index - 1]?.focus();
        if (e.key === 'Escape') onCancel();
    };

    return (
        <div className='hfPinOverlay' role='dialog' aria-modal='true' aria-label={title}>
            <button type='button' className='hfPinOverlay-close' onClick={onCancel} aria-label='Cancel'>
                <span className='material-icons' aria-hidden='true'>close</span>
            </button>
            <p className='hfPinOverlay-kicker'>Profile Lock is on.</p>
            <h1 className='hfPinOverlay-title'>{title}</h1>
            {subtitle && <p className='hfPinOverlay-subtitle'>{subtitle}</p>}
            <div className={`hfPinBoxes${error ? ' is-error' : ''}`}>
                {digits.map((digit, i) => (
                    <input
                        // eslint-disable-next-line react/no-array-index-key -- fixed four boxes
                        key={i}
                        ref={el => { inputs.current[i] = el; }}
                        className='hfPinBox'
                        type='password'
                        inputMode='numeric'
                        autoComplete='off'
                        maxLength={1}
                        value={digit}
                        aria-label={`PIN digit ${i + 1}`}
                        onChange={e => setDigit(i, e.target.value)}
                        onKeyDown={e => onKeyDown(i, e)}
                    />
                ))}
            </div>
            {error && <p className='hfPinOverlay-error'>{error}</p>}
        </div>
    );
};

// ── avatar picker ────────────────────────────────────────────────────────

export const AvatarPicker: FC<{ avatars: AvatarPreset[], value: string, onPick: (key: string) => void, onClose: () => void }> = ({ avatars, value, onPick, onClose }) => (
    <div className='hfAvatarPicker' role='dialog' aria-modal='true' aria-label='Choose an icon'>
        <div className='hfAvatarPicker-header'>
            <button type='button' className='hfIconButton' onClick={onClose} aria-label='Back'>
                <span className='material-icons' aria-hidden='true'>arrow_back</span>
            </button>
            <h1>Choose a profile icon</h1>
        </div>
        <div className='hfAvatarPicker-grid'>
            {avatars.map(avatar => (
                <button
                    key={avatar.key}
                    type='button'
                    className={`hfAvatarPicker-option${avatar.key === value ? ' is-selected' : ''}`}
                    onClick={() => onPick(avatar.key)}
                    aria-label={avatar.key}
                >
                    <Avatar avatar={avatar} />
                </button>
            ))}
        </div>
    </div>
);

// ── profile editor ───────────────────────────────────────────────────────

const MATURITY_OPTIONS: { value: Maturity, label: string, hint: string }[] = [
    { value: 'all', label: 'All maturity ratings', hint: 'Shows everything in the library' },
    { value: 'teen', label: 'Teens', hint: 'Up to 12 / 12A / PG-13' },
    { value: 'kids', label: 'Kids', hint: 'Up to U / PG only' }
];

interface ProfileEditorProps {
    profile: Profile | null
    avatars: AvatarPreset[]
    canDelete: boolean
    /** PIN already entered for a locked profile (needed to change it). */
    currentPin?: string
    onSaved: (profiles: Profile[]) => void
    onCancel: () => void
}

export const ProfileEditor: FC<ProfileEditorProps> = ({ profile, avatars, canDelete, currentPin, onSaved, onCancel }) => {
    const isNew = !profile;
    const [name, setName] = useState(profile?.name ?? '');
    const [avatar, setAvatar] = useState(profile?.avatar ?? avatars[0]?.key ?? 'fox');
    const [maturity, setMaturity] = useState<Maturity>(profile?.maturity ?? 'all');
    const [lockMode, setLockMode] = useState<'keep' | 'set' | 'remove'>(profile?.locked ? 'keep' : 'remove');
    const [newPin, setNewPin] = useState('');
    const [picking, setPicking] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const save = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        let pin: string | null | undefined;
        if (lockMode === 'set') {
            if (!/^\d{4}$/.test(newPin)) {
                setError('PIN must be 4 digits');
                return;
            }
            pin = newPin;
        } else if (lockMode === 'remove' && profile?.locked) {
            pin = null;
        }
        setBusy(true);
        try {
            const result = isNew ?
                await accountsApi.createProfile({ name, avatar, maturity, pin: pin ?? null }) :
                await accountsApi.updateProfile(profile.id, { name, avatar, maturity, pin, currentPin });
            onSaved(result.profiles);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!profile) return;
        setBusy(true);
        try {
            const result = await accountsApi.deleteProfile(profile.id, currentPin);
            onSaved(result.profiles);
        } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
        }
    };

    if (picking) {
        return <AvatarPicker avatars={avatars} value={avatar} onPick={key => { setAvatar(key); setPicking(false); }} onClose={() => setPicking(false)} />;
    }

    if (confirmDelete && profile) {
        return (
            <div className='hfEditor hfEditor-confirm'>
                <h1>Delete profile?</h1>
                <div className='hfEditor-confirmBody'>
                    <Avatar avatar={findAvatar(avatars, avatar)} className='hfEditor-avatar' />
                    <p>This profile&apos;s history, My List, ratings and settings will be gone forever, and you won&apos;t be able to get them back.</p>
                </div>
                <ErrorBanner message={error} />
                <div className='hfEditor-actions'>
                    <button type='button' className='hfButton hfButton-primary' onClick={() => setConfirmDelete(false)}>Keep profile</button>
                    <button type='button' className='hfButton hfButton-outline' disabled={busy} onClick={remove}>Delete profile</button>
                </div>
            </div>
        );
    }

    return (
        <form className='hfEditor' onSubmit={save}>
            <h1>{isNew ? 'Add profile' : 'Edit profile'}</h1>
            {isNew && <p className='hfEditor-lede'>Add a profile for another person watching Home Fin.</p>}
            <div className='hfEditor-body'>
                <button type='button' className='hfEditor-avatarButton' onClick={() => setPicking(true)} aria-label='Change profile icon'>
                    <Avatar avatar={findAvatar(avatars, avatar)} className='hfEditor-avatar' />
                    <span className='hfEditor-avatarEdit material-icons' aria-hidden='true'>edit</span>
                </button>
                <div className='hfEditor-fields'>
                    <input
                        className='hfEditor-name'
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder='Name'
                        maxLength={30}
                        aria-label='Profile name'
                        required
                    />

                    <fieldset className='hfEditor-section'>
                        <legend>Maturity settings</legend>
                        {MATURITY_OPTIONS.map(option => (
                            <label key={option.value} className='hfRadio'>
                                <input type='radio' name='maturity' value={option.value} checked={maturity === option.value} onChange={() => setMaturity(option.value)} />
                                <span><strong>{option.label}</strong><small>{option.hint}</small></span>
                            </label>
                        ))}
                    </fieldset>

                    <fieldset className='hfEditor-section'>
                        <legend>Profile Lock</legend>
                        {profile?.locked && (
                            <label className='hfRadio'>
                                <input type='radio' name='lock' checked={lockMode === 'keep'} onChange={() => setLockMode('keep')} />
                                <span><strong>Keep the current PIN</strong></span>
                            </label>
                        )}
                        <label className='hfRadio'>
                            <input type='radio' name='lock' checked={lockMode === 'set'} onChange={() => setLockMode('set')} />
                            <span><strong>{profile?.locked ? 'Change the PIN' : 'Require a PIN to open this profile'}</strong></span>
                        </label>
                        {lockMode === 'set' && (
                            <input
                                className='hfEditor-pin'
                                inputMode='numeric'
                                autoComplete='off'
                                maxLength={4}
                                placeholder='4-digit PIN'
                                value={newPin}
                                onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                aria-label='New PIN'
                            />
                        )}
                        <label className='hfRadio'>
                            <input type='radio' name='lock' checked={lockMode === 'remove'} onChange={() => setLockMode('remove')} />
                            <span><strong>No PIN</strong></span>
                        </label>
                    </fieldset>
                </div>
            </div>
            <ErrorBanner message={error} />
            <div className='hfEditor-actions'>
                <button type='submit' className='hfButton hfButton-primary' disabled={busy || !name.trim()}>Save</button>
                <button type='button' className='hfButton hfButton-outline' onClick={onCancel}>Cancel</button>
                {!isNew && canDelete && (
                    <button type='button' className='hfButton hfButton-outline' onClick={() => setConfirmDelete(true)}>Delete profile</button>
                )}
            </div>
        </form>
    );
};
