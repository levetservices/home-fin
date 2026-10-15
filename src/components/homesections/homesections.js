import layoutManager from 'components/layoutManager';
import { getUserViewsQuery } from 'hooks/useUserViews';
import globalize from 'lib/globalize';
import { DEFAULT_SECTIONS, HomeSectionType } from 'types/homeSectionType';
import Dashboard from 'utils/dashboard';
import { toApi } from 'utils/jellyfin-apiclient/compat';
import { queryClient } from 'utils/query/queryClient';

import { loadRecordings } from './sections/activeRecordings';
import { loadLibraryButtons } from './sections/libraryButtons';
import { loadHeroBanner } from './sections/heroBanner';
import { loadLibraryTiles } from './sections/libraryTiles';
import { loadLiveTV } from './sections/liveTv';
import { loadNextUp } from './sections/nextUp';
import { loadRecentlyAdded } from './sections/recentlyAdded';
import { loadRecommendations } from './sections/recommendations';
import { loadResume } from './sections/resume';

import 'elements/emby-button/paper-icon-button-light';
import 'elements/emby-itemscontainer/emby-itemscontainer';
import 'elements/emby-scroller/emby-scroller';
import 'elements/emby-button/emby-button';

import './homesections.scss';

export function getDefaultSection(index) {
    if (index < 0 || index > DEFAULT_SECTIONS.length) return '';
    return DEFAULT_SECTIONS[index];
}

function getAllSectionsToShow(userSettings, sectionCount) {
    const sections = [];
    for (let i = 0, length = sectionCount; i < length; i++) {
        let section = userSettings.get('homesection' + i) || getDefaultSection(i);
        if (section === 'folders') {
            section = getDefaultSection(0);
        }

        sections.push(section);
    }

    // Ensure libraries are visible in TV layout
    if (
        layoutManager.tv
            && !sections.includes(HomeSectionType.SmallLibraryTiles)
            && !sections.includes(HomeSectionType.LibraryButtons)
    ) {
        return [
            HomeSectionType.SmallLibraryTiles,
            ...sections
        ];
    }

    return sections;
}

/**
 * The personalised rows go straight after "Continue Watching" / "Next Up",
 * or ahead of "Recently Added" when neither is shown.
 */
function getRecommendationsIndex(sections) {
    let anchor = -1;
    sections.forEach((section, i) => {
        if (section === HomeSectionType.Resume || section === HomeSectionType.NextUp) anchor = i;
    });
    if (anchor !== -1) return anchor + 1;

    const latest = sections.indexOf(HomeSectionType.LatestMedia);
    return latest !== -1 ? latest : sections.length;
}

export function loadSections(elem, apiClient, user, userSettings) {
    const userId = user.Id || apiClient.getCurrentUserId();
    return queryClient
        .fetchQuery(getUserViewsQuery(toApi(apiClient), userId))
        .then(result => result.Items || [])
        .then(function (userViews) {
            let html = '';

            if (userViews.length) {
                const userSectionCount = 10;
                // TV layout can have an extra section to ensure libraries are visible
                const totalSectionCount = layoutManager.tv ? userSectionCount + 1 : userSectionCount;
                const sections = getAllSectionsToShow(userSettings, userSectionCount);
                const recommendationsIndex = getRecommendationsIndex(sections);

                html += '<div class="homeHero hide"></div>';
                for (let i = 0; i < totalSectionCount; i++) {
                    if (i === recommendationsIndex) {
                        html += '<div class="homeRecommendations"></div>';
                    }
                    html += '<div class="verticalSection section' + i + '"></div>';
                }
                if (recommendationsIndex >= totalSectionCount) {
                    html += '<div class="homeRecommendations"></div>';
                }

                elem.innerHTML = html;
                elem.classList.add('homeSectionsContainer');

                loadHeroBanner(elem.querySelector('.homeHero'), apiClient);
                loadRecommendations(elem.querySelector('.homeRecommendations'), apiClient, { enableOverflow: enableScrollX() })
                    .catch(err => console.error('[HomeRecommendations] failed to load', err));

                const promises = [];
                for (let i = 0; i < sections.length; i++) {
                    promises.push(loadSection(elem, apiClient, user, userSettings, userViews, sections, i));
                }

                return Promise.all(promises)
                // Timeout for polyfilled CustomElements (webOS 1.2)
                    .then(() => new Promise((resolve) => setTimeout(resolve, 0)))
                    .then(() => {
                        return resume(elem, {
                            refresh: true
                        });
                    });
            } else {
                let noLibDescription;
                if (user.Policy?.IsAdministrator) {
                    noLibDescription = globalize.translate('NoCreatedLibraries', '<br><a id="button-createLibrary" class="button-link">', '</a>');
                } else {
                    noLibDescription = globalize.translate('AskAdminToCreateLibrary');
                }

                html += '<div class="centerMessage padded-left padded-right">';
                html += '<h2>' + globalize.translate('MessageNothingHere') + '</h2>';
                html += '<p>' + noLibDescription + '</p>';
                html += '</div>';
                elem.innerHTML = html;

                const createNowLink = elem.querySelector('#button-createLibrary');
                if (createNowLink) {
                    createNowLink.addEventListener('click', function () {
                        Dashboard.navigate('dashboard/libraries');
                    });
                }
            }
        });
}

export function destroySections(elem) {
    elem.querySelector('.homeHero')?.heroController?.destroy();

    const elems = elem.querySelectorAll('.itemsContainer');
    for (const e of elems) {
        e.fetchData = null;
        e.parentContainer = null;
        e.getItemsHtml = null;
    }

    elem.innerHTML = '';
}

export function pause(elem) {
    elem.querySelector('.homeHero')?.heroController?.pause();

    const elems = elem.querySelectorAll('.itemsContainer');
    for (const e of elems) {
        e.pause();
    }
}

export function resume(elem, options) {
    elem.querySelector('.homeHero')?.heroController?.resume();

    const elems = elem.querySelectorAll('.itemsContainer');
    const promises = [];

    Array.prototype.forEach.call(elems, section => {
        if (section.resume) {
            promises.push(section.resume(options));
        }
    });

    return Promise.all(promises);
}

function loadSection(page, apiClient, user, userSettings, userViews, allSections, index) {
    const section = allSections[index];
    const elem = page.querySelector('.section' + index);
    const options = { enableOverflow: enableScrollX() };

    switch (section) {
        case HomeSectionType.ActiveRecordings:
            loadRecordings(elem, true, apiClient, options);
            break;
        case HomeSectionType.LatestMedia:
            loadRecentlyAdded(elem, apiClient, user, userViews, options);
            break;
        case HomeSectionType.LibraryButtons:
            loadLibraryButtons(elem, userViews);
            break;
        case HomeSectionType.LiveTv:
            return loadLiveTV(elem, apiClient, user, options);
        case HomeSectionType.NextUp:
            loadNextUp(elem, apiClient, userSettings, options);
            break;
        case HomeSectionType.Resume:
            return loadResume(elem, apiClient, 'HeaderContinueWatching', 'Video', userSettings, options);
        case HomeSectionType.ResumeAudio:
            return loadResume(elem, apiClient, 'HeaderContinueListening', 'Audio', userSettings, options);
        case HomeSectionType.ResumeBook:
            return loadResume(elem, apiClient, 'HeaderContinueReading', 'Book', userSettings, options);
        case HomeSectionType.SmallLibraryTiles:
            loadLibraryTiles(elem, userViews, options);
            break;
        default:
            elem.innerHTML = '';
    }

    return Promise.resolve();
}

function enableScrollX() {
    return true;
}

export default {
    getDefaultSection,
    loadSections,
    destroySections,
    pause,
    resume
};

