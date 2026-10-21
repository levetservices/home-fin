import React, { type ChangeEvent, type FC, type MouseEvent, useCallback, useEffect, useState } from 'react';
import { useDebounceValue } from 'usehooks-ts';

import Page from 'components/Page';
import {
    type MediaRequest, type MediaResult, type RequestsConfig, getRequestsConfig, requestsApi
} from 'homefin/accounts/api';
import { errorMessage, fireAndForget } from 'homefin/accounts/components';
import RequestCard from 'homefin/requests/RequestCard';
import Poster from 'homefin/requests/Poster';
import RequestDialog from 'homefin/requests/RequestDialog';
import { stateLabel } from 'homefin/requests/states';
import useSearchParam from 'hooks/useSearchParam';

import 'homefin/requests/requests.scss';

type Queue = Awaited<ReturnType<typeof requestsApi.admin.queue>>;

function seasonsText(request: MediaRequest) {
    if (request.type === 'movie') return 'Film';
    if (!request.seasons) return 'All seasons';
    const label = request.seasons.length > 1 ? 'Seasons' : 'Season';
    return `${label} ${request.seasons.join(', ')}`;
}

function searchPlaceholder(config: RequestsConfig) {
    if (config.movies && config.tv) return 'Films and shows';
    return config.movies ? 'Films' : 'Shows';
}

function ago(value: string) {
    const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
    const minutes = Math.round((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** A request shown as a search result, so it opens in the same pop-up. */
function asResult(request: MediaRequest): MediaResult {
    return {
        type: request.type, id: request.mediaId, title: request.title, year: request.year, overview: '', poster: request.poster,
        backdrop: null, genres: [], runtime: null, network: null, rating: null, seasons: null, state: request.state, progress: request.progress
    };
}

interface QueueRowProps {
    request: MediaRequest
    busy: boolean
    onApprove: (e: MouseEvent<HTMLButtonElement>) => void
    onDecline: (e: MouseEvent<HTMLButtonElement>) => void
}

const QueueRow: FC<QueueRowProps> = ({ request, busy, onApprove, onDecline }) => (
    <li className='hfReqRow'>
        <Poster src={request.poster} fallback={<span className='hfReqRow-noPoster' />} />
        <div className='hfReqRow-text'>
            <strong>{request.title}{request.year ? ` (${request.year})` : ''}</strong>
            <span>{seasonsText(request)} · asked by {request.requestedBy} · {ago(request.createdAt)}</span>
            {request.status === 'failed' && request.reason && <span className='hfReqRow-error'>{request.reason}</span>}
        </div>
        <div className='hfReqRow-actions'>
            <button type='button' className='hfReq-approve' data-id={request.id} onClick={onApprove} disabled={busy}>
                {request.status === 'failed' ? 'Try again' : 'Approve'}
            </button>
            {request.status === 'pending' && (
                <button type='button' className='hfReq-decline' data-id={request.id} onClick={onDecline} disabled={busy}>Decline</button>
            )}
        </div>
    </li>
);

/** Home Fin requests: search Sonarr / Radarr, ask for a title, and (admins) approve. */
export default function HomefinRequests() {
    const [config, setConfig] = useState<RequestsConfig | null | undefined>(undefined);
    const [query, setQuery] = useSearchParam('query');
    const [debounced] = useDebounceValue(query, 400);
    const [results, setResults] = useState<MediaResult[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [lists, setLists] = useState<{ mine: MediaRequest[], household: MediaRequest[] } | null>(null);
    const [queue, setQueue] = useState<Queue | null>(null);
    const [selected, setSelected] = useState<MediaResult | null>(null);
    const [busyId, setBusyId] = useState<number | null>(null);
    const [error, setError] = useState('');

    const load = useCallback(async (current: RequestsConfig | null) => {
        if (!current?.enabled) return;
        const [mine, adminQueue] = await Promise.all([
            requestsApi.list(),
            current.isAdmin ? requestsApi.admin.queue() : Promise.resolve(null)
        ]);
        setLists(mine);
        setQueue(adminQueue);
    }, []);

    useEffect(() => {
        fireAndForget(getRequestsConfig(true).then(async current => {
            setConfig(current);
            await load(current);
        }).catch(err => setError(errorMessage(err))));
    }, [load]);

    useEffect(() => {
        const term = debounced.trim();
        if (!config?.enabled || term.length < 2) {
            setResults(null);
            return;
        }
        let stale = false;
        setSearching(true);
        requestsApi.search(term)
            .then(found => {
                if (!stale) setResults(found.results);
            })
            .catch(err => {
                if (!stale) setError(errorMessage(err));
            })
            .finally(() => {
                if (!stale) setSearching(false);
            });
        return () => {
            stale = true;
        };
    }, [debounced, config]);

    const onQuery = useCallback((e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value), [setQuery]);
    const clearQuery = useCallback(() => setQuery(''), [setQuery]);

    const openResult = useCallback((value: MediaResult | number) => {
        if (typeof value !== 'number') {
            setSelected(value);
            return;
        }
        const request = [...(lists?.mine || []), ...(lists?.household || [])].find(r => r.id === value);
        if (request) setSelected(asResult(request));
    }, [lists]);
    const closeDialog = useCallback(() => setSelected(null), []);

    const onRequested = useCallback((request: MediaRequest) => {
        setResults(current => current?.map(r => (r.type === request.type && r.id === request.mediaId ? { ...r, state: request.state } : r)) ?? null);
        fireAndForget(load(config ?? null));
    }, [config, load]);

    const decide = useCallback((id: number, action: () => Promise<unknown>) => {
        setBusyId(id);
        setError('');
        action()
            .then(() => load(config ?? null))
            .catch(err => setError(errorMessage(err)))
            .finally(() => setBusyId(null));
    }, [config, load]);

    const onApprove = useCallback((e: MouseEvent<HTMLButtonElement>) => {
        const id = Number(e.currentTarget.dataset.id);
        decide(id, () => requestsApi.admin.approve(id));
    }, [decide]);

    const onDecline = useCallback((e: MouseEvent<HTMLButtonElement>) => {
        const id = Number(e.currentTarget.dataset.id);
        const reason = window.prompt('Decline this request? You can say why (optional).', '');
        if (reason === null) return;
        decide(id, () => requestsApi.admin.decline(id, reason || undefined));
    }, [decide]);

    const onCancel = useCallback((e: MouseEvent<HTMLButtonElement>) => {
        const id = Number(e.currentTarget.dataset.id);
        decide(id, () => requestsApi.cancel(id));
    }, [decide]);

    const searchingNow = debounced.trim().length >= 2;
    const waiting = [...(queue?.pending || []), ...(queue?.failed || [])];
    const myPending = lists?.mine.filter(r => r.status === 'pending') || [];

    return (
        <Page id='homefinRequestsPage' title='Requests' className='mainAnimatedPage libraryPage allLibraryPage noSecondaryNavPage hfReqPage'>
            <div className='hfReqPage-inner'>
                <header className='hfReqPage-head'>
                    <h1>Requests</h1>
                    <p>Can&apos;t find something? Search for any film or show and ask for it.</p>
                </header>

                {config === undefined && <div className='hfReqPage-empty'>Loading…</div>}

                {config !== undefined && !config?.enabled && (
                    <div className='hfReqPage-empty'>
                        <span className='material-icons' aria-hidden='true'>playlist_add</span>
                        {config?.isAdmin ? (
                            <>
                                <h2>Connect Sonarr and Radarr to start taking requests</h2>
                                <a className='hfReq-primary' href='#/homefin/settings?section=apps'>Set them up</a>
                            </>
                        ) : (
                            <h2>Requests aren&apos;t set up on this server yet.</h2>
                        )}
                    </div>
                )}

                {config?.enabled && (
                    <>
                        <div className='hfReqSearch'>
                            <span className='material-icons' aria-hidden='true'>search</span>
                            <input
                                type='search'
                                value={query}
                                onChange={onQuery}
                                placeholder={searchPlaceholder(config)}
                                aria-label='Search films and shows to request'
                                autoComplete='off'
                            />
                            {query && (
                                <button type='button' onClick={clearQuery} aria-label='Clear search'>
                                    <span className='material-icons' aria-hidden='true'>close</span>
                                </button>
                            )}
                        </div>
                        {error && <p className='hfReq-error' role='alert'>{error}</p>}

                        {searchingNow ? (
                            <section className='hfReqSection'>
                                {searching && !results && <p className='hfReqPage-hint'>Searching…</p>}
                                {results?.length === 0 && <p className='hfReqPage-hint'>Nothing found for &ldquo;{debounced}&rdquo;.</p>}
                                <div className='hfReqGrid'>
                                    {results?.map(result => (
                                        <RequestCard
                                            key={`${result.type}-${result.id}`}
                                            title={result.title}
                                            year={result.year}
                                            poster={result.poster}
                                            state={result.state}
                                            progress={result.progress}
                                            caption={[result.year, result.type === 'tv' ? 'Series' : 'Film'].filter(Boolean).join(' · ')}
                                            value={result}
                                            onOpen={openResult}
                                        />
                                    ))}
                                </div>
                            </section>
                        ) : (
                            <>
                                {config.isAdmin && waiting.length > 0 && (
                                    <section className='hfReqSection'>
                                        <h2>Waiting for you <span className='hfReqCount'>{waiting.length}</span></h2>
                                        <ul className='hfReqRows'>
                                            {waiting.map(request => (
                                                <QueueRow key={request.id} request={request} busy={busyId === request.id} onApprove={onApprove} onDecline={onDecline} />
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                <section className='hfReqSection'>
                                    <h2>Your requests</h2>
                                    {lists && lists.mine.length === 0 && (
                                        <p className='hfReqPage-hint'>
                                            Nothing yet. Search above to ask for a film or show
                                            {config.policy === 'approve' ? '; an admin approves it, then it downloads.' : '.'}
                                        </p>
                                    )}
                                    <div className='hfReqGrid'>
                                        {lists?.mine.map(request => (
                                            <RequestCard
                                                key={request.id}
                                                title={request.title}
                                                year={request.year}
                                                poster={request.poster}
                                                state={request.state}
                                                progress={request.progress}
                                                caption={request.status === 'declined' && request.reason ? `Declined: ${request.reason}` : `${seasonsText(request)} · ${ago(request.createdAt)}`}
                                                value={request.id}
                                                onOpen={openResult}
                                            />
                                        ))}
                                    </div>
                                    {myPending.length > 0 && (
                                        <ul className='hfReqCancel'>
                                            {myPending.map(request => (
                                                <li key={request.id}>
                                                    {request.title}: {stateLabel(request.state).toLowerCase()}
                                                    <button type='button' data-id={request.id} onClick={onCancel} disabled={busyId === request.id}>Cancel request</button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </section>

                                {lists && lists.household.length > 0 && (
                                    <section className='hfReqSection'>
                                        <h2>Asked for by the household</h2>
                                        <div className='hfReqGrid'>
                                            {lists.household.map(request => (
                                                <RequestCard
                                                    key={request.id}
                                                    title={request.title}
                                                    year={request.year}
                                                    poster={request.poster}
                                                    state={request.state}
                                                    progress={request.progress}
                                                    caption={`Asked by ${request.requestedBy}`}
                                                    value={request.id}
                                                    onOpen={openResult}
                                                />
                                            ))}
                                        </div>
                                    </section>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>
            {selected && config && (
                <RequestDialog result={selected} config={config} onClose={closeDialog} onRequested={onRequested} />
            )}
        </Page>
    );
}
