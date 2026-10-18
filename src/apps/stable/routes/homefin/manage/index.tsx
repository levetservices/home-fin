import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { accountsApi, type Profile, type ProfileCredential } from 'homefin/accounts/api';
import { AddProfileTile, ProfileTile } from 'homefin/accounts/ProfileTile';
import { ErrorBanner, MAX_PROFILES, PasswordPrompt, PinPad, ProfileEditor, Screen, errorMessage, useAvatars, useMe } from 'homefin/accounts/components';

/** Manage Profiles: add, edit (name, icon, maturity, PIN) and delete. */
export default function HomefinManageProfiles() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const fromAdd = !!params.get('add');
    const { me, setMe, error } = useMe();
    const avatars = useAvatars();
    const [editing, setEditing] = useState<Profile | 'new' | null>(fromAdd ? 'new' : null);
    const [unlocking, setUnlocking] = useState<Profile | null>(null);
    const [forgotFor, setForgotFor] = useState<Profile | null>(null);
    const [credential, setCredential] = useState<ProfileCredential | undefined>();
    const [unlockError, setUnlockError] = useState('');

    useEffect(() => {
        if (me && editing === 'new' && me.profiles.length >= MAX_PROFILES) setEditing(null);
    }, [me, editing]);

    // "Forgot PIN?" on Who's watching? lands here with ?forgot=<profile id>.
    const forgotId = Number(params.get('forgot'));
    const forgotHandled = useRef(false);
    useEffect(() => {
        const profile = forgotId && me?.profiles.find(p => p.id === forgotId);
        if (profile && !forgotHandled.current) {
            forgotHandled.current = true;
            setForgotFor(profile);
        }
    }, [forgotId, me]);

    const startEdit = useCallback((profile: Profile) => {
        setUnlockError('');
        if (profile.locked) {
            setUnlocking(profile);
        } else {
            setCredential(undefined);
            setEditing(profile);
        }
    }, []);

    // Check the PIN (or password) with a harmless no-op update before opening the editor.
    const unlockWith = useCallback((profile: Profile, given: ProfileCredential, failure: string) => {
        setUnlockError('');
        accountsApi.updateProfile(profile.id, given)
            .then(() => {
                setCredential(given);
                setEditing(profile);
                setUnlocking(null);
                setForgotFor(null);
            })
            .catch(err => setUnlockError(err?.status === 403 ? failure : errorMessage(err)));
    }, []);

    const submitPin = useCallback((pin: string) => {
        if (unlocking) unlockWith(unlocking, { currentPin: pin }, 'Incorrect PIN. Please try again.');
    }, [unlocking, unlockWith]);
    const submitPassword = useCallback((password: string) => {
        if (forgotFor) unlockWith(forgotFor, { accountPassword: password }, 'That password is incorrect.');
    }, [forgotFor, unlockWith]);
    const forgotPin = useCallback(() => {
        setUnlockError('');
        setForgotFor(unlocking);
        setUnlocking(null);
    }, [unlocking]);
    const cancelUnlock = useCallback(() => {
        setUnlocking(null);
        setForgotFor(null);
    }, []);

    const closeEditor = useCallback(() => {
        setEditing(null);
        setCredential(undefined);
        if (fromAdd) navigate('/homefin/profiles');
    }, [fromAdd, navigate]);
    const onSaved = useCallback((profiles: Profile[]) => {
        if (me) setMe({ ...me, profiles });
        closeEditor();
    }, [me, setMe, closeEditor]);
    const addProfile = useCallback(() => setEditing('new'), []);
    const done = useCallback(() => navigate('/homefin/profiles'), [navigate]);

    if (me && editing) {
        return (
            <Screen id='homefinManageProfilesPage' title={editing === 'new' ? 'Add profile' : 'Edit profile'} variant='plain'>
                <ProfileEditor
                    key={editing === 'new' ? 'new' : editing.id}
                    profile={editing === 'new' ? null : editing}
                    avatars={avatars}
                    canDelete={me.profiles.length > 1}
                    credential={credential}
                    onSaved={onSaved}
                    onCancel={closeEditor}
                />
            </Screen>
        );
    }

    return (
        <Screen id='homefinManageProfilesPage' title='Manage Profiles' variant='profiles'>
            <section className='hfWho'>
                <h1 className='hfWho-title'>Manage Profiles:</h1>
                <ErrorBanner message={error} />
                <ul className='hfWho-grid'>
                    {me?.profiles.map(profile => (
                        <ProfileTile key={profile.id} profile={profile} avatars={avatars} onSelect={startEdit} editing />
                    ))}
                    {me && me.profiles.length < MAX_PROFILES && <AddProfileTile onAdd={addProfile} />}
                </ul>
                <button type='button' className='hfButton hfButton-done' onClick={done}>Done</button>
            </section>

            {unlocking && (
                <PinPad
                    title={`Enter ${unlocking.name}'s PIN to edit this profile.`}
                    error={unlockError}
                    onSubmit={submitPin}
                    onCancel={cancelUnlock}
                    onForgot={forgotPin}
                />
            )}
            {forgotFor && (
                <PasswordPrompt
                    title={`Forgot ${forgotFor.name}'s PIN?`}
                    error={unlockError}
                    onSubmit={submitPassword}
                    onCancel={cancelUnlock}
                />
            )}
        </Screen>
    );
}
