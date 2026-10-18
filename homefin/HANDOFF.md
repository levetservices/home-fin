# Home Fin — handoff notes (work in progress)

Repo: `levetservices/home-fin`, branch **`home-fin`** (fork of jellyfin-web,
based on `release-10.11.z`, version 10.11.11). Never push to `master`.
Read `homefin/SPEC.md` first: it is the design for everything below.

## What the owner asked for (latest request)

1. **Refine the Netflix look** to match current netflix.com (they shared
   screenshots — details in "Visual targets" below).
2. **A recommendation system that works like Netflix's** (SPEC §7).
3. **Accounts with profiles inside them**: create accounts, then profiles that
   only that account can open; adding people must be easy (SPEC §1–6).

## Done and pushed

* Cinema (Netflix) theme `src/themes/cinema/theme.scss` (default), Glass theme
  kept. Header text nav (`src/scripts/libraryMenu.js` → `renderHeaderNav`,
  `src/styles/headerNav.scss`). Billboard `src/components/homesections/sections/heroBanner.{ts,scss}`.
  Netflix rows/cards/Top 10/hover preview in `src/components/homesections/rows/`
  (`mediaRow.ts`, `artwork.ts`, `hoverPreview.ts`, `homeRows.ts`, `rows.scss`).
  Interim recommendations in `src/components/homesections/sections/recommendations.ts`.
* **Accounts service** `homefin/accounts/` — complete, 15 passing tests
  (`cd homefin/accounts && npm test`), verified against a real Jellyfin 10.11.11.
  Zero npm deps, Node ≥ 22.5 (`node:sqlite`). README covers deployment.

## In progress (this commit) — web client for accounts

Written and type-checking, **not yet wired up or styled**:

* `src/types/webConfig.ts` (`homefinAccounts`), `src/config.json`
  (`homefinAccounts.enabled: false` by default), `getHomefinAccounts()` in
  `src/scripts/settings/webSettings.js`.
* `src/homefin/accounts/api.ts` (service client), `session.ts`
  (`activateProfile`, `leaveProfile`, `signOutEverywhere`, `getDisplayName`),
  `avatar.tsx`, `components.tsx` (Screen, useMe, Field, PinPad, AvatarPicker,
  ProfileEditor), `accounts.scss` (**placeholder only**).
* Pages (React, default exports): `src/apps/stable/routes/homefin/{login,join,profiles,manage,account,admin}/index.tsx`.

### Remaining for accounts

1. **Routes**: add to `src/apps/stable/routes/asyncRoutes/public.ts`:
   `homefin/login`→`homefin/login`, `homefin/join`, `homefin/profiles`,
   `homefin/profiles/manage`→`homefin/manage`, `homefin/account`, `homefin/admin`.
   Add the same paths to `PUBLIC_PATHS` in `src/components/router/appRouter.js`.
   (Public = no Jellyfin session needed; the service enforces its own auth.)
2. **Redirects**: in `src/components/ConnectionRequired.tsx` `bounce()`, for
   `ConnectionState.ServerSignIn` (and `ServerSelection` when a server is
   known) navigate to `/homefin/profiles` when `homefinAccounts.enabled`
   (use `isAccountsEnabled()` from `homefin/accounts/api`). Keep Jellyfin's
   login reachable at `/login?classic=1` (skip the redirect when `classic=1`).
3. **Sign out**: `logout()` in `src/utils/dashboard.js` → when enabled call
   `signOutEverywhere()` instead.
4. **Header profile menu** (`src/scripts/libraryMenu.js`
   `onHeaderUserButtonClick` / `updateHeaderUserButton`): when enabled, show
   the current profile's avatar (`getCurrentProfile()` + `getAvatars()` +
   `avatarHtml()`) and open a Netflix-style dropdown: other profiles (switch via
   `activateProfile`, PIN pad if locked → route to `/homefin/profiles` for
   locked ones is fine), *Manage Profiles*, *Account*, *Sign in a TV*
   (`#/quickconnect`), *Settings* (`mypreferencesmenu`), divider,
   *Sign out of Home Fin*. Close on outside click / Esc.
5. Use `getDisplayName(user)` wherever the UI shows the Jellyfin user's name
   for Home Fin profiles (Jellyfin names are `hf-xxxxxxxx`), e.g. "Continue
   Watching for …" in `src/components/homesections/rows/homeRows.ts`.
6. **Styles** in `src/homefin/accounts/accounts.scss` (class names are in the
   TSX). Targets: sign-in card like netflix.com/login (rgba(0,0,0,.75) card,
   48px/68px padding, max-width 450px, inputs with floating labels, red button);
   **Who's watching?** like the owner's screenshot: dark red radial background
   (`radial-gradient(ellipse at 50% 0%, #4b0d14, #1a0306 55%, #0b0102)`),
   wordmark top-left, centred title ~3.5vw, square avatars (~10vw, min 84px,
   10% radius) with emoji centred (`.hfAvatar` → container-type inline-size,
   emoji ~58cqw), grey names turning white with a white outline on hover,
   "Add Profile" tile, outlined pill "Manage Profiles" button with pencil icon;
   PIN overlay full-screen black with four 3em boxes; editor centred ~46em,
   avatar left/fields right, sections separated by #333 lines; account/admin
   panels on #181818 with 10px radius; tables, chips, tags.
7. **Webpack dev proxy**: in `webpack.dev.js` `devServer.proxy` send
   `/homefin-api` → `http://127.0.0.1:8097`.
8. **Lint**: the new TSX fails the repo's ESLint rules — mostly
   `react/jsx-no-bind` (no inline arrow functions in JSX props: use
   `useCallback` handlers, passing ids via `data-*` attributes), `no-void`,
   and `compat/compat` for `navigator.clipboard` (guard it, fall back to
   selecting the text). Run `npx eslint src/homefin src/apps/stable/routes/homefin`
   until clean. `npx tsc --noEmit` already passes.
9. Small fixes noted while writing:
   * PinPad only clears on a *changed* error string — reset the error to `''`
     before each verify attempt in `profiles/index.tsx` (`open`) and
     `manage/index.tsx` (`unlock`).
   * Service: add "Forgot PIN?" → allow `accountPassword` instead of
     `currentPin` in `PATCH /profiles/:id` and `DELETE` (with a test).

## Not started

### Visual targets (from the owner's netflix.com screenshots)

* Header: solid #141414 bar; nav items as text, **active item in a grey pill**
  (`rgba(255,255,255,.15)`, ~999px radius); right side: search, bell, a
  "Kids" profile shortcut, then the profile avatar (rounded square) + caret.
* **Billboard is an inset rounded card** (≈16px radius) with page-gutter
  margins under the header, not full-bleed. Big logo, meta line
  `Series • Action • 2017 • 5 Seasons • (15)` in bold white with bullets, the
  age rating as a **coloured circle** (BBFC: U green, PG yellow, 12/12A orange,
  15 pink #e5007d-ish, 18 red; map US ratings similarly), synopsis, **pill
  buttons** (Play white w/ black icon, More Info translucent grey), and
  **reason tags bottom-right** ("👍 We think you'll love this!",
  "🎬 Starring David Boreanaz") from the recommender.
* Cards: ≈10px radius, slightly larger (≈5.2 per row), title logo on art,
  small red **"TOP 10" badge** top-left for items in the Top 10, red ribbons
  bottom-centre: "Recently Added" (added ≤ 14 days), "New Season" / "New
  Episodes" (series with recent `DateLastMediaAdded`).
* Top 10 row: big dark numbers with a thin grey outline, poster rounded.
* Row titles larger (≈1.6em), e.g. "Critically Acclaimed Witty Series".

### More Info pop-up (Netflix detail modal)

Opened by the billboard's More Info, card clicks and the hover preview's
chevron instead of navigating away. Centred ~850px (max 92vw) dark #181818
modal, 8px radius, page dimmed; 16:9 art with logo, Play (white rect),
+ (My List), thumbs, close ✕. Below: left column year · seasons · HD badge,
rating circle + descriptors, overview; right column Cast, Genres, "This
series is: …" (tags). Then **Episodes** with a season dropdown (episode
number, still, title, runtime, synopsis, progress; click plays), **More Like
This** grid (Jellyfin `/Items/{id}/Similar`, cards with art, year, rating
circle, +, synopsis), and **About {title}**. Esc / backdrop closes. Keep a
"Full details" link to Jellyfin's item page.

### Recommendation engine (SPEC §7)

Client-side module under `src/homefin/recs/` per SPEC: taste profile with
45-day half-life from played/partial/rewatch/favourite/likes; candidate
scoring (taste 0.55, quality 0.20, freshness 0.10, household 0.10, daily-stable
exploration 0.05); rows in SPEC order (Top Picks for {name}, Top 10 on Home Fin
Today from `GET /homefin-api/trending` when accounts are enabled else rating
fallback, Because you watched ×2, mood+genre rows ×3, My List, New on Home
Fin, Starring {actor}, Watch It Again); billboard pick + reason tags; thumbs
down = `Likes=false` hides a title. Cache the taste profile in sessionStorage
(30 min). Replace `sections/recommendations.ts` with it.

## How to test locally (what the previous session did)

* `npm ci` fails behind some proxies on the GitHub tarball for `classlist.js`:
  clone `https://github.com/eligrey/classList.js` at tag `1.2.20180112`,
  `npm pack` it, temporarily point package.json + package-lock.json at the
  local `file:` tarball (drop its `integrity`), `npm ci`, then
  `git checkout package.json package-lock.json`. Don't commit that change.
* Test server: download Jellyfin 10.11.11
  (`https://repo.jellyfin.org/files/server/linux/stable/v10.11.11/amd64/jellyfin_10.11.11-amd64.tar.gz`,
  follow redirects), run with `--datadir/--configdir/--cachedir/--logdir` in a
  scratch dir and `--ffmpeg /usr/bin/ffmpeg`, finish the wizard via
  `/Startup/*`, add Movies + Shows libraries. Generate fake media with ffmpeg +
  PIL (poster.jpg / backdrop.jpg / logo.png + movie.nfo / tvshow.nfo per
  title) so logos and backdrops exist.
* Create an API key: `POST /Auth/Keys?app=HomeFin` with an admin token, read it
  from `GET /Auth/Keys`. Run the service with `JELLYFIN_URL`,
  `JELLYFIN_API_KEY`, `HOMEFIN_SECRET=$(openssl rand -base64 32)`,
  `HOMEFIN_ADMIN_EMAIL/PASSWORD`.
* `npm run serve -- --port 8081` (first build ~1–5 min); screenshot with the
  preinstalled Playwright (`/opt/node-tools/node_modules/playwright`,
  Chromium at `/opt/pw-browsers`). For a signed-in session seed localStorage
  `jellyfin_credentials` with `{Servers:[{ManualAddress, Id, Name, AccessToken,
  UserId, DateLastAccessed, LastConnectionMode:2}]}`; for the accounts flow
  seed the server without `AccessToken`, set `homefinAccounts.enabled: true`
  locally (don't commit `true`).
* Checks before pushing: `npx tsc --noEmit`, `npx eslint <changed paths>`,
  `npx stylelint <changed scss>`, `cd homefin/accounts && npm test`.
