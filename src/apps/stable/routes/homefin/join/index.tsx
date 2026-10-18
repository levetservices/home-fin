import React, { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { accountsApi } from 'homefin/accounts/api';
import { ErrorBanner, Field, Screen, errorMessage, useInputSetter } from 'homefin/accounts/components';
import { activateProfile } from 'homefin/accounts/session';

/** Accept an invite link: pick a name, email and password, and start watching. */
export default function HomefinJoin() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const code = params.get('code') || '';
    const [state, setState] = useState<'checking' | 'valid' | 'invalid'>('checking');
    const [serverName, setServerName] = useState('Home Fin');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const onNameChange = useInputSetter(setName);
    const onEmailChange = useInputSetter(setEmail);
    const onPasswordChange = useInputSetter(setPassword);

    useEffect(() => {
        if (!code) {
            setState('invalid');
            return;
        }
        accountsApi.invite(code).then(invite => {
            setServerName(invite.serverName);
            if (invite.email) setEmail(invite.email);
            setState(invite.valid ? 'valid' : 'invalid');
        }).catch(() => setState('invalid'));
    }, [code]);

    const submit = useCallback((e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        accountsApi.acceptInvite(code, { name, email, password })
            .then(me => {
                if (me.profiles.length === 1) return activateProfile(me.profiles[0]);
                navigate('/homefin/profiles');
            })
            .catch(err => {
                setError(errorMessage(err));
                setBusy(false);
            });
    }, [code, name, email, password, navigate]);

    return (
        <Screen id='homefinJoinPage' title='Join' variant='auth'>
            {state === 'checking' && <div className='hfAuthCard'><p>Checking your invite…</p></div>}
            {state === 'invalid' && (
                <div className='hfAuthCard'>
                    <h1>This invite has expired</h1>
                    <p className='hfAuthCard-note'>Invite links work once and last 7 days. Ask for a new one, or sign in if you already have an account.</p>
                    <a className='hfButton hfButton-red hfButton-block' href='#/homefin/login'>Sign In</a>
                </div>
            )}
            {state === 'valid' && (
                <form className='hfAuthCard' onSubmit={submit}>
                    <p className='hfAuthCard-kicker'>You&apos;re invited to</p>
                    <h1>{serverName}</h1>
                    <p className='hfAuthCard-note'>Create your account. You can add profiles for the rest of your household afterwards.</p>
                    <ErrorBanner message={error} />
                    <Field id='hfJoinName' label='Your name' autoComplete='name' value={name} onChange={onNameChange} maxLength={30} required />
                    <Field id='hfJoinEmail' label='Email address' type='email' autoComplete='username' value={email} onChange={onEmailChange} required />
                    <Field id='hfJoinPassword' label='Password (8+ characters)' type='password' autoComplete='new-password' minLength={8} value={password} onChange={onPasswordChange} required />
                    <button type='submit' className='hfButton hfButton-red hfButton-block' disabled={busy}>
                        {busy ? 'Setting up…' : 'Start watching'}
                    </button>
                </form>
            )}
        </Screen>
    );
}
