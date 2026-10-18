import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { ApiClient } from 'jellyfin-apiclient';

/** Image types every row query should ask for so cards can pick the best art. */
export const ROW_IMAGE_TYPES = 'Primary,Backdrop,Thumb,Logo';
/** Fields the cards and hover previews read. */
export const ROW_FIELDS = 'Overview,Genres,ProductionYear,OfficialRating,CommunityRating,RunTimeTicks,ChildCount,PrimaryImageAspectRatio,MediaSourceCount,DateCreated';

export interface CardArt {
    url: string
    /** True when the image already carries the title (e.g. a "Thumb" with a logo). */
    titleInArt: boolean
    logoUrl: string
    title: string
}

interface ArtOptions {
    width: number
    useEpisodeImages?: boolean
}

// Image sizes. Every distinct size is a separate resize on the server (slow the first time on a
// small machine), so Home Fin asks for a handful of fixed sizes and reuses them everywhere.

/** Visually the same as Jellyfin's 90 at noticeably smaller files. */
export const IMAGE_QUALITY = 80;
const HIGH_DENSITY = (window.devicePixelRatio || 1) > 1.5;
/** Card-sized art: cards, hover previews, pop-up grids and episode stills, the bell. */
export const CARD_IMAGE_WIDTH = HIGH_DENSITY ? 640 : 400;
/** Title treatments (logos) on cards and in the pop-up. */
export const LOGO_IMAGE_WIDTH = HIGH_DENSITY ? 450 : 300;

/** Full-width artwork in fixed steps, rather than the exact window width (which defeats caching). */
export function wideImageWidth() {
    const pixels = window.innerWidth * (window.devicePixelRatio || 1);
    return [1280, 1920, 2560].find(width => width >= pixels) ?? 2560;
}

export function scaledImageUrl(apiClient: ApiClient, id: string | null | undefined, type: string, tag: string | null | undefined, maxWidth: number) {
    if (!id || !tag) return '';
    return apiClient.getScaledImageUrl(id, { type, maxWidth, tag, quality: IMAGE_QUALITY });
}

const scaled = scaledImageUrl;

function getLogoUrl(item: BaseItemDto, apiClient: ApiClient) {
    if (item.ImageTags?.Logo) return scaled(apiClient, item.Id, 'Logo', item.ImageTags.Logo, LOGO_IMAGE_WIDTH);
    return scaled(apiClient, item.ParentLogoItemId, 'Logo', item.ParentLogoImageTag, LOGO_IMAGE_WIDTH);
}

/** The display title: shows for episodes, otherwise the item itself. */
export function getDisplayTitle(item: BaseItemDto) {
    return (item.Type === 'Episode' ? item.SeriesName : item.Name) || item.Name || '';
}

/**
 * Pick 16:9 art for a card. Order follows how Netflix-style "boxart" is usually
 * available in Jellyfin libraries: Thumb (title baked in) → Backdrop + logo →
 * the parent show's art → the item's own still.
 */
export function getCardArt(item: BaseItemDto, apiClient: ApiClient, { width, useEpisodeImages }: ArtOptions): CardArt {
    const title = getDisplayTitle(item);
    const logoUrl = getLogoUrl(item, apiClient);
    const make = (url: string, titleInArt: boolean): CardArt => ({ url, titleInArt, logoUrl, title });

    const isEpisode = item.Type === 'Episode';
    if (isEpisode && useEpisodeImages && item.ImageTags?.Primary) {
        return make(scaled(apiClient, item.Id, 'Primary', item.ImageTags.Primary, width), false);
    }

    if (item.ImageTags?.Thumb) {
        return make(scaled(apiClient, item.Id, 'Thumb', item.ImageTags.Thumb, width), true);
    }
    if (item.BackdropImageTags?.length) {
        return make(scaled(apiClient, item.Id, 'Backdrop', item.BackdropImageTags[0], width), false);
    }
    if (item.ParentThumbItemId && item.ParentThumbImageTag) {
        return make(scaled(apiClient, item.ParentThumbItemId, 'Thumb', item.ParentThumbImageTag, width), true);
    }
    if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.length) {
        return make(scaled(apiClient, item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags[0], width), false);
    }
    if (item.ImageTags?.Primary) {
        return make(scaled(apiClient, item.Id, 'Primary', item.ImageTags.Primary, width), false);
    }
    return make('', false);
}

/** Portrait poster (for Top 10). */
export function getPosterUrl(item: BaseItemDto, apiClient: ApiClient, width: number) {
    return scaled(apiClient, item.Id, 'Primary', item.ImageTags?.Primary, width);
}

export function getProgressPercent(item: BaseItemDto) {
    const percent = item.UserData?.PlayedPercentage;
    return percent && percent > 0 && percent < 100 ? Math.round(percent) : 0;
}

export function formatRuntime(ticks?: number | null) {
    if (!ticks) return '';
    // Never "0m": very short clips round up to a minute.
    const minutes = Math.max(1, Math.round(ticks / 600000000));
    const hours = Math.floor(minutes / 60);
    return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/** Ticks still to watch, e.g. "32m left" style figures. */
export function getRemainingTicks(item: BaseItemDto) {
    const total = item.RunTimeTicks || 0;
    const position = item.UserData?.PlaybackPositionTicks || 0;
    return total > position ? total - position : 0;
}
