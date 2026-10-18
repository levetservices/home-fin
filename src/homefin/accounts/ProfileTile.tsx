import React, { type FC, useCallback } from 'react';

import type { AvatarPreset, Profile } from './api';
import { Avatar, findAvatar } from './avatar';

interface ProfileTileProps {
    profile: Profile
    avatars: AvatarPreset[]
    onSelect: (profile: Profile) => void
    /** Manage Profiles shows a pencil over the avatar. */
    editing?: boolean
    busy?: boolean
}

/** One avatar + name on Who's watching? / Manage Profiles. */
export const ProfileTile: FC<ProfileTileProps> = ({ profile, avatars, onSelect, editing, busy }) => {
    const select = useCallback(() => onSelect(profile), [onSelect, profile]);
    return (
        <li>
            <button
                type='button'
                className={`hfWho-profile${editing ? ' hfWho-editing' : ''}${busy ? ' is-opening' : ''}`}
                onClick={select}
                aria-label={editing ? `Edit ${profile.name}` : profile.name}
            >
                <span className='hfWho-avatarWrap'>
                    <Avatar avatar={findAvatar(avatars, profile.avatar)} className='hfWho-avatar' />
                    {editing && <span className='hfWho-pencil material-icons' aria-hidden='true'>edit</span>}
                </span>
                <span className='hfWho-name'>{profile.name}</span>
                {profile.locked && <span className='hfWho-lock material-icons' aria-hidden='true' title='Profile Lock is on'>lock</span>}
            </button>
        </li>
    );
};

/** The "Add Profile" tile. */
export const AddProfileTile: FC<{ onAdd: () => void }> = ({ onAdd }) => (
    <li>
        <button type='button' className='hfWho-profile hfWho-add' onClick={onAdd}>
            <span className='hfWho-avatarWrap'>
                <span className='hfWho-avatar hfWho-addTile'><span className='material-icons' aria-hidden='true'>add_circle</span></span>
            </span>
            <span className='hfWho-name'>Add Profile</span>
        </button>
    </li>
);
