import React, { type FormEvent, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { accountsApi } from 'homefin/accounts/api';
import { ErrorBanner, Field, MAX_PROFILES, Screen, errorMessage, fireAndForget, useInputSetter, useMe } from 'homefin/accounts/components';
import { getCurrentProfile, signOutEverywhere } from 'homefin/accounts/session';

function memberSince(createdAt: string) {
    const date = new Date(createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z');
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Account settings: name, email, password; links to profiles and admin. */
export default function HomefinAccount() {
    const navigate = useNavigate();
    const { me, setMe, error } = useMe();
    const [name, setName] = useState<string | null>(null);
    const [email, setEmail] = useState<string | null>(null);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [message, setMessage] = useState('');
    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);
    const onNameChange = useInputSetter(setName);
    const onEmailChange = useInputSetter(setEmail);
    const onCurrentPasswordChange = useInputSetter(setCurrentPassword);
    const onNewPasswordChange = useInputSetter(setNewPassword);

    const save = useCallback((e: FormEvent) => {
        e.preventDefault();
        if (!me) return;
        setBusy(true);
        setFormError('');
        setMessage('');
        const fields: Parameters<typeof accountsApi.updateMe>[0] = {};
        if (name !== null && name !== me.account.name) fields.name = name;
        if (email !== null && email !== me.account.email) fields.email = email;
        if (newPassword) fields.newPassword = newPassword;
        if (fields.email || fields.newPassword) fields.currentPassword = currentPassword;
        accountsApi.updateMe(fields)
            .then(updated => {
                setMe(updated);
                setCurrentPassword('');
                setNewPassword('');
                setMessage('Saved.');
            })
            .catch(err => setFormError(errorMessage(err)))
            .finally(() => setBusy(false));
    }, [me, name, email, newPassword, currentPassword, setMe]);

    const manageProfiles = useCallback(() => navigate('/homefin/profiles/manage'), [navigate]);
    const openAdmin = useCallback(() => navigate('/homefin/admin'), [navigate]);
    const signOut = useCallback(() => fireAndForget(signOutEverywhere()), []);

    const hasProfile = !!getCurrentProfile();
    const needsPassword = !!me && ((email !== null && email !== me.account.email) || !!newPassword);

    return (
        <Screen
            id='homefinAccountPage'
            title='Account'
            variant='plain'
            headerRight={<a className='hfScreen-back' href={hasProfile ? '#/home' : '#/homefin/profiles'}>Back to {hasProfile ? 'Home Fin' : 'profiles'}</a>}
        >
            <section className='hfAccount'>
                <h1>Account</h1>
                <ErrorBanner message={error} />
                {me && (
                    <>
                        <p className='hfAccount-since'>Member since {memberSince(me.account.createdAt)}</p>

                        <div className='hfAccount-grid'>
                            <form className='hfPanel' onSubmit={save}>
                                <h2>Account details</h2>
                                <Field id='hfAccName' label='Name' value={name ?? me.account.name} onChange={onNameChange} maxLength={30} />
                                <Field id='hfAccEmail' label='Email' type='email' value={email ?? me.account.email} onChange={onEmailChange} />
                                <Field id='hfAccNewPw' label='New password (leave blank to keep)' type='password' autoComplete='new-password' minLength={8} value={newPassword} onChange={onNewPasswordChange} />
                                {needsPassword && (
                                    <Field id='hfAccCurPw' label='Current password' type='password' autoComplete='current-password' value={currentPassword} onChange={onCurrentPasswordChange} required />
                                )}
                                <ErrorBanner message={formError} />
                                {message && <p className='hfOk'>{message}</p>}
                                <button type='submit' className='hfButton hfButton-primary' disabled={busy}>Save changes</button>
                            </form>

                            <div className='hfPanel'>
                                <h2>Profiles</h2>
                                <p className='hfPanel-note'>{me.profiles.length} of {MAX_PROFILES} profiles. Each has its own history, My List and recommendations.</p>
                                <button type='button' className='hfButton hfButton-outline' onClick={manageProfiles}>Manage Profiles</button>
                                <h2>TVs and phone apps</h2>
                                <p className='hfPanel-note'>In the Jellyfin app choose <strong>Quick Connect</strong>, then approve the code here while signed in to the profile you want on that device.</p>
                                <a className='hfButton hfButton-outline' href='#/quickconnect'>Enter a Quick Connect code</a>
                                {me.account.isAdmin && (
                                    <>
                                        <h2>Server admin</h2>
                                        <p className='hfPanel-note'>Invite people, add accounts and bring over existing Jellyfin users.</p>
                                        <button type='button' className='hfButton hfButton-red' onClick={openAdmin}>Open admin</button>
                                    </>
                                )}
                            </div>
                        </div>

                        <button type='button' className='hfButton hfButton-ghost hfAccount-signout' onClick={signOut}>Sign out of Home Fin</button>
                    </>
                )}
            </section>
        </Screen>
    );
}
