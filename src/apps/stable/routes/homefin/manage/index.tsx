import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { accountsApi, type Profile } from 'homefin/accounts/api';
import { Avatar, findAvatar } from 'homefin/accounts/avatar';
import { ErrorBanner, PinPad, ProfileEditor, Screen, useAvatars, useMe } from 'homefin/accounts/components';

const MAX_PROFILES = 5;

/** Manage Profiles: add, edit (name, icon, maturity, PIN) and delete. */
export default function HomefinManageProfiles() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { me, setMe, error } = useMe();
    const avatars = useAvatars();
    const [editing, setEditing] = useState<Profile | 'new' | null>(params.get('add') ? 'new' : null);
    const [unlocking, setUnlocking] = useState<Profile | null>(null);
    const [currentPin, setCurrentPin] = useState<string | undefined>();
    const [pinError, setPinError] = useState('');

    useEffect(() => {
        if (me && editing === 'new' && me.profiles.length >= MAX_PROFILES) setEditing(null);
    }, [me, editing]);

    const startEdit = (profile: Profile) => {
        if (profile.locked) {
            setPinError('');
            setUnlocking(profile);
        } else {
            setCurrentPin(undefined);
            setEditing(profile);
        }
    };

    // Check the PIN with a harmless no-op update before opening the editor.
    const unlock = async (pin: string) => {
        if (!unlocking) return;
        try {
            await accountsApi.updateProfile(unlocking.id, { currentPin: pin });
            setCurrentPin(pin);
            setEditing(unlocking);
            setUnlocking(null);
        } catch {
            setPinError('Incorrect PIN. Please try again.');
        }
    };

    if (me && editing) {
        return (
            <Screen id='homefinManageProfilesPage' title='Edit profile' variant='plain'>
                <ProfileEditor
                    key={editing === 'new' ? 'new' : editing.id}
                    profile={editing === 'new' ? null : editing}
                    avatars={avatars}
                    canDelete={me.profiles.length > 1}
                    currentPin={currentPin}
                    onSaved={profiles => {
                        setMe({ ...me, profiles });
                        setEditing(null);
                        if (params.get('add')) navigate('/homefin/profiles');
                    }}
                    onCancel={() => {
                        setEditing(null);
                        if (params.get('add')) navigate('/homefin/profiles');
                    }}
                />
            </Screen>
        );
    }

    return (
        <Screen id='homefinManageProfilesPage' title='Manage Profiles' variant='profiles'>
            <section className='hfWho'>
                <h1 className='hfWho-title'>Manage Profiles</h1>
                <ErrorBanner message={error} />
                <ul className='hfWho-grid'>
                    {me?.profiles.map(profile => (
                        <li key={profile.id}>
                            <button type='button' className='hfWho-profile hfWho-editing' onClick={() => startEdit(profile)} aria-label={`Edit ${profile.name}`}>
                                <span className='hfWho-avatarWrap'>
                                    <Avatar avatar={findAvatar(avatars, profile.avatar)} className='hfWho-avatar' />
                                    <span className='hfWho-pencil material-icons' aria-hidden='true'>edit</span>
                                </span>
                                <span className='hfWho-name'>{profile.name}</span>
                                {profile.locked && <span className='hfWho-lock material-icons' aria-label='Locked'>lock</span>}
                            </button>
                        </li>
                    ))}
                    {me && me.profiles.length < MAX_PROFILES && (
                        <li>
                            <button type='button' className='hfWho-profile hfWho-add' onClick={() => setEditing('new')}>
                                <span className='hfWho-avatar hfWho-addTile'><span className='material-icons' aria-hidden='true'>add_circle</span></span>
                                <span className='hfWho-name'>Add Profile</span>
                            </button>
                        </li>
                    )}
                </ul>
                <button type='button' className='hfButton hfButton-primary' onClick={() => navigate('/homefin/profiles')}>Done</button>
            </section>

            {unlocking && (
                <PinPad
                    title={`Enter ${unlocking.name}'s PIN to edit this profile.`}
                    error={pinError}
                    onSubmit={unlock}
                    onCancel={() => setUnlocking(null)}
                />
            )}
        </Screen>
    );
}
