import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { Profile } from 'homefin/accounts/api';
import { AddProfileTile, ProfileTile } from 'homefin/accounts/ProfileTile';
import { ErrorBanner, MAX_PROFILES, PinPad, ProfileEditor, Screen, errorMessage, useAvatars, useMe } from 'homefin/accounts/components';
import { activateProfile } from 'homefin/accounts/session';

/** "Who's watching?" — pick a profile to start a Jellyfin session as it. */
export default function HomefinProfiles() {
    const navigate = useNavigate();
    const { me, setMe, error } = useMe();
    const avatars = useAvatars();
    const [locked, setLocked] = useState<Profile | null>(null);
    const [pinError, setPinError] = useState('');
    const [opening, setOpening] = useState<number | null>(null);
    const [openError, setOpenError] = useState('');

    const open = useCallback((profile: Profile, pin?: string) => {
        if (profile.locked && !pin) {
            setPinError('');
            setLocked(profile);
            return;
        }
        // Clear first so the same message again still resets the PIN boxes.
        setPinError('');
        setOpening(profile.id);
        setOpenError('');
        activateProfile(profile, pin).catch(err => {
            setOpening(null);
            if (profile.locked) setPinError(errorMessage(err));
            else setOpenError(errorMessage(err));
        });
    }, []);

    const submitPin = useCallback((pin: string) => {
        if (locked) open(locked, pin);
    }, [locked, open]);
    const cancelPin = useCallback(() => setLocked(null), []);
    const forgotPin = useCallback(() => {
        if (locked) navigate(`/homefin/profiles/manage?forgot=${locked.id}`);
    }, [locked, navigate]);
    const addProfile = useCallback(() => navigate('/homefin/profiles/manage?add=1'), [navigate]);
    const manage = useCallback(() => navigate('/homefin/profiles/manage'), [navigate]);
    const onFirstProfile = useCallback((profiles: Profile[]) => {
        if (me) setMe({ ...me, profiles });
    }, [me, setMe]);

    // A brand-new account (e.g. the first admin) has no profiles yet: create one first.
    if (me && me.profiles.length === 0) {
        return (
            <Screen id='homefinProfilesPage' title='Add profile' variant='plain'>
                <ProfileEditor profile={null} avatars={avatars} canDelete={false} onSaved={onFirstProfile} />
            </Screen>
        );
    }

    return (
        <Screen id='homefinProfilesPage' title="Who's watching?" variant='profiles'>
            <section className='hfWho'>
                <h1 className='hfWho-title'>Who&apos;s watching?</h1>
                <ErrorBanner message={error || openError} />
                <ul className='hfWho-grid'>
                    {me?.profiles.map(profile => (
                        <ProfileTile key={profile.id} profile={profile} avatars={avatars} onSelect={open} busy={opening === profile.id} />
                    ))}
                    {me && me.profiles.length < MAX_PROFILES && <AddProfileTile onAdd={addProfile} />}
                </ul>
                {me && (
                    <button type='button' className='hfButton hfButton-manage' onClick={manage}>
                        <span className='material-icons' aria-hidden='true'>edit</span>
                        Manage Profiles
                    </button>
                )}
            </section>

            {locked && (
                <PinPad
                    title={`Enter your PIN to access ${locked.name}'s profile.`}
                    error={pinError}
                    onSubmit={submitPin}
                    onCancel={cancelPin}
                    onForgot={forgotPin}
                />
            )}
        </Screen>
    );
}
