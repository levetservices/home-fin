// Minimal Sonarr / Radarr (v3 API) clients for requests: search, add, monitor, status.

/** Seasons worth offering: Sonarr's season 0 is specials. */
export function realSeasons(series) {
    return (series?.seasons || []).map(s => s.seasonNumber).filter(n => n > 0);
}

function image(item, type) {
    const found = (item.images || []).find(i => i.coverType === type);
    return found?.remoteUrl || (type === 'poster' ? item.remotePoster : null) || null;
}

function createClient(name, { url, apiKey, fetchImpl = fetch, timeoutMs = 15000 }) {
    const base = String(url || '').replace(/\/+$/, '') + '/api/v3';

    async function call(path, { method = 'GET', body } = {}) {
        let res;
        try {
            res = await fetchImpl(base + path, {
                method,
                headers: { 'X-Api-Key': apiKey, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(timeoutMs)
            });
        } catch (err) {
            const error = new Error(`Can't reach ${name} at ${url} (${err.cause?.code || err.name})`);
            error.arr = true;
            throw error;
        }
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            let detail = text.slice(0, 200);
            try {
                const json = JSON.parse(text);
                detail = (Array.isArray(json) ? json.map(e => e.errorMessage).join('; ') : json.message) || detail;
            } catch {
                // not JSON
            }
            const error = new Error(res.status === 401 ? `${name} rejected the API key` : `${name}: ${detail || res.status}`);
            error.arr = true;
            error.status = res.status;
            throw error;
        }
        if (res.status === 204) return null;
        return res.json();
    }

    return {
        call,
        status: () => call('/system/status'),
        qualityProfiles: () => call('/qualityprofile'),
        rootFolders: () => call('/rootfolder'),
        queue: () => call('/queue?pageSize=200&includeUnknownMovieItems=false&includeUnknownSeriesItems=false')
    };
}

export function createRadarr(options) {
    const client = createClient('Radarr', options);
    return {
        ...client,
        lookup: term => client.call(`/movie/lookup?term=${encodeURIComponent(term)}`),
        lookupTmdb: tmdbId => client.call(`/movie/lookup/tmdb?tmdbId=${encodeURIComponent(tmdbId)}`),
        library: () => client.call('/movie'),
        add: movie => client.call('/movie', { method: 'POST', body: movie }),
        update: movie => client.call(`/movie/${movie.id}`, { method: 'PUT', body: movie }),
        search: movieId => client.call('/command', { method: 'POST', body: { name: 'MoviesSearch', movieIds: [movieId] } })
    };
}

export function createSonarr(options) {
    const client = createClient('Sonarr', options);
    return {
        ...client,
        lookup: term => client.call(`/series/lookup?term=${encodeURIComponent(term)}`),
        async lookupTvdb(tvdbId) {
            const results = await client.call(`/series/lookup?term=${encodeURIComponent(`tvdb:${tvdbId}`)}`);
            return results.find(r => r.tvdbId === Number(tvdbId)) || null;
        },
        /** Sonarr v3 needs a language profile; v4 dropped them (the call fails or returns nothing). */
        languageProfiles: () => client.call('/languageprofile').catch(() => []),
        library: () => client.call('/series'),
        get: id => client.call(`/series/${id}`),
        add: series => client.call('/series', { method: 'POST', body: series }),
        update: series => client.call(`/series/${series.id}`, { method: 'PUT', body: series }),
        searchSeason: (seriesId, seasonNumber) => client.call('/command', { method: 'POST', body: { name: 'SeasonSearch', seriesId, seasonNumber } }),
        searchSeries: seriesId => client.call('/command', { method: 'POST', body: { name: 'SeriesSearch', seriesId } })
    };
}

/** A search result in the shape the web client shows. */
export function toResult(type, item) {
    return {
        type,
        id: type === 'movie' ? item.tmdbId : item.tvdbId,
        title: item.title,
        year: item.year || null,
        overview: item.overview || '',
        poster: image(item, 'poster'),
        backdrop: image(item, 'fanart'),
        genres: (item.genres || []).slice(0, 3),
        runtime: item.runtime || null,
        network: item.network || null,
        rating: item.certification || null,
        seasons: type === 'tv' ? realSeasons(item) : null
    };
}
