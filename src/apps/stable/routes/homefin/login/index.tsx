import React, { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AccountsError, accountsApi, isAccountsEnabled } from 'homefin/accounts/api';
import { Field, Screen, errorMessage, fireAndForget, useInputSetter } from 'homefin/accounts/components';
import { classicLoginHref } from 'homefin/accounts/session';

/** Looks like an email: one @, something before it, a dotted domain after it, no spaces. */
function isEmail(value: string) {
    const parts = value.split('@');
    if (parts.length !== 2 || /\s/.test(value)) return false;
    const [local, domain] = parts;
    const dot = domain.lastIndexOf('.');
    return !!local && dot > 0 && dot < domain.length - 1;
}

/**
 * Home Fin sign-in, as on netflix.com: email first ("Enter your info to sign in"),
 * then the password, then Who's watching?. Whether an email has an account is never
 * revealed: every valid-looking email moves on to the password step.
 */
export default function HomefinLogin() {
    const navigate = useNavigate();
    const [step, setStep] = useState<'email' | 'password'>('email');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [emailError, setEmailError] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [busy, setBusy] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const passwordInput = useRef<HTMLInputElement>(null);
    const emailInput = useRef<HTMLInputElement>(null);
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

    useEffect(() => {
        (step === 'password' ? passwordInput : emailInput).current?.focus();
    }, [step]);

    const onEmailChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setEmail(e.target.value);
        setEmailError('');
    }, []);

    const checkEmail = useCallback(() => {
        const ok = isEmail(email.trim());
        setEmailError(ok ? '' : 'Please enter a valid email address.');
        return ok;
    }, [email]);

    const onEmailBlur = useCallback(() => {
        if (email) checkEmail();
    }, [email, checkEmail]);

    const submitEmail = useCallback((e: FormEvent) => {
        e.preventDefault();
        if (checkEmail()) {
            setEmail(email.trim());
            setStep('password');
        }
    }, [email, checkEmail]);

    const submitPassword = useCallback((e: FormEvent) => {
        e.preventDefault();
        if (!password) {
            setPasswordError('Please enter your password.');
            return;
        }
        setBusy(true);
        setPasswordError('');
        accountsApi.login(email, password)
            .then(() => navigate('/homefin/profiles'))
            .catch(err => {
                setPasswordError(err instanceof AccountsError && err.status === 401 ?
                    'Incorrect password for this email. Try again, or use Get help below.' :
                    errorMessage(err));
                setBusy(false);
            });
    }, [email, password, navigate]);

    const changeEmail = useCallback(() => {
        setPassword('');
        setPasswordError('');
        setStep('email');
    }, []);

    const toggleHelp = useCallback(() => setHelpOpen(open => !open), []);

    return (
        <Screen id='homefinLoginPage' title='Sign In' variant='auth'>
            <div className='hfSignIn'>
                {step === 'email' ? (
                    <form onSubmit={submitEmail} noValidate>
                        <h1>Enter your info to sign in</h1>
                        <p className='hfSignIn-lede'>Or get started with an invite link.</p>
                        <Field
                            ref={emailInput}
                            id='hfEmail'
                            label='Email address'
                            type='email'
                            autoComplete='username'
                            value={email}
                            onChange={onEmailChange}
                            onBlur={onEmailBlur}
                            error={emailError}
                        />
                        <button type='submit' className='hfButton hfButton-red hfSignIn-submit'>Continue</button>
                        <p className='hfSignIn-move'>
                            Used to sign in with a Jellyfin username? <a href='#/homefin/move'>Move it to Home Fin</a>
                        </p>
                    </form>
                ) : (
                    <form onSubmit={submitPassword} noValidate>
                        <h1>Enter your password</h1>
                        <p className='hfSignIn-lede'>
                            Signing in as <strong>{email}</strong>{' '}
                            <button type='button' className='hfSignIn-link' onClick={changeEmail}>Change</button>
                        </p>
                        {/* Lets password managers pair the password with the email. */}
                        <input type='email' name='username' autoComplete='username' value={email} readOnly hidden />
                        <Field
                            ref={passwordInput}
                            id='hfPassword'
                            label='Password'
                            type='password'
                            autoComplete='current-password'
                            value={password}
                            onChange={onPasswordChange}
                            error={passwordError}
                        />
                        <button type='submit' className='hfButton hfButton-red hfSignIn-submit' disabled={busy}>
                            {busy ? 'Signing in…' : 'Sign In'}
                        </button>
                    </form>
                )}

                <div className='hfSignIn-help'>
                    <button type='button' className='hfSignIn-helpToggle' onClick={toggleHelp} aria-expanded={helpOpen} aria-controls='hfSignInHelp'>
                        Get help
                        <span className='material-icons' aria-hidden='true'>{helpOpen ? 'expand_less' : 'expand_more'}</span>
                    </button>
                    {helpOpen && (
                        <ul id='hfSignInHelp' className='hfSignIn-helpList'>
                            <li><strong>Forgot your password?</strong> Ask whoever runs this server to reset it for you.</li>
                            <li><strong>New here?</strong> You need an invite link to create an account.</li>
                            <li><strong>Had a Jellyfin login here?</strong> <a href='#/homefin/move'>Move it to Home Fin</a> and keep your history.</li>
                            <li><a href={classicLoginHref()}>Sign in with a Jellyfin user instead</a></li>
                        </ul>
                    )}
                </div>
            </div>
        </Screen>
    );
}
