import escapeHtml from 'escape-html';
import React, { type FC } from 'react';

import type { AvatarPreset } from './api';

import './avatar.scss';

const FALLBACK: AvatarPreset = { key: 'none', emoji: '🙂', from: '#5a5a5a', to: '#2a2a2a' };

export function findAvatar(avatars: AvatarPreset[], key: string | undefined) {
    return avatars.find(a => a.key === key) || FALLBACK;
}

function background(avatar: AvatarPreset) {
    return `linear-gradient(145deg, ${avatar.from}, ${avatar.to})`;
}

/** Avatar tile for plain-DOM code (header, menus). */
export function avatarHtml(avatar: AvatarPreset, className = 'hfAvatar') {
    return `<span class="${className}" style="background:${escapeHtml(background(avatar))}" aria-hidden="true"><span class="hfAvatar-emoji">${escapeHtml(avatar.emoji)}</span></span>`;
}

interface AvatarProps {
    avatar: AvatarPreset
    className?: string
    size?: string
}

export const Avatar: FC<AvatarProps> = ({ avatar, className = '', size }) => (
    <span
        className={`hfAvatar ${className}`}
        style={{ background: background(avatar), width: size, height: size }}
        aria-hidden='true'
    >
        <span className='hfAvatar-emoji'>{avatar.emoji}</span>
    </span>
);
