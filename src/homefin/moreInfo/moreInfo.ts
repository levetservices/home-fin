// Netflix's "More Info" pop-up: a dimmed page with a centred detail card (art, actions, details,
// episodes with a season picker, More Like This and About), instead of leaving Home.
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { BaseItemPerson } from '@jellyfin/sdk/lib/generated-client/models/base-item-person';
import escapeHtml from 'escape-html';
import type { ApiClient } from 'jellyfin-apiclient';

import { CARD_IMAGE_WIDTH, LOGO_IMAGE_WIDTH, scaledImageUrl } from 'components/homesections/rows/artwork';
import { appRouter } from 'components/router/appRouter';
import { forgetTaste, getMoreLikeThis } from 'homefin/recs';
import { ratingBadgeHtml } from 'homefin/ui/rating';
import { playTitleNow } from 'homefin/ui/play';
import globalize from 'lib/globalize';

import './moreInfo.scss';

const SIMILAR_LIMIT = 12;
const CAST_SUMMARY = 3;
const TICKS_PER_MINUTE = 600000000;
/** Types the pop-up knows how to show; anything else opens Jellyfin's item page. */
const SUPPORTED_TYPES = new Set(['Movie', 'Series', 'Season', 'Episode']);

interface Open {
    overlay: HTMLElement
    apiClient: ApiClient
    returnFocus: Element | null
    /** Bumped on every render so late responses for an earlier title are ignored. */
    token: number
}

let current: Open | null = null;

// ── small formatters ─────────────────────────────────────────────────────

function minutes(ticks?: number | null) {
    if (!ticks) return '';
    // Never "0m": very short clips round up to a minute.
    const total = Math.max(1, Math.round(ticks / TICKS_PER_MINUTE));
    const hours = Math.floor(total / 60);
    if (!hours) return `${total}m`;
    return total % 60 ? `${hours}h ${total % 60}m` : `${hours}h`;
}

function image(apiClient: ApiClient, id: string | null | undefined, type: string, tag: string | null | undefined, maxWidth: number) {
    return scaledImageUrl(apiClient, id, type, tag, maxWidth);
}

function backdropUrl(item: BaseItemDto, apiClient: ApiClient, width: number) {
    return image(apiClient, item.Id, 'Backdrop', item.BackdropImageTags?.[0], width)
        || image(apiClient, item.Id, 'Thumb', item.ImageTags?.Thumb, width)
        || image(apiClient, item.Id, 'Primary', item.ImageTags?.Primary, width);
}

function people(item: BaseItemDto, type: string): BaseItemPerson[] {
    return (item.People || []).filter(person => person.Type === type);
}

function nameList(names: (string | null | undefined)[]) {
    return names.filter(Boolean).map(name => escapeHtml(name || '')).join(', ');
}

function videoQuality(item: BaseItemDto) {
    const video = item.MediaSources?.[0]?.MediaStreams?.find(stream => stream.Type === 'Video');
    const height = video?.Height || item.Height || 0;
    if (height >= 2000) return 'Ultra HD 4K';
    if (height >= 700) return 'HD';
    return '';
}

function iconButton(action: string, icon: string, label: string, extra = '') {
    const text = escapeHtml(label);
    return `<button type="button" class="hfInfo-circle${extra}" data-action="${action}" title="${text}" aria-label="${text}"><span class="material-icons" aria-hidden="true">${icon}</span></button>`;
}

// ── sections ─────────────────────────────────────────────────────────────

function heroHtml(item: BaseItemDto, apiClient: ApiClient) {
    const logo = image(apiClient, item.Id, 'Logo', item.ImageTags?.Logo, LOGO_IMAGE_WIDTH);
    const title = escapeHtml(item.Name || '');
    const resume = item.Type !== 'Series' && item.UserData?.PlaybackPositionTicks;
    const isFavourite = !!item.UserData?.IsFavorite;
    const likes = item.UserData?.Likes;

    let html = `<div class="hfInfo-hero" style="background-image:url('${backdropUrl(item, apiClient, 1280)}')">`;
    html += '<div class="hfInfo-heroFade"></div>';
    html += `<button type="button" class="hfInfo-close" data-action="close" aria-label="${escapeHtml(globalize.translate('ButtonClose'))}"><span class="material-icons" aria-hidden="true">close</span></button>`;
    html += '<div class="hfInfo-heroBody">';
    html += logo ? `<img class="hfInfo-logo" src="${logo}" alt="${title}" />` : `<h2 class="hfInfo-title">${title}</h2>`;
    html += '<div class="hfInfo-actions">';
    html += `<button type="button" class="hfInfo-play" data-action="play"><span class="material-icons" aria-hidden="true">play_arrow</span>${escapeHtml(globalize.translate(resume ? 'ButtonResume' : 'Play'))}</button>`;
    html += iconButton('favourite', isFavourite ? 'check' : 'add', isFavourite ? 'Remove from My List' : 'Add to My List', isFavourite ? ' is-on' : '');
    html += iconButton('like', likes === true ? 'thumb_up' : 'thumb_up_off_alt', 'I like this', likes === true ? ' is-on' : '');
    html += iconButton('dislike', likes === false ? 'thumb_down' : 'thumb_down_off_alt', 'Not for me', likes === false ? ' is-on' : '');
    html += '</div></div></div>';
    return html;
}

/** Left column: year · seasons · HD, the rating circle, synopsis. */
function detailsMainHtml(item: BaseItemDto) {
    let left = '<div class="hfInfo-meta">';
    const facts: string[] = [];
    if (item.ProductionYear) facts.push(String(item.ProductionYear));
    if (item.Type === 'Series' && item.ChildCount) {
        facts.push(escapeHtml(globalize.translate(item.ChildCount === 1 ? 'ValueOneSeason' : 'ValueSeasonCount', item.ChildCount)));
    } else if (item.RunTimeTicks) {
        facts.push(minutes(item.RunTimeTicks));
    }
    left += facts.map(fact => `<span>${fact}</span>`).join('');
    const quality = videoQuality(item);
    if (quality) left += `<span class="hfInfo-hd">${quality}</span>`;
    left += '</div>';
    if (item.OfficialRating) left += `<div class="hfInfo-maturity">${ratingBadgeHtml(item.OfficialRating)}</div>`;
    if (item.Taglines?.[0]) left += `<p class="hfInfo-tagline">${escapeHtml(item.Taglines[0])}</p>`;
    if (item.Overview) left += `<p class="hfInfo-overview">${escapeHtml(item.Overview)}</p>`;
    return left;
}

/** Right column: cast, genres, "This series is: …". */
function detailsSideHtml(item: BaseItemDto) {
    const cast = people(item, 'Actor');
    let right = '';
    if (cast.length) {
        right += `<p><span class="hfInfo-label">Cast:</span> ${nameList(cast.slice(0, CAST_SUMMARY).map(p => p.Name))}`;
        if (cast.length > CAST_SUMMARY) right += ', <a href="#" class="hfInfo-more" data-action="about">more</a>';
        right += '</p>';
    }
    if (item.Genres?.length) right += `<p><span class="hfInfo-label">Genres:</span> ${nameList(item.Genres)}</p>`;
    if (item.Tags?.length) {
        right += `<p><span class="hfInfo-label">This ${item.Type === 'Series' ? 'series' : 'film'} is:</span> ${nameList(item.Tags.slice(0, 3))}</p>`;
    }
    return right;
}

function detailsHtml(item: BaseItemDto) {
    return `<div class="hfInfo-details"><div class="hfInfo-detailsMain">${detailsMainHtml(item)}</div><div class="hfInfo-detailsSide">${detailsSideHtml(item)}</div></div>`;
}

function aboutHtml(item: BaseItemDto) {
    const rows: [string, string][] = [];
    const directors = people(item, 'Director');
    const writers = people(item, 'Writer');
    const cast = people(item, 'Actor');
    if (directors.length) rows.push([item.Type === 'Series' ? 'Creators' : 'Director', nameList(directors.map(p => p.Name))]);
    if (cast.length) rows.push(['Cast', nameList(cast.map(p => p.Name))]);
    if (writers.length) rows.push(['Writer', nameList(writers.map(p => p.Name))]);
    if (item.Genres?.length) rows.push(['Genres', nameList(item.Genres)]);
    if (item.Tags?.length) rows.push([`This ${item.Type === 'Series' ? 'series' : 'film'} is`, nameList(item.Tags)]);
    if (item.Studios?.length) rows.push(['Studio', nameList(item.Studios.map(s => s.Name))]);
    if (item.OfficialRating) rows.push(['Maturity rating', ratingBadgeHtml(item.OfficialRating)]);

    let html = '<section class="hfInfo-section hfInfo-about" id="hfInfoAbout">';
    html += `<h3>About <strong>${escapeHtml(item.Name || '')}</strong></h3>`;
    html += rows.map(([label, value]) => `<p><span class="hfInfo-label">${label}:</span> ${value}</p>`).join('');
    html += '<p><a class="hfInfo-full" href="#" data-action="full">Full details <span class="material-icons" aria-hidden="true">chevron_right</span></a></p>';
    html += '</section>';
    return html;
}

function episodeHtml(episode: BaseItemDto, index: number, series: BaseItemDto, apiClient: ApiClient) {
    const still = image(apiClient, episode.Id, 'Primary', episode.ImageTags?.Primary, CARD_IMAGE_WIDTH) || backdropUrl(series, apiClient, CARD_IMAGE_WIDTH);
    const progress = episode.UserData?.PlayedPercentage;
    let html = `<li><button type="button" class="hfInfo-episode" data-action="episode" data-index="${index}">`;
    html += `<span class="hfInfo-episodeNumber">${episode.IndexNumber ?? ''}</span>`;
    html += `<span class="hfInfo-episodeStill" style="background-image:url('${still}')">`;
    html += '<span class="hfInfo-episodePlay material-icons" aria-hidden="true">play_circle_outline</span>';
    if (progress && progress > 0 && progress < 100) html += `<span class="hfInfo-progress"><span style="width:${Math.round(progress)}%"></span></span>`;
    html += '</span>';
    html += '<span class="hfInfo-episodeText">';
    html += `<span class="hfInfo-episodeHead"><span class="hfInfo-episodeTitle">${escapeHtml(episode.Name || '')}</span><span class="hfInfo-episodeTime">${minutes(episode.RunTimeTicks)}</span></span>`;
    if (episode.Overview) html += `<span class="hfInfo-episodeOverview">${escapeHtml(episode.Overview)}</span>`;
    html += '</span></button></li>';
    return html;
}

function similarHtml(item: BaseItemDto, index: number, apiClient: ApiClient) {
    const art = backdropUrl(item, apiClient, CARD_IMAGE_WIDTH);
    const isFavourite = !!item.UserData?.IsFavorite;
    let html = '<li class="hfInfo-similar">';
    html += `<button type="button" class="hfInfo-similarArt" data-action="similar" data-index="${index}" style="background-image:url('${art}')" aria-label="${escapeHtml(item.Name || '')}">`;
    if (item.Type === 'Series' && item.ChildCount) {
        html += `<span class="hfInfo-similarBadge">${escapeHtml(globalize.translate(item.ChildCount === 1 ? 'ValueOneSeason' : 'ValueSeasonCount', item.ChildCount))}</span>`;
    } else if (item.RunTimeTicks) {
        html += `<span class="hfInfo-similarBadge">${minutes(item.RunTimeTicks)}</span>`;
    }
    html += '</button>';
    html += '<div class="hfInfo-similarBody">';
    html += '<div class="hfInfo-similarHead"><div class="hfInfo-similarMeta">';
    html += ratingBadgeHtml(item.OfficialRating);
    if (item.ProductionYear) html += `<span>${item.ProductionYear}</span>`;
    html += '</div>';
    html += iconButton('similar-favourite', isFavourite ? 'check' : 'add', isFavourite ? 'Remove from My List' : 'Add to My List', isFavourite ? ' is-on' : '').replace('data-action', `data-index="${index}" data-action`);
    html += '</div>';
    html += `<p class="hfInfo-similarTitle">${escapeHtml(item.Name || '')}</p>`;
    if (item.Overview) html += `<p class="hfInfo-similarOverview">${escapeHtml(item.Overview)}</p>`;
    html += '</div></li>';
    return html;
}

// ── data ─────────────────────────────────────────────────────────────────

/** The title to show: episodes and seasons open their series (as on Netflix). */
async function loadTitle(item: BaseItemDto, apiClient: ApiClient) {
    const userId = apiClient.getCurrentUserId();
    const id = (item.Type === 'Episode' || item.Type === 'Season') && item.SeriesId ? item.SeriesId : item.Id;
    return apiClient.getItem(userId, id || '');
}

// ── rendering ────────────────────────────────────────────────────────────

function setButton(button: HTMLElement, on: boolean, icon: string, label: string) {
    button.classList.toggle('is-on', on);
    const glyph = button.querySelector('.material-icons');
    if (glyph) glyph.textContent = icon;
    button.title = label;
    button.setAttribute('aria-label', label);
}

async function renderEpisodes(section: HTMLElement, series: BaseItemDto, seasonId: string, state: Open, token: number) {
    const { apiClient } = state;
    const list = section.querySelector<HTMLElement>('.hfInfo-episodes');
    if (!list) return;
    list.classList.add('is-loading');
    const result = await apiClient.getEpisodes(series.Id || '', {
        userId: apiClient.getCurrentUserId(),
        seasonId,
        Fields: 'Overview',
        EnableImageTypes: 'Primary'
    });
    if (state.token !== token || !list.isConnected) return;
    const episodes = result.Items || [];
    list.innerHTML = episodes.map((episode, i) => episodeHtml(episode, i, series, apiClient)).join('');
    list.classList.remove('is-loading');
    (list as HTMLElement & { hfEpisodes?: BaseItemDto[] }).hfEpisodes = episodes;
}

async function renderEpisodesSection(container: HTMLElement, series: BaseItemDto, preferSeasonId: string | null | undefined, state: Open, token: number) {
    const { apiClient } = state;
    const seasons = (await apiClient.getSeasons(series.Id || '', { userId: apiClient.getCurrentUserId() })).Items || [];
    if (state.token !== token || !seasons.length) return;

    // Open on the season being watched (Next Up), else the one asked for, else the first.
    let seasonId = preferSeasonId && seasons.some(s => s.Id === preferSeasonId) ? preferSeasonId : null;
    if (!seasonId) {
        const nextUp = await apiClient.getNextUpEpisodes({ SeriesId: series.Id, UserId: apiClient.getCurrentUserId(), Limit: 1, EnableTotalRecordCount: false }).catch(() => null);
        seasonId = nextUp?.Items?.[0]?.SeasonId || seasons[0].Id || '';
    }
    if (state.token !== token) return;

    let html = '<div class="hfInfo-sectionHead"><h3>Episodes</h3>';
    if (seasons.length > 1) {
        html += '<select class="hfInfo-seasons" aria-label="Season">';
        html += seasons.map(season => {
            const count = season.ChildCount ? ` (${season.ChildCount} Episodes)` : '';
            return `<option value="${season.Id}"${season.Id === seasonId ? ' selected' : ''}>${escapeHtml(season.Name || '')}${count}</option>`;
        }).join('');
        html += '</select>';
    } else {
        html += `<span class="hfInfo-seasonName">${escapeHtml(seasons[0].Name || '')}</span>`;
    }
    html += '</div><ol class="hfInfo-episodes"></ol>';
    container.innerHTML = html;
    container.classList.remove('hide');

    container.querySelector<HTMLSelectElement>('.hfInfo-seasons')?.addEventListener('change', e => {
        renderEpisodes(container, series, (e.target as HTMLSelectElement).value, state, token)
            .catch(err => console.error('[MoreInfo] episodes failed', err));
    });
    await renderEpisodes(container, series, seasonId || '', state, token);
}

async function renderSimilar(container: HTMLElement, item: BaseItemDto, state: Open, token: number) {
    const { apiClient } = state;
    // Thumbs-down titles never come back as suggestions.
    const items = await getMoreLikeThis(item, apiClient, SIMILAR_LIMIT, 'Overview,ProductionYear,OfficialRating,RunTimeTicks,ChildCount,Genres,Tags,Studios,People');
    if (state.token !== token) return;
    if (!items.length) return;
    container.innerHTML = '<div class="hfInfo-sectionHead"><h3>More Like This</h3></div><ul class="hfInfo-similarGrid">'
        + items.map((similar, i) => similarHtml(similar, i, apiClient)).join('') + '</ul>';
    (container as HTMLElement & { hfSimilar?: BaseItemDto[] }).hfSimilar = items;
    container.classList.remove('hide');
}

async function render(state: Open, requested: BaseItemDto) {
    const token = ++state.token;
    const { overlay, apiClient } = state;
    const modal = overlay.querySelector<HTMLElement>('.hfInfo-modal');
    if (!modal) return;
    modal.classList.add('is-loading');

    const item = await loadTitle(requested, apiClient);
    if (state.token !== token) return;

    modal.innerHTML = heroHtml(item, apiClient)
        + '<div class="hfInfo-body">'
        + detailsHtml(item)
        + '<section class="hfInfo-section hfInfo-episodesSection hide"></section>'
        + '<section class="hfInfo-section hfInfo-similarSection hide"></section>'
        + aboutHtml(item)
        + '</div>';
    modal.classList.remove('is-loading');
    (modal as HTMLElement & { hfItem?: BaseItemDto }).hfItem = item;
    overlay.scrollTop = 0;
    modal.querySelector<HTMLElement>('.hfInfo-play')?.focus({ preventScroll: true });

    const episodes = modal.querySelector<HTMLElement>('.hfInfo-episodesSection');
    const similar = modal.querySelector<HTMLElement>('.hfInfo-similarSection');
    if (item.Type === 'Series' && episodes) {
        let preferSeason: string | null | undefined = null;
        if (requested.Type === 'Episode') preferSeason = requested.SeasonId;
        if (requested.Type === 'Season') preferSeason = requested.Id;
        renderEpisodesSection(episodes, item, preferSeason, state, token).catch(err => console.error('[MoreInfo] seasons failed', err));
    }
    if (similar) renderSimilar(similar, item, state, token).catch(err => console.error('[MoreInfo] similar failed', err));
}

// ── actions ──────────────────────────────────────────────────────────────

function toggleFavourite(item: BaseItemDto, button: HTMLElement, apiClient: ApiClient) {
    const next = !item.UserData?.IsFavorite;
    apiClient.updateFavoriteStatus(apiClient.getCurrentUserId(), item.Id || '', next).then(() => {
        item.UserData = { ...item.UserData, IsFavorite: next };
        setButton(button, next, next ? 'check' : 'add', next ? 'Remove from My List' : 'Add to My List');
    }).catch((err: unknown) => console.error('[MoreInfo] My List failed', err));
}

/** Thumbs up / down write Jellyfin's Likes, which the recommender reads (thumbs down hides a title). */
function rate(item: BaseItemDto, likes: boolean, modal: HTMLElement, apiClient: ApiClient) {
    const userId = apiClient.getCurrentUserId();
    const clearing = item.UserData?.Likes === likes;
    const request = clearing ? apiClient.clearUserItemRating(userId, item.Id || '') : apiClient.updateUserItemRating(userId, item.Id || '', likes);
    request.then(() => {
        const value = clearing ? null : likes;
        item.UserData = { ...item.UserData, Likes: value };
        forgetTaste(apiClient);
        const up = modal.querySelector<HTMLElement>('[data-action="like"]');
        const down = modal.querySelector<HTMLElement>('[data-action="dislike"]');
        if (up) setButton(up, value === true, value === true ? 'thumb_up' : 'thumb_up_off_alt', 'I like this');
        if (down) setButton(down, value === false, value === false ? 'thumb_down' : 'thumb_down_off_alt', 'Not for me');
    }).catch((err: unknown) => console.error('[MoreInfo] rating failed', err));
}

function onClick(e: MouseEvent) {
    const state = current;
    if (!state) return;
    const target = e.target as HTMLElement;
    if (target === state.overlay) {
        closeMoreInfo();
        return;
    }
    const button = target.closest<HTMLElement>('[data-action]');
    const modal = state.overlay.querySelector<HTMLElement & { hfItem?: BaseItemDto }>('.hfInfo-modal');
    const item = modal?.hfItem;
    if (!button || !modal || !item) return;
    const { apiClient } = state;
    const index = Number(button.dataset.index);

    switch (button.dataset.action) {
        case 'close':
            closeMoreInfo();
            break;
        case 'play':
            closeMoreInfo();
            playTitleNow(item, apiClient);
            break;
        case 'favourite':
            toggleFavourite(item, button, apiClient);
            break;
        case 'like':
        case 'dislike':
            rate(item, button.dataset.action === 'like', modal, apiClient);
            break;
        case 'episode': {
            const list = button.closest<HTMLElement & { hfEpisodes?: BaseItemDto[] }>('.hfInfo-episodes');
            const episode = list?.hfEpisodes?.[index];
            if (episode) {
                closeMoreInfo();
                playTitleNow(episode, apiClient);
            }
            break;
        }
        case 'similar':
        case 'similar-favourite': {
            const section = button.closest<HTMLElement & { hfSimilar?: BaseItemDto[] }>('.hfInfo-similarSection');
            const similar = section?.hfSimilar?.[index];
            if (!similar) break;
            if (button.dataset.action === 'similar') {
                render(state, similar).catch(err => console.error('[MoreInfo] failed to load', err));
            } else {
                toggleFavourite(similar, button, apiClient);
            }
            break;
        }
        case 'about':
            e.preventDefault();
            modal.querySelector('#hfInfoAbout')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            break;
        case 'full':
            e.preventDefault();
            closeMoreInfo();
            appRouter.showItem(item, { fullDetails: true });
            break;
        default:
            break;
    }
}

function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        e.stopPropagation();
        closeMoreInfo();
    }
}

export function closeMoreInfo() {
    const state = current;
    if (!state) return;
    current = null;
    state.overlay.classList.add('is-closing');
    window.setTimeout(() => state.overlay.remove(), 200);
    document.documentElement.classList.remove('hfInfo-lock');
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('hashchange', closeMoreInfo);
    if (state.returnFocus instanceof HTMLElement) state.returnFocus.focus({ preventScroll: true });
}

/** Open the pop-up for a title (episodes and seasons show their series). */
export function openMoreInfo(item: BaseItemDto, apiClient: ApiClient) {
    if (!item.Type || !SUPPORTED_TYPES.has(item.Type)) {
        appRouter.showItem(item, { fullDetails: true });
        return;
    }

    if (!current) {
        const overlay = document.createElement('div');
        overlay.className = 'hfInfo';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', item.SeriesName || item.Name || '');
        overlay.innerHTML = '<div class="hfInfo-modal is-loading"><div class="hfInfo-spinner" aria-hidden="true"></div></div>';
        overlay.addEventListener('click', onClick);
        document.body.appendChild(overlay);
        document.documentElement.classList.add('hfInfo-lock');
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('hashchange', closeMoreInfo);
        current = { overlay, apiClient, returnFocus: document.activeElement, token: 0 };
    }

    const state = current;
    render(state, item).catch(err => {
        console.error('[MoreInfo] failed to load', err);
        // Fall back to Jellyfin's own page rather than leaving an empty pop-up.
        if (current === state) {
            closeMoreInfo();
            appRouter.showItem(item, { fullDetails: true });
        }
    });
}
