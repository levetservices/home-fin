import React, { type FC, useCallback } from 'react';

import type { MediaResult, RequestState } from 'homefin/accounts/api';

import Poster from './Poster';
import { stateLabel } from './states';

interface RequestCardProps {
    title: string
    year: number | null
    poster: string | null
    state: RequestState
    progress?: number | null
    /** Shown under the title, e.g. who asked for it. */
    caption?: string
    value: MediaResult | number
    onOpen: (value: MediaResult | number) => void
}

/** A poster with a status pill, as in Jellyseerr. */
const RequestCard: FC<RequestCardProps> = ({ title, year, poster, state, progress, caption, value, onOpen }) => {
    const open = useCallback(() => onOpen(value), [onOpen, value]);
    const label = stateLabel(state, progress);
    return (
        <button type='button' className='hfReqCard' onClick={open} title={title}>
            <span className='hfReqCard-poster'>
                <Poster src={poster} fallback={<span className='hfReqCard-noPoster'>{title}</span>} />
                {label && <span className={`hfReqPill hfReqPill-${state}`}>{label}</span>}
                {state === 'downloading' && typeof progress === 'number' && (
                    <span className='hfReqCard-progress' style={{ width: `${progress}%` }} />
                )}
            </span>
            <span className='hfReqCard-title'>{title}</span>
            <span className='hfReqCard-meta'>{caption || year || ''}</span>
        </button>
    );
};

export default RequestCard;
