import React, { type FormEvent, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { accountsApi, isAccountsEnabled } from 'homefin/accounts/api';
import { ErrorBanner, Field, Screen, errorMessage, fireAndForget, useInputSetter } from 'homefin/accounts/components';
import { activateProfile, classicLoginHref } from 'homefin/accounts/session';

type Mode = 'new' | 'join';

/**
 * Move a Jellyfin login to Home Fin: prove it with the old username and password, then
 * either start an account of your own or join one someone in your household already has.
 * The Jellyfin user becomes the profile, so watch history, My List and favourites come along.
 */
export default function HomefinMove() {
    const navigate = useNavigate();
    const [step, setStep] = useState<'jellyfin' | 'account'>('jellyfin');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [jellyfinName, setJellyfinName] = useState('');
    const [keepsPassword, setKeepsPassword] = useState(true);
    const [mode, setMode] = useState<Mode>('new');
    const [profileName, setProfileName] = useState('');
    const [email, setEmail] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [accountPassword, setAccountPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const firstField = useRef<HTMLInputElement>(null);
    const onUsernameChange = useInputSetter(setUsername);
    const onPasswordChange = useInputSetter(setPassword);
    const onProfileNameChange = useInputSetter(setProfileName);
    const onEmailChange = useInputSetter(setEmail);
    const onNewPasswordChange = useInputSetter(setNewPassword);
    const onAccountPasswordChange = useInputSetter(setAccountPassword);

    useEffect(() => {
        fireAndForget(isAccountsEnabled().then(enabled => {
            if (!enabled) navigate(classicLoginHref().slice(1));
        }));
    }, [navigate]);

    useEffect(() => {
        firstField.current?.focus();
    }, [step, mode]);

    const checkJellyfin = useCallback((e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        accountsApi.moveCheck(username.trim(), password)
            .then(result => {
                setJellyfinName(result.name);
                setProfileName(result.name.slice(0, 30));
                setKeepsPassword(result.keepsPassword);
                setStep('account');
            })
            .catch(err => setError(errorMessage(err)))
            .finally(() => setBusy(false));
    }, [username, password]);

    const pickMode = useCallback((e: MouseEvent<HTMLButtonElement>) => {
        setMode(e.currentTarget.dataset.mode as Mode);
        setError('');
    }, []);

    const back = useCallback(() => {
        setStep('jellyfin');
        setError('');
    }, []);

    const move = useCallback((e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        accountsApi.move({
            username: username.trim(),
            password,
            mode,
            email,
            profileName,
            ...(mode === 'join' ? { accountPassword } : { newPassword: newPassword || undefined })
        })
            .then(me => {
                const profile = me.profiles.find(p => p.name === profileName);
                if (profile && !profile.locked) return activateProfile(profile);
                navigate('/homefin/profiles');
            })
            .catch(err => {
                setError(errorMessage(err));
                setBusy(false);
            });
    }, [username, password, mode, email, profileName, accountPassword, newPassword, navigate]);

    return (
        <Screen id='homefinMovePage' title='Move to Home Fin' variant='auth'>
            {step === 'jellyfin' ? (
                <form className='hfAuthCard' onSubmit={checkJellyfin}>
                    <h1>Move your Jellyfin login</h1>
                    <p className='hfAuthCard-note'>
                        Sign in with the username and password you used before. Your watch history, My List
                        and favourites come with you.
                    </p>
                    <ErrorBanner message={error} />
                    <Field ref={firstField} id='hfMoveUser' label='Jellyfin username' autoComplete='username' autoCapitalize='none' value={username} onChange={onUsernameChange} required />
                    <Field id='hfMovePassword' label='Jellyfin password' type='password' autoComplete='current-password' value={password} onChange={onPasswordChange} />
                    <button type='submit' className='hfButton hfButton-red hfButton-block' disabled={busy}>
                        {busy ? 'Checking…' : 'Continue'}
                    </button>
                    <a className='hfAuthCard-classic' href='#/homefin/login'>Already moved? Sign in with your email</a>
                </form>
            ) : (
                <form className='hfAuthCard' onSubmit={move}>
                    <p className='hfAuthCard-kicker'>
                        Moving <strong>{jellyfinName}</strong>{' '}
                        <button type='button' className='hfSignIn-link' onClick={back}>Change</button>
                    </p>
                    <h1>Where should it go?</h1>
                    <div className='hfMove-choice' role='radiogroup' aria-label='Account'>
                        <button type='button' role='radio' aria-checked={mode === 'new'} data-mode='new' onClick={pickMode}>
                            <strong className='hfMove-choiceTitle'>My own account</strong>
                            <span>Start a new Home Fin account with your email.</span>
                        </button>
                        <button type='button' role='radio' aria-checked={mode === 'join'} data-mode='join' onClick={pickMode}>
                            <strong className='hfMove-choiceTitle'>Join an account</strong>
                            <span>Someone in your household already moved? Become a profile in theirs.</span>
                        </button>
                    </div>
                    <ErrorBanner message={error} />
                    {mode === 'new' ? (
                        <>
                            <Field ref={firstField} id='hfMoveEmail' label='Your email address' type='email' autoComplete='email' value={email} onChange={onEmailChange} required />
                            {keepsPassword ? (
                                <>
                                    <p className='hfAuthCard-note hfMove-hint'>
                                        Your password stays the same, and your TVs and phones stay signed in.
                                        Want a new one? Type it here, or leave this empty.
                                    </p>
                                    <Field id='hfMoveNewPassword' label='New password (optional, 8+ characters)' type='password' autoComplete='new-password' minLength={8} value={newPassword} onChange={onNewPasswordChange} />
                                </>
                            ) : (
                                <Field id='hfMoveNewPassword' label='Choose a password (8+ characters)' type='password' autoComplete='new-password' minLength={8} value={newPassword} onChange={onNewPasswordChange} required />
                            )}
                        </>
                    ) : (
                        <>
                            <Field ref={firstField} id='hfMoveEmail' label="That account's email" type='email' autoComplete='off' value={email} onChange={onEmailChange} required />
                            <Field id='hfMoveAccountPassword' label="That account's password" type='password' autoComplete='off' value={accountPassword} onChange={onAccountPasswordChange} required />
                        </>
                    )}
                    <Field id='hfMoveProfileName' label='Profile name' autoComplete='nickname' maxLength={30} value={profileName} onChange={onProfileNameChange} required />
                    <button type='submit' className='hfButton hfButton-red hfButton-block' disabled={busy}>
                        {busy ? 'Moving…' : 'Move to Home Fin'}
                    </button>
                </form>
            )}
        </Screen>
    );
}
