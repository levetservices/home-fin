import React, { type FC, useCallback, useEffect, useState } from 'react';

import { type MediaRequest, type MediaResult, type RequestsConfig, getRequestsConfig, requestsApi } from 'homefin/accounts/api';

import RequestCard from './RequestCard';
import RequestDialog from './RequestDialog';

import './requests.scss';

const MAX_SUGGESTIONS = 12;

/** Under the library search results: titles that aren't here yet, ready to request. */
const RequestSuggestions: FC<{ query: string }> = ({ query }) => {
    const [config, setConfig] = useState<RequestsConfig | null>(null);
    const [results, setResults] = useState<MediaResult[]>([]);
    const [selected, setSelected] = useState<MediaResult | null>(null);

    useEffect(() => {
        getRequestsConfig().then(setConfig).catch(() => setConfig(null));
    }, []);

    useEffect(() => {
        const term = query.trim();
        if (!config?.enabled || config.policy === 'off' || term.length < 2) {
            setResults([]);
            return;
        }
        let stale = false;
        requestsApi.search(term)
            .then(found => {
                if (!stale) setResults(found.results.filter(r => r.state !== 'available').slice(0, MAX_SUGGESTIONS));
            })
            .catch(() => {
                if (!stale) setResults([]);
            });
        return () => {
            stale = true;
        };
    }, [query, config]);

    const open = useCallback((value: MediaResult | number) => {
        if (typeof value !== 'number') setSelected(value);
    }, []);
    const close = useCallback(() => setSelected(null), []);
    const onRequested = useCallback((request: MediaRequest) => {
        setResults(current => current.map(r => (r.type === request.type && r.id === request.mediaId ? { ...r, state: request.state } : r)));
    }, []);

    if (!config || !results.length) return null;
    return (
        <section className='hfReqSuggest'>
            <h2>Not here yet</h2>
            <p>Ask for it and it&apos;ll be added{config.policy === 'approve' ? ' once an admin approves' : ''}.</p>
            <div className='hfReqGrid'>
                {results.map(result => (
                    <RequestCard
                        key={`${result.type}-${result.id}`}
                        title={result.title}
                        year={result.year}
                        poster={result.poster}
                        state={result.state}
                        progress={result.progress}
                        caption={[result.year, result.type === 'tv' ? 'Series' : 'Film'].filter(Boolean).join(' · ')}
                        value={result}
                        onOpen={open}
                    />
                ))}
            </div>
            {selected && <RequestDialog result={selected} config={config} onClose={close} onRequested={onRequested} />}
        </section>
    );
};

export default RequestSuggestions;
