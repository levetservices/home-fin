# Home Fin — handoff notes

Repo: `levetservices/home-fin`, branch **`home-fin`** (fork of jellyfin-web,
based on `release-10.11.z`, version 10.11.11). Never push to `master`.
`homefin/SPEC.md` is the design; this file is the current state.

## What the owner asked for

1. Refine the Netflix look to match current netflix.com.
2. A recommendation system that works like Netflix's (SPEC §7).
3. Accounts with profiles inside them, only openable by that account, and an
   easy way to add people (SPEC §1–6).

All three are built, pushed and checked in a real browser against Jellyfin
10.11.11 plus the accounts service (see "How it was tested").

## Where things live

| Area | Files |
|---|---|
| Accounts service | `homefin/accounts/` (Node ≥ 22.5, zero deps, `npm test` = 16 tests). README = deployment. |
| Account pages | `src/apps/stable/routes/homefin/{login,join,profiles,manage,account,admin}/index.tsx`, shared bits in `src/homefin/accounts/` (`api.ts`, `session.ts`, `components.tsx`, `ProfileTile.tsx`, `accounts.scss`) |
| Routing / sign-in redirect | `src/apps/stable/routes/asyncRoutes/public.ts`, `PUBLIC_PATHS` in `src/components/router/appRouter.js` (+ `showLocalLogin`), `bounce()` in `src/components/ConnectionRequired.tsx`, `logout()` in `src/utils/dashboard.js` |
| Header | `src/scripts/libraryMenu.js` → profile menu `src/homefin/accounts/profileMenu.{ts,scss}`, bell `src/homefin/ui/notifications.{ts,scss}`; pill nav in `src/themes/cinema/theme.scss` |
| Billboard | `src/components/homesections/sections/heroBanner.{ts,scss}` |
| Rows / cards / hover | `src/components/homesections/rows/` (`mediaRow.ts`, `hoverPreview.ts`, `homeRows.ts`, `rows.scss`) |
| Badges, ratings, play | `src/homefin/ui/badges.ts` (TOP 10 + ribbons), `rating.ts` (BBFC colour circles), `play.ts` (series play = next episode) |
| More Info pop-up | `src/homefin/moreInfo/moreInfo.{ts,scss}` |
| Recommender | `src/homefin/recs/` — `features.ts`, `taste.ts`, `score.ts`, `plan.ts` (pure, unit-tested in `recs.test.ts`), `index.ts` (Jellyfin / service I/O, caches). Rendered by `sections/recommendations.ts`, wired in `homesections.js`. |

## Behaviour worth knowing

* **Accounts are off by default.** `src/config.json` ships
  `homefinAccounts.enabled: false`; keep it that way in the repo. When on,
  a browser with no Jellyfin session goes to *Who's watching?* (which sends
  signed-out visitors to the Home Fin sign-in). Jellyfin's own login stays at
  `#/login?classic=1` (the sign-in page links to it with the server id).
* **Forgot PIN?** on a PIN screen → account password → edit / remove the PIN
  (service accepts `accountPassword` in place of `currentPin`).
* **Recommender**: taste profile from the last 300 plays, part-watched,
  My List and thumbs, 45-day half-life, cached in sessionStorage for 30 min
  (`homefin_taste_v1_<userId>`; thumbs up/down clear it). A thumbs-down only
  counts against genre / cast / director / tags, never against "films from
  the 2020s". Rows follow SPEC §7.3; Top 10 and My List may repeat titles,
  every other row keeps a title to two appearances. On small libraries Top
  Picks takes at most half the candidates so later rows aren't starved.
* **Household Top 10** comes from `GET /homefin-api/trending` and only when
  the browser is on a Home Fin profile; otherwise it falls back to the best
  rated ("Top 10 on Home Fin").
* **More Like This** = Jellyfin's `/Similar`, topped up by feature similarity
  (Jellyfin returned nothing on the test library).
* Card clicks open More Info, except part-watched cards, which carry on
  playing. Episodes / seasons open their series.
* Home's default section order now puts library tiles ("My Media") last;
  people who set their own order keep it.

## Security review (done after the build)

Checked: scrypt hashing, hashed session tokens in an HttpOnly SameSite cookie,
JSON + Origin CSRF checks, AES-GCM profile passwords, the account boundary,
escaping in every new HTML template, and the Kids profile's rating filter
(live: 5 of 20 titles visible). Fixed:

* Disabling an account, an admin password reset, or a member changing their
  password now signs every device out of that account's profiles (Jellyfin
  users disabled / passwords rotated). Verified against real Jellyfin.
* Sign-in limits no longer lock the whole household out behind a tunnel:
  `TRUST_PROXY=true` makes limits per visitor, and limits are split per
  address + email / address / email. Without it, visitors' forwarding headers
  aren't passed on to Jellyfin.

Left as known trade-offs: the household Top 10 counts viewing across all
accounts (fine for one family, can hint at what someone watched if friends
are invited); an invite made "for" an email isn't tied to it (the link is
the secret).

## How it was tested (and how to repeat it)

* `npm ci` can fail behind proxies that block the GitHub tarball for
  `classlist.js`. Work-around used: clone `eligrey/classList.js` at tag
  `1.2.20180112`, `npm pack` it, copy `package.json` + `package-lock.json` to a
  scratch folder, point `classlist.js` at the local `file:` tarball there (drop
  its `integrity`), `npm ci --ignore-scripts` in the scratch folder and move
  `node_modules` into the repo. The repo's own package files stay untouched.
* Test server: Jellyfin 10.11.11 tarball, run with its own
  `--datadir/--configdir/--cachedir/--logdir` and `--ffmpeg /usr/bin/ffmpeg`,
  wizard via `/Startup/*`, Movies + Shows libraries of generated media
  (ffmpeg clips + PIL posters / backdrops / logos + NFOs, metadata fetchers
  off). API key via `POST /Auth/Keys?app=HomeFin`. Accounts service with
  `JELLYFIN_URL`, `JELLYFIN_API_KEY`, `HOMEFIN_SECRET`, `HOMEFIN_ADMIN_*`.
* `npm run serve -- --port 8081`; Playwright (`/opt/node-tools/node_modules/playwright`,
  Chromium `/opt/pw-browsers/chromium`). Accounts were switched on per test by
  intercepting `config.json` in Playwright, not by editing it. Signed-in
  sessions without accounts: seed localStorage `jellyfin_credentials` with
  the server, `AccessToken` and `UserId`.
* Flows checked in the browser: sign-in (+ wrong password), first profile,
  Who's watching?, Manage Profiles, edit + avatar picker, PIN pad (wrong PIN,
  Forgot PIN?), opening a profile, header profile menu, Kids shortcut, bell,
  account page, admin (invite link → join in a fresh browser → home), sign
  out, classic Jellyfin login, home rows for a profile with history and one
  without, household Top 10, hover preview, More Info (film and series,
  season picker, More Like This), playing an episode from More Info, Esc to
  close, phone width (390px), and Home + More Info under the Glass theme.
* Checks before each push: `npx tsc --noEmit`, `npx eslint` and
  `npx stylelint` on changed files, `npm test` in `homefin/accounts`, and the
  root `npm test` (vitest; now excludes `homefin/**`, whose `node:test` suite
  runs separately). `npm run build:production` also compiles cleanly
  (only webpack's usual asset-size warnings).

## Not done / not verified

* **Not tested on real devices or a TV.** Phone width was checked in desktop
  Chromium only; Jellyfin's TV layout (`layoutManager.tv`) and *Sign in a TV*
  with a real Quick Connect code were not exercised.
* Test media was synthetic (10-second clips, so runtimes show "1m"; every
  title "Recently Added"). Real libraries with TMDb art should look closer to
  netflix.com.
* Not built: autoplaying billboard / hover trailers, a separate Kids home
  screen, HD / 4K badges for series (films only), content descriptors next to
  the rating circle (Jellyfin has no such data).
* Known stock jellyfin-web quirk, not from this work: with the desktop layout
  forced at phone width, the "My Media" tiles scroller overflows the page
  (Jellyfin's JS scroller). Real phones get the mobile layout.
