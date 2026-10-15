import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import escapeHtml from 'escape-html';
import type { ApiClient } from 'jellyfin-apiclient';

import layoutManager from 'components/layoutManager';
import { playbackManager } from 'components/playback/playbackmanager';
import { appRouter } from 'components/router/appRouter';
import globalize from 'lib/globalize';

import './heroBanner.scss';

/** How long each featured title stays on screen. */
const SLIDE_INTERVAL_MS = 9000;
const SLIDE_COUNT = 6;
/** Scroll distance after which the header frosts over the banner. */
const HEADER_FROST_OFFSET = 48;

export interface HeroController {
    pause: () => void
    resume: () => void
    destroy: () => void
}

export type HeroElement = HTMLElement & { heroController?: HeroController };

const ITEM_QUERY = {
    IncludeItemTypes: 'Movie,Series',
    Recursive: true,
    SortBy: 'Random',
    ImageTypes: 'Backdrop',
    HasOverview: true,
    Fields: 'Overview,Genres,ProductionYear,OfficialRating,CommunityRating,RunTimeTicks,ChildCount',
    EnableImageTypes: 'Backdrop,Logo',
    ImageTypeLimit: 1,
    EnableTotalRecordCount: false,
    Limit: SLIDE_COUNT
};

/** Prefer titles the user hasn't seen yet, topping up with anything else. */
async function fetchFeaturedItems(apiClient: ApiClient): Promise<BaseItemDto[]> {
    const userId = apiClient.getCurrentUserId();
    const unplayed = await apiClient.getItems(userId, { ...ITEM_QUERY, IsPlayed: false });
    const items = unplayed.Items || [];
    if (items.length >= SLIDE_COUNT) return items;

    const rest = await apiClient.getItems(userId, ITEM_QUERY);
    const seen = new Set(items.map(item => item.Id));
    for (const item of rest.Items || []) {
        if (items.length >= SLIDE_COUNT) break;
        if (!seen.has(item.Id)) items.push(item);
    }
    return items;
}

function formatRuntime(ticks?: number | null) {
    if (!ticks) return '';
    const minutes = Math.round(ticks / 600000000);
    const hours = Math.floor(minutes / 60);
    return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function getMetaParts(item: BaseItemDto) {
    const parts: string[] = [];
    if (item.ProductionYear) parts.push(String(item.ProductionYear));
    if (item.OfficialRating) parts.push(`<span class="homeHero-rating">${escapeHtml(item.OfficialRating)}</span>`);
    if (item.CommunityRating) {
        parts.push(`<span class="homeHero-score"><span class="material-icons homeHero-star" aria-hidden="true">star</span>${item.CommunityRating.toFixed(1)}</span>`);
    }
    if (item.Type === 'Series') {
        if (item.ChildCount) {
            parts.push(escapeHtml(globalize.translate(item.ChildCount === 1 ? 'ValueOneSeason' : 'ValueSeasonCount', item.ChildCount)));
        }
    } else {
        const runtime = formatRuntime(item.RunTimeTicks);
        if (runtime) parts.push(runtime);
    }
    if (item.Genres?.length) parts.push(escapeHtml(item.Genres.slice(0, 3).join(' · ')));
    return parts;
}

function getResumeTicks(item: BaseItemDto) {
    return item.Type !== 'Series' ? item.UserData?.PlaybackPositionTicks || 0 : 0;
}

function getSlideContentHtml(item: BaseItemDto, apiClient: ApiClient) {
    const logoTag = item.ImageTags?.Logo;
    const title = escapeHtml(item.Name || '');
    let html = '';

    html += `<div class="homeHero-eyebrow">${escapeHtml(globalize.translate(item.Type === 'Series' ? 'Series' : 'Movie'))}</div>`;

    if (logoTag && item.Id) {
        const logoUrl = apiClient.getScaledImageUrl(item.Id, { type: 'Logo', maxWidth: 800, tag: logoTag });
        html += `<h1 class="homeHero-title homeHero-title-logo"><img class="homeHero-logo" src="${logoUrl}" alt="${title}" /></h1>`;
    } else {
        html += `<h1 class="homeHero-title">${title}</h1>`;
    }

    html += '<div class="homeHero-meta">' + getMetaParts(item).map(part => `<span>${part}</span>`).join('') + '</div>';

    if (item.Overview) {
        html += `<p class="homeHero-overview">${escapeHtml(item.Overview)}</p>`;
    }

    const playLabel = globalize.translate(getResumeTicks(item) ? 'ButtonResume' : 'Play');
    html += '<div class="homeHero-actions focuscontainer-x">';
    html += `<button is="emby-button" type="button" class="homeHero-button homeHero-button-play" data-action="play"><span class="material-icons" aria-hidden="true">play_arrow</span><span>${escapeHtml(playLabel)}</span></button>`;
    html += `<button is="emby-button" type="button" class="homeHero-button homeHero-button-info" data-action="info"><span class="material-icons" aria-hidden="true">info_outline</span><span>${escapeHtml(globalize.translate('MoreInfo'))}</span></button>`;
    html += '</div>';

    return html;
}

function getBackdropUrl(item: BaseItemDto, apiClient: ApiClient) {
    const tag = item.BackdropImageTags?.[0];
    if (!tag || !item.Id) return '';
    const width = Math.min(2560, Math.round(window.innerWidth * (window.devicePixelRatio || 1)));
    return apiClient.getScaledImageUrl(item.Id, { type: 'Backdrop', index: 0, maxWidth: width, tag });
}

/** Re-trigger a CSS animation by removing the class, forcing layout, then adding it back. */
function restartAnimation(el: HTMLElement, className: string) {
    el.classList.remove(className);
    el.getBoundingClientRect();
    el.classList.add(className);
}

function getHeader() {
    return document.querySelector<HTMLElement>('.skinHeader');
}

/**
 * Renders a Netflix-style featured banner: a rotating set of full-bleed
 * backdrops with the title's logo, a short synopsis and Play / More Info.
 */
export async function loadHeroBanner(elem: HeroElement, apiClient: ApiClient) {
    let items: BaseItemDto[];
    try {
        items = await fetchFeaturedItems(apiClient);
    } catch (err) {
        console.error('[HomeHero] failed to load featured items', err);
        items = [];
    }

    if (!items.length || !elem.isConnected) {
        elem.innerHTML = '';
        elem.classList.add('hide');
        return;
    }

    let html = '<div class="homeHero-slides" aria-hidden="true">';
    items.forEach((item, index) => {
        html += `<div class="homeHero-slide${index === 0 ? ' is-active' : ''}" data-index="${index}" style="background-image:url('${getBackdropUrl(item, apiClient)}')"></div>`;
    });
    html += '</div>';
    html += '<div class="homeHero-scrim"></div>';
    html += '<div class="homeHero-content padded-left padded-right"></div>';
    if (items.length > 1) {
        html += '<div class="homeHero-dots" role="tablist">';
        items.forEach((item, index) => {
            html += `<button type="button" class="homeHero-dot${index === 0 ? ' is-active' : ''}" data-index="${index}" aria-label="${escapeHtml(item.Name || '')}"><span></span></button>`;
        });
        html += '</div>';
    }

    elem.classList.remove('hide');
    elem.classList.add('homeHero');
    elem.innerHTML = html;

    const content = elem.querySelector<HTMLElement>('.homeHero-content');
    const slides = elem.querySelectorAll<HTMLElement>('.homeHero-slide');
    const dots = elem.querySelectorAll<HTMLElement>('.homeHero-dot');
    let current = 0;
    let timer: number | undefined;
    let hovering = false;
    let paused = false;

    const show = (index: number) => {
        current = (index + items.length) % items.length;
        slides.forEach((slide, i) => {
            slide.classList.toggle('is-active', i === current);
        });
        dots.forEach((dot, i) => {
            dot.classList.toggle('is-active', i === current);
            dot.setAttribute('aria-selected', String(i === current));
        });
        if (content) {
            content.innerHTML = getSlideContentHtml(items[current], apiClient);
            restartAnimation(content, 'is-entering');
        }
        // Restart the progress fill on the active dot.
        dots[current]?.style.setProperty('--hf-slide-duration', `${SLIDE_INTERVAL_MS}ms`);
    };

    const stop = () => {
        window.clearInterval(timer);
        timer = undefined;
    };

    const start = () => {
        stop();
        if (items.length < 2 || paused || hovering || document.hidden) return;
        // Start the active dot's progress fill from empty so it matches the timer.
        const dot = dots[current];
        if (dot) restartAnimation(dot, 'is-active');
        timer = window.setInterval(() => {
            if (!elem.isConnected) {
                controller.destroy();
                return;
            }
            show(current + 1);
        }, SLIDE_INTERVAL_MS);
    };

    // Pull the banner up underneath the fixed header so it runs edge to edge.
    const fitUnderHeader = () => {
        elem.style.marginTop = '';
        if (layoutManager.tv) return;
        const top = elem.getBoundingClientRect().top + window.scrollY;
        if (top > 0) elem.style.marginTop = `-${top}px`;
    };

    const onScroll = () => {
        getHeader()?.classList.toggle('hf-scrolled', window.scrollY > HEADER_FROST_OFFSET);
    };

    const onVisibility = () => {
        if (document.hidden) {
            stop();
        } else {
            start();
        }
    };

    const attachChrome = () => {
        getHeader()?.classList.add('hf-overHero');
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', fitUnderHeader);
        document.addEventListener('visibilitychange', onVisibility);
    };

    const detachChrome = () => {
        getHeader()?.classList.remove('hf-overHero', 'hf-scrolled');
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', fitUnderHeader);
        document.removeEventListener('visibilitychange', onVisibility);
    };

    elem.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const dot = target.closest<HTMLElement>('.homeHero-dot');
        if (dot) {
            show(Number(dot.dataset.index));
            start();
            return;
        }

        const item = items[current];
        const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
        if (action === 'play') {
            playbackManager.play({
                items: [item],
                startPositionTicks: getResumeTicks(item)
            }).catch((err: unknown) => console.error('[HomeHero] playback failed', err));
        } else if (action === 'info' || target.closest('.homeHero-slides, .homeHero-title')) {
            appRouter.showItem(item);
        }
    });

    elem.addEventListener('mouseenter', () => {
        hovering = true;
        stop();
    });
    elem.addEventListener('mouseleave', () => {
        hovering = false;
        start();
    });
    // Keyboard / remote users: hold the slide while focus is inside the banner.
    elem.addEventListener('focusin', () => {
        hovering = true;
        stop();
    });
    elem.addEventListener('focusout', () => {
        hovering = false;
        start();
    });

    const controller: HeroController = {
        pause() {
            paused = true;
            stop();
            detachChrome();
        },
        resume() {
            paused = false;
            attachChrome();
            fitUnderHeader();
            start();
        },
        destroy() {
            paused = true;
            stop();
            detachChrome();
            elem.heroController = undefined;
        }
    };
    elem.heroController = controller;

    show(0);
    controller.resume();
}
