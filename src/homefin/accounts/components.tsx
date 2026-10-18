import React, { type ChangeEvent, type FC, type FormEvent, type KeyboardEvent, type PropsWithChildren, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Page from 'components/Page';

import { AccountsError, accountsApi, getAvatars, isAccountsEnabled, type AvatarPreset, type Maturity, type Me, type Profile, type ProfileCredential } from './api';
import { Avatar, findAvatar } from './avatar';

import './accounts.scss';

export const BRAND_NAME = 'HOMEFIN';
export const MAX_PROFILES = 5;

export function errorMessage(err: unknown) {
    if (err instanceof AccountsError) return err.message;
    if (err instanceof Error) return err.message;
    return 'Something went wrong';
}

/** Run a promise from an event handler or effect, logging anything it throws. */
export function fireAndForget(promise: Promise<unknown>) {
    promise.catch(err => console.error('[Home Fin]', err));
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
        fireAndForget(reload());
    }, [reload]);

    return { me, setMe, error, reload };
}

export function useAvatars() {
    const [avatars, setAvatars] = useState<AvatarPreset[]>([]);
    useEffect(() => {
        let alive = true;
        fireAndForget(getAvatars().then(list => {
            if (alive) setAvatars(list);
        }));
        return () => {
            alive = false;
        };
    }, []);
    return avatars;
}

/** `onChange` handler that copies an input's value into a string state setter. */
export function useInputSetter(setter: (value: string) => void) {
    return useCallback((e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setter(e.target.value), [setter]);
}

// ── small controls ───────────────────────────────────────────────────────

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
    id: string
    label: string
}

/** Netflix-style input with a floating label. */
export const Field: FC<FieldProps> = ({ label, id, ...props }) => (
    <div className='hfField'>
        <input id={id} className='hfField-input' placeholder=' ' {...props} />
        <label htmlFor={id}>{label}</label>
    </div>
);

export const ErrorBanner: FC<{ message: string }> = ({ message }) => (
    message ? <div className='hfError' role='alert'>{message}</div> : null
);

// ── PIN pad ──────────────────────────────────────────────────────────────

interface PinPadProps {
    title: string
    subtitle?: string
    /** Shown under the boxes; the boxes clear whenever it changes to a non-empty message. */
    error?: string
    onSubmit: (pin: string) => void
    onCancel: () => void
    /** Offers "Forgot PIN?" when set. */
    onForgot?: () => void
}

const EMPTY_PIN = ['', '', '', ''];

/** Four-box PIN entry shown over the page, submits on the fourth digit. */
export const PinPad: FC<PinPadProps> = ({ title, subtitle, error, onSubmit, onCancel, onForgot }) => {
    const [digits, setDigits] = useState(EMPTY_PIN);
    const inputs = useRef<(HTMLInputElement | null)[]>([]);

    useEffect(() => {
        inputs.current[0]?.focus();
    }, []);

    useEffect(() => {
        if (error) {
            setDigits(EMPTY_PIN);
            inputs.current[0]?.focus();
        }
    }, [error]);

    const setRef = useCallback((el: HTMLInputElement | null) => {
        if (el) inputs.current[Number(el.dataset.index)] = el;
    }, []);

    const onChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const index = Number(e.target.dataset.index);
        const digit = e.target.value.replace(/\D/g, '').slice(-1);
        const next = [...digits];
        next[index] = digit;
        setDigits(next);
        if (digit && index < 3) inputs.current[index + 1]?.focus();
        if (digit && next.every(Boolean)) onSubmit(next.join(''));
    }, [digits, onSubmit]);

    const onKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
        const index = Number(e.currentTarget.dataset.index);
        if (e.key === 'Backspace' && !e.currentTarget.value && index > 0) inputs.current[index - 1]?.focus();
        if (e.key === 'Escape') onCancel();
    }, [onCancel]);

    return (
        <div className='hfPinOverlay' role='dialog' aria-modal='true' aria-label={title}>
            <button type='button' className='hfPinOverlay-close' onClick={onCancel} aria-label='Cancel'>
                <span className='material-icons' aria-hidden='true'>close</span>
            </button>
            <p className='hfPinOverlay-kicker'>Profile Lock is currently on.</p>
            <h1 className='hfPinOverlay-title'>{title}</h1>
            {subtitle && <p className='hfPinOverlay-subtitle'>{subtitle}</p>}
            <div className={`hfPinBoxes${error ? ' is-error' : ''}`}>
                {digits.map((digit, i) => (
                    <input
                        // eslint-disable-next-line react/no-array-index-key -- fixed four boxes
                        key={i}
                        ref={setRef}
                        data-index={i}
                        className='hfPinBox'
                        type='password'
                        inputMode='numeric'
                        autoComplete='off'
                        maxLength={1}
                        value={digit}
                        aria-label={`PIN digit ${i + 1}`}
                        onChange={onChange}
                        onKeyDown={onKeyDown}
                    />
                ))}
            </div>
            {error && <p className='hfPinOverlay-error'>{error}</p>}
            {onForgot && <button type='button' className='hfPinOverlay-forgot' onClick={onForgot}>Forgot PIN?</button>}
        </div>
    );
};

// ── "Forgot PIN?": the account password instead ─────────────────────────

interface PasswordPromptProps {
    title: string
    error?: string
    onSubmit: (password: string) => void
    onCancel: () => void
}

/** Full-screen account password check, used in place of a forgotten profile PIN. */
export const PasswordPrompt: FC<PasswordPromptProps> = ({ title, error, onSubmit, onCancel }) => {
    const [password, setPassword] = useState('');
    const onPasswordChange = useInputSetter(setPassword);
    const submit = useCallback((e: FormEvent) => {
        e.preventDefault();
        if (password) onSubmit(password);
    }, [password, onSubmit]);

    return (
        <div className='hfPinOverlay' role='dialog' aria-modal='true' aria-label={title}>
            <button type='button' className='hfPinOverlay-close' onClick={onCancel} aria-label='Cancel'>
                <span className='material-icons' aria-hidden='true'>close</span>
            </button>
            <h1 className='hfPinOverlay-title'>{title}</h1>
            <p className='hfPinOverlay-subtitle'>Enter your account password to change or remove this profile&apos;s PIN.</p>
            <form className='hfPasswordPrompt' onSubmit={submit}>
                <Field id='hfForgotPassword' label='Account password' type='password' autoComplete='current-password' value={password} onChange={onPasswordChange} required />
                <button type='submit' className='hfButton hfButton-primary' disabled={!password}>Continue</button>
            </form>
            {error && <p className='hfPinOverlay-error'>{error}</p>}
        </div>
    );
};

// ── avatar picker ────────────────────────────────────────────────────────

interface AvatarPickerProps {
    avatars: AvatarPreset[]
    value: string
    onPick: (key: string) => void
    onClose: () => void
}

export const AvatarPicker: FC<AvatarPickerProps> = ({ avatars, value, onPick, onClose }) => {
    const pick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
        onPick(e.currentTarget.dataset.key || '');
    }, [onPick]);

    return (
        <div className='hfAvatarPicker' role='dialog' aria-modal='true' aria-label='Choose a profile icon'>
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
                        data-key={avatar.key}
                        className={`hfAvatarPicker-option${avatar.key === value ? ' is-selected' : ''}`}
                        onClick={pick}
                        aria-label={avatar.key}
                    >
                        <Avatar avatar={avatar} />
                    </button>
                ))}
            </div>
        </div>
    );
};

// ── profile editor ───────────────────────────────────────────────────────

const MATURITY_OPTIONS: { value: Maturity, label: string, hint: string }[] = [
    { value: 'all', label: 'All maturity ratings', hint: 'Shows everything in the library' },
    { value: 'teen', label: 'Teens', hint: 'Up to 12 / 12A / PG-13' },
    { value: 'kids', label: 'Kids', hint: 'Up to U / PG only' }
];

type LockMode = 'keep' | 'set' | 'remove';

interface ProfileEditorProps {
    profile: Profile | null
    avatars: AvatarPreset[]
    canDelete: boolean
    /** PIN (or account password) already given for a locked profile; needed to change it. */
    credential?: ProfileCredential
    onSaved: (profiles: Profile[]) => void
    /** Omit when there is nothing to go back to (an account's first profile). */
    onCancel?: () => void
}

export const ProfileEditor: FC<ProfileEditorProps> = ({ profile, avatars, canDelete, credential, onSaved, onCancel }) => {
    const isNew = !profile;
    const [name, setName] = useState(profile?.name ?? '');
    const [avatar, setAvatar] = useState(profile?.avatar ?? avatars[0]?.key ?? 'fox');
    const [maturity, setMaturity] = useState<Maturity>(profile?.maturity ?? 'all');
    const [lockMode, setLockMode] = useState<LockMode>(profile?.locked ? 'keep' : 'remove');
    const [newPin, setNewPin] = useState('');
    const [picking, setPicking] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const onNameChange = useInputSetter(setName);
    const onMaturityChange = useCallback((e: ChangeEvent<HTMLInputElement>) => setMaturity(e.target.value as Maturity), []);
    const onLockChange = useCallback((e: ChangeEvent<HTMLInputElement>) => setLockMode(e.target.value as LockMode), []);
    const onPinChange = useCallback((e: ChangeEvent<HTMLInputElement>) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4)), []);
    const openPicker = useCallback(() => setPicking(true), []);
    const closePicker = useCallback(() => setPicking(false), []);
    const pickAvatar = useCallback((key: string) => {
        setAvatar(key);
        setPicking(false);
    }, []);
    const askDelete = useCallback(() => setConfirmDelete(true), []);
    const keepProfile = useCallback(() => setConfirmDelete(false), []);

    const save = useCallback(async (e: FormEvent) => {
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
            const result = profile ?
                await accountsApi.updateProfile(profile.id, { name, avatar, maturity, pin, ...credential }) :
                await accountsApi.createProfile({ name, avatar, maturity, pin: pin ?? null });
            onSaved(result.profiles);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    }, [lockMode, newPin, profile, name, avatar, maturity, credential, onSaved]);

    const onSubmit = useCallback((e: FormEvent) => fireAndForget(save(e)), [save]);

    const remove = useCallback(() => {
        if (!profile) return;
        setBusy(true);
        accountsApi.deleteProfile(profile.id, credential)
            .then(result => onSaved(result.profiles))
            .catch(err => {
                setError(errorMessage(err));
                setBusy(false);
            });
    }, [profile, credential, onSaved]);

    if (picking) {
        return <AvatarPicker avatars={avatars} value={avatar} onPick={pickAvatar} onClose={closePicker} />;
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
                    <button type='button' className='hfButton hfButton-primary' onClick={keepProfile}>Keep profile</button>
                    <button type='button' className='hfButton hfButton-outline' disabled={busy} onClick={remove}>Delete profile</button>
                </div>
            </div>
        );
    }

    return (
        <form className='hfEditor' onSubmit={onSubmit}>
            <h1>{isNew ? 'Add profile' : 'Edit profile'}</h1>
            {isNew && <p className='hfEditor-lede'>{onCancel ? 'Add a profile for another person watching Home Fin.' : 'Create your first profile to start watching.'}</p>}
            <div className='hfEditor-body'>
                <button type='button' className='hfEditor-avatarButton' onClick={openPicker} aria-label='Change profile icon'>
                    <Avatar avatar={findAvatar(avatars, avatar)} className='hfEditor-avatar' />
                    <span className='hfEditor-avatarEdit material-icons' aria-hidden='true'>edit</span>
                </button>
                <div className='hfEditor-fields'>
                    <input
                        className='hfEditor-name'
                        value={name}
                        onChange={onNameChange}
                        placeholder='Name'
                        maxLength={30}
                        aria-label='Profile name'
                        required
                    />

                    <fieldset className='hfEditor-section'>
                        <legend>Maturity settings</legend>
                        {MATURITY_OPTIONS.map(option => (
                            <label key={option.value} className='hfRadio'>
                                <input type='radio' name='maturity' value={option.value} checked={maturity === option.value} onChange={onMaturityChange} />
                                <strong>{option.label}</strong>
                                <small>{option.hint}</small>
                            </label>
                        ))}
                    </fieldset>

                    <fieldset className='hfEditor-section'>
                        <legend>Profile Lock</legend>
                        {profile?.locked && (
                            <label className='hfRadio'>
                                <input type='radio' name='lock' value='keep' checked={lockMode === 'keep'} onChange={onLockChange} />
                                <strong>Keep the current PIN</strong>
                            </label>
                        )}
                        <label className='hfRadio'>
                            <input type='radio' name='lock' value='set' checked={lockMode === 'set'} onChange={onLockChange} />
                            <strong>{profile?.locked ? 'Change the PIN' : 'Require a PIN to open this profile'}</strong>
                        </label>
                        {lockMode === 'set' && (
                            <input
                                className='hfEditor-pin'
                                inputMode='numeric'
                                autoComplete='off'
                                maxLength={4}
                                placeholder='4-digit PIN'
                                value={newPin}
                                onChange={onPinChange}
                                aria-label='New PIN'
                            />
                        )}
                        <label className='hfRadio'>
                            <input type='radio' name='lock' value='remove' checked={lockMode === 'remove'} onChange={onLockChange} />
                            <strong>No PIN</strong>
                        </label>
                    </fieldset>
                </div>
            </div>
            <ErrorBanner message={error} />
            <div className='hfEditor-actions'>
                <button type='submit' className='hfButton hfButton-primary' disabled={busy || !name.trim()}>Save</button>
                {onCancel && <button type='button' className='hfButton hfButton-outline' onClick={onCancel}>Cancel</button>}
                {!isNew && canDelete && (
                    <button type='button' className='hfButton hfButton-outline' onClick={askDelete}>Delete profile</button>
                )}
            </div>
        </form>
    );
};
