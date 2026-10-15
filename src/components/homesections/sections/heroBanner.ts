import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import escapeHtml from 'escape-html';
import type { ApiClient } from 'jellyfin-apiclient';

import layoutManager from 'components/layoutManager';
import { playbackManager } from 'components/playback/playbackmanager';
import { appRouter } from 'components/router/appRouter';
import globalize from 'lib/globalize';

import './heroBanner.scss';

/** How long each featured title stays on screen. */
const SLIDE_INTERVAL_MS = 8000;
const SLIDE_COUNT = 6;

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
    return hours ? `${hours} hr ${minutes % 60} min` : `${minutes} min`;
}

/** Apple TV style info line: "Drama, Thriller · 2023 · 12A · 2 hr 4 min · ★ 7.8". */
function getMetaHtml(item: BaseItemDto) {
    const parts: string[] = [];
    if (item.Genres?.length) parts.push(escapeHtml(item.Genres.slice(0, 2).join(', ')));
    if (item.ProductionYear) parts.push(String(item.ProductionYear));
    if (item.OfficialRating) parts.push(`<span class="homeHero-badge">${escapeHtml(item.OfficialRating)}</span>`);
    if (item.Type === 'Series') {
        if (item.ChildCount) {
            parts.push(escapeHtml(globalize.translate(item.ChildCount === 1 ? 'ValueOneSeason' : 'ValueSeasonCount', item.ChildCount)));
        }
    } else {
        const runtime = formatRuntime(item.RunTimeTicks);
        if (runtime) parts.push(runtime);
    }
    if (item.CommunityRating) {
        parts.push(`<span class="homeHero-score"><span class="material-icons" aria-hidden="true">star</span>${item.CommunityRating.toFixed(1)}</span>`);
    }
    return parts.map(part => `<span class="homeHero-metaItem">${part}</span>`).join('');
}

function getResumeTicks(item: BaseItemDto) {
    return item.Type !== 'Series' ? item.UserData?.PlaybackPositionTicks || 0 : 0;
}

function getFavouriteButtonHtml(item: BaseItemDto) {
    const isFavourite = !!item.UserData?.IsFavorite;
    const label = escapeHtml(globalize.translate(isFavourite ? 'Favorite' : 'AddToFavorites'));
    return `<button is="emby-button" type="button" class="homeHero-round${isFavourite ? ' is-on' : ''}" data-action="favourite" title="${label}" aria-label="${label}" aria-pressed="${isFavourite}"><span class="material-icons" aria-hidden="true">${isFavourite ? 'check' : 'add'}</span></button>`;
}

function getSlideContentHtml(item: BaseItemDto, apiClient: ApiClient) {
    const logoTag = item.ImageTags?.Logo;
    const title = escapeHtml(item.Name || '');
    let html = '';

    if (logoTag && item.Id) {
        const logoUrl = apiClient.getScaledImageUrl(item.Id, { type: 'Logo', maxWidth: 900, tag: logoTag });
        html += `<h1 class="homeHero-title homeHero-title-logo"><img class="homeHero-logo" src="${logoUrl}" alt="${title}" /></h1>`;
    } else {
        html += `<h1 class="homeHero-title">${title}</h1>`;
    }

    html += `<div class="homeHero-meta">${getMetaHtml(item)}</div>`;

    if (item.Overview) {
        html += `<p class="homeHero-overview">${escapeHtml(item.Overview)}</p>`;
    }

    const playLabel = globalize.translate(getResumeTicks(item) ? 'ButtonResume' : 'Play');
    const infoLabel = escapeHtml(globalize.translate('MoreInfo'));
    html += '<div class="homeHero-actions focuscontainer-x">';
    html += `<button is="emby-button" type="button" class="homeHero-play" data-action="play"><span class="material-icons" aria-hidden="true">play_arrow</span><span>${escapeHtml(playLabel)}</span></button>`;
    html += getFavouriteButtonHtml(item);
    html += `<button is="emby-button" type="button" class="homeHero-round" data-action="info" title="${infoLabel}" aria-label="${infoLabel}"><span class="material-icons" aria-hidden="true">info_outline</span></button>`;
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

/**
 * Renders an Apple TV style featured banner: rotating full-bleed artwork with
 * the title treatment, a one-line info row, a short synopsis and actions.
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

    const multiple = items.length > 1;
    let html = '<div class="homeHero-slides" aria-hidden="true">';
    items.forEach((item, index) => {
        html += `<div class="homeHero-slide${index === 0 ? ' is-active' : ''}" style="background-image:url('${getBackdropUrl(item, apiClient)}')"></div>`;
    });
    html += '</div>';
    html += '<div class="homeHero-scrim"></div>';
    html += '<div class="homeHero-content padded-left padded-right"></div>';
    if (multiple) {
        html += `<button type="button" class="homeHero-arrow homeHero-arrow-prev" data-step="-1" aria-label="${escapeHtml(globalize.translate('Previous'))}"><span class="material-icons" aria-hidden="true">chevron_left</span></button>`;
        html += `<button type="button" class="homeHero-arrow homeHero-arrow-next" data-step="1" aria-label="${escapeHtml(globalize.translate('Next'))}"><span class="material-icons" aria-hidden="true">chevron_right</span></button>`;
        html += '<div class="homeHero-dots" role="tablist">';
        items.forEach((item, index) => {
            html += `<button type="button" class="homeHero-dot${index === 0 ? ' is-active' : ''}" data-index="${index}" role="tab" aria-label="${escapeHtml(item.Name || '')}"></button>`;
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
    let holding = false;
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
    };

    const stop = () => {
        window.clearInterval(timer);
        timer = undefined;
    };

    const start = () => {
        stop();
        if (!multiple || paused || holding || document.hidden) return;
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

    const onVisibility = () => {
        if (document.hidden) {
            stop();
        } else {
            start();
        }
    };

    const toggleFavourite = async (item: BaseItemDto, button: HTMLElement) => {
        if (!item.Id) return;
        const next = !item.UserData?.IsFavorite;
        const userData = await apiClient.updateFavoriteStatus(apiClient.getCurrentUserId(), item.Id, next);
        item.UserData = { ...item.UserData, ...userData, IsFavorite: next };
        const icon = button.querySelector('.material-icons');
        if (icon) icon.textContent = next ? 'check' : 'add';
        button.classList.toggle('is-on', next);
        button.setAttribute('aria-pressed', String(next));
    };

    elem.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;

        const dot = target.closest<HTMLElement>('.homeHero-dot');
        if (dot) {
            show(Number(dot.dataset.index));
            start();
            return;
        }

        const arrow = target.closest<HTMLElement>('.homeHero-arrow');
        if (arrow) {
            show(current + Number(arrow.dataset.step));
            start();
            return;
        }

        const item = items[current];
        const actionButton = target.closest<HTMLElement>('[data-action]');
        switch (actionButton?.dataset.action) {
            case 'play':
                playbackManager.play({
                    items: [item],
                    startPositionTicks: getResumeTicks(item)
                }).catch((err: unknown) => console.error('[HomeHero] playback failed', err));
                break;
            case 'favourite':
                toggleFavourite(item, actionButton)
                    .catch((err: unknown) => console.error('[HomeHero] could not update favourite', err));
                break;
            case 'info':
                appRouter.showItem(item);
                break;
            default:
                if (target.closest('.homeHero-slides, .homeHero-title')) {
                    appRouter.showItem(item);
                }
        }
    });

    // Hold the current title while the pointer or keyboard focus is on the banner.
    const hold = () => {
        holding = true;
        stop();
    };
    const release = () => {
        holding = false;
        start();
    };
    elem.addEventListener('mouseenter', hold);
    elem.addEventListener('mouseleave', release);
    elem.addEventListener('focusin', hold);
    elem.addEventListener('focusout', release);

    const controller: HeroController = {
        pause() {
            paused = true;
            stop();
            window.removeEventListener('resize', fitUnderHeader);
            document.removeEventListener('visibilitychange', onVisibility);
        },
        resume() {
            paused = false;
            window.addEventListener('resize', fitUnderHeader);
            document.addEventListener('visibilitychange', onVisibility);
            fitUnderHeader();
            start();
        },
        destroy() {
            controller.pause();
            elem.heroController = undefined;
        }
    };
    elem.heroController = controller;

    show(0);
    controller.resume();
}
