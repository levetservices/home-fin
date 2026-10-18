import React, { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { accountsApi, isAccountsEnabled } from 'homefin/accounts/api';
import { ErrorBanner, Field, Screen, errorMessage, fireAndForget, useInputSetter } from 'homefin/accounts/components';
import { classicLoginHref } from 'homefin/accounts/session';

/** Home Fin sign-in: email + password for the account, then Who's watching? */
export default function HomefinLogin() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const onEmailChange = useInputSetter(setEmail);
    const onPasswordChange = useInputSetter(setPassword);

    useEffect(() => {
        fireAndForget((async () => {
            if (!(await isAccountsEnabled())) {
                navigate(classicLoginHref().slice(1));
                return;
            }
            // Already signed in to the account? Go straight to profiles.
            const me = await accountsApi.me().catch(() => null);
            if (me) navigate('/homefin/profiles');
        })());
    }, [navigate]);

    const submit = useCallback((e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        accountsApi.login(email, password)
            .then(() => navigate('/homefin/profiles'))
            .catch(err => {
                setError(errorMessage(err));
                setBusy(false);
            });
    }, [email, password, navigate]);

    return (
        <Screen id='homefinLoginPage' title='Sign In' variant='auth'>
            <form className='hfAuthCard' onSubmit={submit}>
                <h1>Sign In</h1>
                <ErrorBanner message={error} />
                <Field id='hfEmail' label='Email address' type='email' autoComplete='username' value={email} onChange={onEmailChange} required />
                <Field id='hfPassword' label='Password' type='password' autoComplete='current-password' value={password} onChange={onPasswordChange} required />
                <button type='submit' className='hfButton hfButton-red hfButton-block' disabled={busy}>
                    {busy ? 'Signing in…' : 'Sign In'}
                </button>
                <p className='hfAuthCard-note'>
                    New to Home Fin? Ask whoever runs this server for an invite link.
                </p>
                <a className='hfAuthCard-classic' href={classicLoginHref()}>Sign in with a Jellyfin user instead</a>
            </form>
        </Screen>
    );
}
