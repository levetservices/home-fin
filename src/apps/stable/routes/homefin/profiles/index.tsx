import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { Profile } from 'homefin/accounts/api';
import { Avatar, findAvatar } from 'homefin/accounts/avatar';
import { ErrorBanner, PinPad, ProfileEditor, Screen, errorMessage, useAvatars, useMe } from 'homefin/accounts/components';
import { activateProfile } from 'homefin/accounts/session';

const MAX_PROFILES = 5;

/** "Who's watching?" — pick a profile to start a Jellyfin session as it. */
export default function HomefinProfiles() {
    const navigate = useNavigate();
    const { me, setMe, error } = useMe();
    const avatars = useAvatars();
    const [locked, setLocked] = useState<Profile | null>(null);
    const [pinError, setPinError] = useState('');
    const [opening, setOpening] = useState<number | null>(null);
    const [openError, setOpenError] = useState('');

    const open = async (profile: Profile, pin?: string) => {
        if (profile.locked && !pin) {
            setPinError('');
            setLocked(profile);
            return;
        }
        setOpening(profile.id);
        setOpenError('');
        try {
            await activateProfile(profile, pin);
        } catch (err) {
            setOpening(null);
            if (profile.locked) setPinError(errorMessage(err));
            else setOpenError(errorMessage(err));
        }
    };

    // A brand-new account (e.g. the first admin) has no profiles yet: create one first.
    if (me && me.profiles.length === 0) {
        return (
            <Screen id='homefinProfilesPage' title='Add profile' variant='profiles'>
                <ProfileEditor
                    profile={null}
                    avatars={avatars}
                    canDelete={false}
                    onSaved={profiles => setMe({ ...me, profiles })}
                    onCancel={() => undefined}
                />
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
                        <li key={profile.id}>
                            <button type='button' className={`hfWho-profile${opening === profile.id ? ' is-opening' : ''}`} onClick={() => open(profile)}>
                                <Avatar avatar={findAvatar(avatars, profile.avatar)} className='hfWho-avatar' />
                                <span className='hfWho-name'>{profile.name}</span>
                                {profile.locked && <span className='hfWho-lock material-icons' aria-label='Locked'>lock</span>}
                                {profile.maturity === 'kids' && <span className='hfWho-kids'>kids</span>}
                            </button>
                        </li>
                    ))}
                    {me && me.profiles.length < MAX_PROFILES && (
                        <li>
                            <button type='button' className='hfWho-profile hfWho-add' onClick={() => navigate('/homefin/profiles/manage?add=1')}>
                                <span className='hfWho-avatar hfWho-addTile'><span className='material-icons' aria-hidden='true'>add_circle</span></span>
                                <span className='hfWho-name'>Add Profile</span>
                            </button>
                        </li>
                    )}
                </ul>
                <button type='button' className='hfButton hfButton-ghost' onClick={() => navigate('/homefin/profiles/manage')}>
                    <span className='material-icons' aria-hidden='true'>edit</span> Manage Profiles
                </button>
            </section>

            {locked && (
                <PinPad
                    title={`Enter your PIN to access ${locked.name}'s profile.`}
                    error={pinError}
                    onSubmit={pin => open(locked, pin)}
                    onCancel={() => setLocked(null)}
                />
            )}
        </Screen>
    );
}
