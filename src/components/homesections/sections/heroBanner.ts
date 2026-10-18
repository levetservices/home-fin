import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import escapeHtml from 'escape-html';
import type { ApiClient } from 'jellyfin-apiclient';

import layoutManager from 'components/layoutManager';
import { playbackManager } from 'components/playback/playbackmanager';
import { openMoreInfo } from 'homefin/moreInfo/moreInfo';
import { ratingBadgeHtml } from 'homefin/ui/rating';
import globalize from 'lib/globalize';

import { LOGO_IMAGE_WIDTH, formatRuntime, scaledImageUrl, wideImageWidth } from '../rows/artwork';

import './heroBanner.scss';

/** Space between the header bar and the billboard card. */
const HEADER_GAP_PX = 10;
/** Candidates fetched so a title with a logo (title treatment) can be preferred. */
const CANDIDATE_COUNT = 12;

/** The title to feature and why ("We think you'll love this!", "Starring …"). */
export interface FeaturedTitle {
    item: BaseItemDto
    reasons: string[]
}

export interface HeroController {
    pause: () => void
    resume: () => void
    destroy: () => void
}

export type HeroElement = HTMLElement & { heroController?: HeroController };

export const HERO_FIELDS = 'Overview,Genres,ProductionYear,OfficialRating,CommunityRating,RunTimeTicks,ChildCount';

const ITEM_QUERY = {
    IncludeItemTypes: 'Movie,Series',
    Recursive: true,
    SortBy: 'Random',
    ImageTypes: 'Backdrop',
    HasOverview: true,
    Fields: HERO_FIELDS,
    EnableImageTypes: 'Backdrop,Logo',
    ImageTypeLimit: 1,
    EnableTotalRecordCount: false,
    Limit: CANDIDATE_COUNT
};

/** Without a recommendation: a random unwatched title, preferring ones with a logo. */
async function fetchFallbackTitle(apiClient: ApiClient): Promise<FeaturedTitle | null> {
    const userId = apiClient.getCurrentUserId();
    const unplayed = await apiClient.getItems(userId, { ...ITEM_QUERY, IsPlayed: false });
    let candidates = unplayed.Items || [];
    if (!candidates.length) candidates = (await apiClient.getItems(userId, ITEM_QUERY)).Items || [];
    const item = candidates.find(c => c.ImageTags?.Logo) || candidates[0];
    return item ? { item, reasons: [] } : null;
}

/** Netflix's info line: "Series • Action • 2017 • 5 Seasons • (15)". */
function getMetaHtml(item: BaseItemDto) {
    const parts: string[] = [item.Type === 'Series' ? 'Series' : 'Film'];
    if (item.Genres?.length) parts.push(escapeHtml(item.Genres[0]));
    if (item.ProductionYear) parts.push(String(item.ProductionYear));
    if (item.Type === 'Series') {
        if (item.ChildCount) parts.push(escapeHtml(globalize.translate(item.ChildCount === 1 ? 'ValueOneSeason' : 'ValueSeasonCount', item.ChildCount)));
    } else {
        const runtime = formatRuntime(item.RunTimeTicks);
        if (runtime) parts.push(runtime);
    }
    const rating = ratingBadgeHtml(item.OfficialRating);
    if (rating) parts.push(rating);
    return parts.map(part => `<span class="homeHero-metaItem">${part}</span>`).join('');
}

function getResumeTicks(item: BaseItemDto) {
    return item.Type !== 'Series' ? item.UserData?.PlaybackPositionTicks || 0 : 0;
}

function getReasonsHtml(reasons: string[]) {
    if (!reasons.length) return '';
    return '<ul class="homeHero-reasons">' + reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('') + '</ul>';
}

function getContentHtml({ item, reasons }: FeaturedTitle, apiClient: ApiClient) {
    const logoTag = item.ImageTags?.Logo;
    const title = escapeHtml(item.Name || '');
    let html = '<div class="homeHero-content">';

    if (logoTag && item.Id) {
        const logoUrl = scaledImageUrl(apiClient, item.Id, 'Logo', logoTag, LOGO_IMAGE_WIDTH * 2);
        html += `<h1 class="homeHero-title homeHero-title-logo"><img class="homeHero-logo" src="${logoUrl}" alt="${title}" /></h1>`;
    } else {
        html += `<h1 class="homeHero-title">${title}</h1>`;
    }

    html += `<div class="homeHero-meta">${getMetaHtml(item)}</div>`;

    if (item.Overview) {
        html += `<p class="homeHero-overview">${escapeHtml(item.Overview)}</p>`;
    }

    const playLabel = globalize.translate(getResumeTicks(item) ? 'ButtonResume' : 'Play');
    html += '<div class="homeHero-actions focuscontainer-x">';
    html += `<button is="emby-button" type="button" class="homeHero-play" data-action="play"><span class="material-icons" aria-hidden="true">play_arrow</span><span>${escapeHtml(playLabel)}</span></button>`;
    html += `<button is="emby-button" type="button" class="homeHero-info" data-action="info"><span class="material-icons" aria-hidden="true">info_outline</span><span>${escapeHtml(globalize.translate('MoreInfo'))}</span></button>`;
    html += '</div>';
    html += '</div>';
    html += getReasonsHtml(reasons);
    return html;
}

function getBackdropUrl(item: BaseItemDto, apiClient: ApiClient) {
    return scaledImageUrl(apiClient, item.Id, 'Backdrop', item.BackdropImageTags?.[0], wideImageWidth());
}

/**
 * Renders Netflix's billboard: an inset rounded card with the featured title's
 * artwork, title treatment, info line, synopsis, actions and why it was picked.
 * `featured` comes from the recommender; without one a random unwatched title is shown.
 */
/** Sit just under the header whatever padding the page reserves for tab rows Home doesn't show. */
function fitUnderHeader(elem: HTMLElement) {
    elem.style.marginTop = '';
    const header = document.querySelector('.skinHeader');
    if (layoutManager.tv || !header || !elem.offsetParent) return;
    const top = elem.getBoundingClientRect().top + window.scrollY;
    const wanted = header.getBoundingClientRect().bottom + HEADER_GAP_PX;
    const current = parseFloat(getComputedStyle(elem).marginTop) || 0;
    elem.style.marginTop = `${current + wanted - top}px`;
}

export async function loadHeroBanner(elem: HeroElement, apiClient: ApiClient, featured?: Promise<FeaturedTitle | null>) {
    // Hold the billboard's place while the recommender works, so the rows don't jump down later.
    elem.classList.remove('hide');
    elem.classList.add('homeHero', 'is-loading');
    fitUnderHeader(elem);

    let pick: FeaturedTitle | null = null;
    try {
        pick = (await featured) || await fetchFallbackTitle(apiClient);
    } catch (err) {
        console.error('[HomeHero] failed to load the featured title', err);
    }

    elem.classList.remove('is-loading');
    if (!pick || !elem.isConnected) {
        elem.innerHTML = '';
        elem.classList.add('hide');
        return;
    }

    const { item } = pick;
    let html = `<div class="homeHero-art" style="background-image:url('${getBackdropUrl(item, apiClient)}')" aria-hidden="true"></div>`;
    html += '<div class="homeHero-scrim"></div>';
    html += getContentHtml(pick, apiClient);

    elem.classList.remove('hide');
    elem.classList.add('homeHero');
    elem.innerHTML = html;
    elem.querySelector('.homeHero-content')?.classList.add('is-entering');

    elem.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        switch (target.closest<HTMLElement>('[data-action]')?.dataset.action) {
            case 'play':
                playbackManager.play({
                    items: [item],
                    startPositionTicks: getResumeTicks(item)
                }).catch((err: unknown) => console.error('[HomeHero] playback failed', err));
                break;
            case 'info':
                openMoreInfo(item, apiClient);
                break;
            default:
                if (target.closest('.homeHero-art, .homeHero-title')) openMoreInfo(item, apiClient);
        }
    });

    const onResize = () => fitUnderHeader(elem);

    const controller: HeroController = {
        pause() {
            window.removeEventListener('resize', onResize);
        },
        resume() {
            window.addEventListener('resize', onResize);
            onResize();
        },
        destroy() {
            controller.pause();
            elem.heroController = undefined;
        }
    };
    elem.heroController = controller;
    controller.resume();
}
