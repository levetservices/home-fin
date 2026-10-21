import React, { type FC, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { type MediaRequest, type MediaResult, type RequestState, type RequestsConfig, requestsApi } from 'homefin/accounts/api';
import { errorMessage } from 'homefin/accounts/components';

import Poster from './Poster';
import { canRequest, openInLibrary, stateLabel } from './states';

interface RequestDialogProps {
    result: MediaResult
    config: RequestsConfig
    onClose: () => void
    onRequested: (request: MediaRequest) => void
}

function note(config: RequestsConfig, type: MediaResult['type']) {
    if (config.policy === 'off') return 'Requests are turned off for your profile.';
    if (type === 'movie' ? !config.movies : !config.tv) return `${type === 'movie' ? 'Films' : 'Shows'} can't be requested here yet.`;
    return config.policy === 'auto' ? 'It starts downloading straight away.' : 'An admin approves requests before they download.';
}

interface ActionProps {
    done: MediaRequest | null
    state: RequestState
    type: MediaResult['type']
    allowed: boolean
    busy: boolean
    onWatch: () => void
    onRequest: () => void
}

/** The main button: Watch when it's here, Request when it can be asked for, a note once asked. */
const Action: FC<ActionProps> = ({ done, state, type, allowed, busy, onWatch, onRequest }) => {
    if (done) {
        return (
            <p className='hfReq-done'>
                <span className='material-icons' aria-hidden='true'>check_circle</span>
                {done.status === 'pending' ? 'Requested. You\'ll see it here once it\'s approved.' : 'Requested. It\'s on its way.'}
            </p>
        );
    }
    if (state === 'available') {
        return (
            <button type='button' className='hfReq-primary hfReq-play' onClick={onWatch}>
                <span className='material-icons' aria-hidden='true'>play_arrow</span>Watch
            </button>
        );
    }
    if (!allowed || !canRequest(state, type)) return null;
    let label = 'Request';
    if (busy) label = 'Requesting…';
    else if (state === 'declined' || state === 'failed') label = 'Request again';
    return (
        <button type='button' className='hfReq-primary' onClick={onRequest} disabled={busy}>
            <span className='material-icons' aria-hidden='true'>add</span>{label}
        </button>
    );
};

/** Jellyseerr's request pop-up: details, seasons for shows, and the Request button. */
const RequestDialog: FC<RequestDialogProps> = ({ result, config, onClose, onRequested }) => {
    const [seasons, setSeasons] = useState<number[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState<MediaRequest | null>(null);
    const panel = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        document.documentElement.classList.add('hfReq-lock');
        panel.current?.focus();
        return () => {
            document.removeEventListener('keydown', onKey);
            document.documentElement.classList.remove('hfReq-lock');
        };
    }, [onClose]);

    const onBackdrop = useCallback((e: MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    }, [onClose]);

    const toggleSeason = useCallback((e: MouseEvent<HTMLButtonElement>) => {
        const season = Number(e.currentTarget.dataset.season);
        setSeasons(current => {
            if (season === 0) return null; // "All seasons"
            const next = new Set(current || []);
            if (next.has(season)) next.delete(season);
            else next.add(season);
            return next.size ? [...next].sort((a, b) => a - b) : null;
        });
    }, []);

    const submit = useCallback(() => {
        setBusy(true);
        setError('');
        requestsApi.create(result.type, result.id, seasons || undefined)
            .then(({ request }) => {
                setDone(request);
                onRequested(request);
            })
            .catch(err => setError(errorMessage(err)))
            .finally(() => setBusy(false));
    }, [result, seasons, onRequested]);

    const watch = useCallback(() => {
        openInLibrary(result).then(found => {
            if (found) onClose();
            else setError('It\'s in Sonarr / Radarr but Jellyfin hasn\'t picked it up yet. Try again in a few minutes.');
        }).catch(err => setError(errorMessage(err)));
    }, [result, onClose]);

    const state = done ? done.state : result.state;
    const allowed = config.policy !== 'off' && (result.type === 'movie' ? config.movies : config.tv);
    const meta = [result.year, result.type === 'tv' ? 'Series' : 'Film', ...result.genres.slice(0, 2),
        result.runtime ? `${Math.floor(result.runtime / 60)}h ${result.runtime % 60}m` : null, result.network].filter(Boolean);
    const action = <Action done={done} state={state} type={result.type} allowed={allowed} busy={busy} onWatch={watch} onRequest={submit} />;

    return createPortal(
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Escape closes it
        <div className='hfReq-overlay' onClick={onBackdrop}>
            <div ref={panel} className='hfReq-dialog' role='dialog' aria-modal='true' aria-label={result.title} tabIndex={-1}>
                <div className='hfReq-hero' style={result.backdrop ? { backgroundImage: `url('${result.backdrop}')` } : undefined}>
                    <button type='button' className='hfReq-close' onClick={onClose} aria-label='Close'>
                        <span className='material-icons' aria-hidden='true'>close</span>
                    </button>
                </div>
                <div className='hfReq-body'>
                    <Poster className='hfReq-poster' src={result.poster} />
                    <div className='hfReq-info'>
                        <h2>{result.title}</h2>
                        <p className='hfReq-meta'>
                            {meta.map(part => <span key={String(part)}>{part}</span>)}
                            {result.rating && <span className='hfReq-rating'>{result.rating}</span>}
                        </p>
                        {state && <span className={`hfReqPill hfReqPill-${state}`}>{stateLabel(state, done ? done.progress : result.progress)}</span>}
                        {result.overview && <p className='hfReq-overview'>{result.overview}</p>}

                        {result.type === 'tv' && result.seasons && result.seasons.length > 1 && canRequest(state, 'tv') && allowed && !done && (
                            <div className='hfReq-seasons' role='group' aria-label='Seasons'>
                                <button type='button' data-season='0' aria-pressed={!seasons} onClick={toggleSeason}>All seasons</button>
                                {result.seasons.map(n => (
                                    <button key={n} type='button' data-season={n} aria-pressed={!!seasons?.includes(n)} onClick={toggleSeason}>
                                        Season {n}
                                    </button>
                                ))}
                            </div>
                        )}

                        {error && <p className='hfReq-error' role='alert'>{error}</p>}
                        <div className='hfReq-actions'>
                            {action}
                            {!done && (!allowed || canRequest(state, result.type)) && <p className='hfReq-note'>{note(config, result.type)}</p>}
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default RequestDialog;
