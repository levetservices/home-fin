# Home Fin — Accounts, Profiles and Recommendations

Status: v1, implemented in this repository.
Scope: the Home Fin web client (this fork of jellyfin-web 10.11) plus a small
companion service, `homefin/accounts`, that runs next to Jellyfin.

---

## 1. Goals

1. **Netflix-style accounts.** One sign-in (email + password) per household or
   person. Inside it, up to five **profiles** ("Dad", "Alana", "Kids") with no
   password of their own, each with its own watch history, My List and
   recommendations.
2. **Profiles are private to their account.** Nobody can open, list or switch to
   a profile that belongs to another account, and profiles never appear on
   Jellyfin's own login screen.
3. **Adding people is easy.** The server owner creates an **invite link** and
   sends it; the recipient picks an email and password and is watching in under
   a minute. No Jellyfin dashboard needed.
4. **Netflix-like recommendations.** Each profile gets rows built from its own
   taste: *Top Picks for Hayden*, *Because you watched…*, *Critically Acclaimed
   Witty Series*, *Starring…*, *Top 10 on Home Fin Today*, with reasons shown on
   the billboard ("We think you'll love this!").

Non-goals for v1: billing/plans, email delivery (invites are links you send
yourself), per-profile download limits, password reset by email (the owner can
reset a password from the admin page).

---

## 2. Why a companion service

Jellyfin has **users** but no concept of an account that owns several users.
Its only way to start a session is username + password (or Quick Connect from an
already signed-in session). To give a profile a session without the person ever
knowing a password, *something* has to hold that password and exchange it for a
token on their behalf, and it must not be the browser.

So:

* **Every profile is a real Jellyfin user.** That is what gives each profile its
  own history, resume points, favourites, likes and parental limits, for free,
  and it keeps working with everything Jellyfin already does.
* The **companion service** owns the account layer: accounts, sessions,
  invites, which profiles belong to which account. It creates the Jellyfin user
  for each profile with a long random password that only the service knows
  (stored encrypted), and when a person picks a profile it signs in to Jellyfin
  as that user *for the person's own browser device* and hands back the token.
* The service talks to Jellyfin with an **admin API key** (Dashboard → API
  Keys). It never exposes that key.

```
 Browser (Home Fin web)          homefin-accounts                 Jellyfin
 ─────────────────────           ────────────────                 ────────
 email + password  ───────────►  verify (scrypt)
                    ◄──────────  session cookie + profiles
 pick "Hayden" (+PIN) ─────────► decrypt Hayden's Jellyfin pw
                                 AuthenticateByName as Hayden ───► token for this device
                    ◄──────────  AuthenticationResult
 normal Jellyfin API calls with that token ──────────────────────► (unchanged)
```

After a profile is chosen the web client is simply signed in to Jellyfin as that
user; playback, images, websockets and everything else go straight to Jellyfin
exactly as before.

### Alternatives considered

| Option | Why not |
|---|---|
| Jellyfin server plugin (C#) | Needs a .NET build pipeline and is tied to server versions; heavier to maintain than a 1-file Node service. Worth revisiting later. |
| Store profile passwords in the browser | Anyone with the browser profile (or an XSS) could sign in as any profile; no real account boundary. |
| Passwordless Jellyfin users | Anyone who can reach Jellyfin can sign in as them. Breaks goal 2. |
| One Jellyfin user per account, "profiles" faked client-side | Profiles would share history, resume points and recommendations. Breaks goal 1. |

---

## 3. Data model (SQLite, `node:sqlite`)

```
accounts   id, email (unique, lower-case), name, password_hash (scrypt),
           is_admin, created_at, disabled
profiles   id, account_id → accounts, name, avatar (preset key),
           maturity ('kids' | 'teen' | 'all'), pin_hash (nullable),
           jellyfin_user_id, jellyfin_password_enc (AES-256-GCM),
           position, created_at
sessions   id_hash (sha256 of the cookie token), account_id, created_at,
           last_seen_at, expires_at, user_agent
invites    code_hash, created_by, email (optional), note, expires_at,
           used_at, used_by_account_id
```

Limits: 5 profiles per account; profile names unique within an account.

Jellyfin user for a profile:

* Name `hf-<8 random chars>` (Jellyfin needs unique names; the profile's display
  name lives in the service).
* Policy: `IsHidden: true` (not on the login screen), `IsAdministrator: false`,
  `EnableContentDeletion: false`, remote access allowed.
* Maturity → `MaxParentalRating`: kids = 10 (U/PG, TV-Y7…TV-PG), teen = 13
  (12/12A/PG-13), all = none. `BlockUnratedItems` for kids.

---

## 4. Security

* **Account passwords**: scrypt (N=2^15, r=8, p=1), per-password salt; minimum
  8 characters. Constant-time comparisons.
* **Profile Jellyfin passwords**: 32 random bytes, base64url; encrypted with
  AES-256-GCM under `HOMEFIN_SECRET` (32-byte key, required, from env). Losing
  the key means re-keying profiles (the service can reset them via the admin
  key).
* **Sessions**: 32 random bytes in an `HttpOnly; SameSite=Lax` cookie
  (`Secure` when `HOMEFIN_COOKIE_SECURE=true`, default when the public URL is
  https). Only a SHA-256 of the token is stored. 30-day sliding expiry.
* **Profile PIN** (optional, 4 digits): scrypt-hashed; required to open the
  profile or change it.
* **Account boundary**: every profile route loads the profile *by id and
  account id*; a profile from another account is a 404, never a 403.
* **Rate limits** (per 15 min): sign-in 10 per address + email, 30 per
  address, 50 per email, so one visitor can't lock the household out; PINs 10
  per address + profile; invites per address. Behind a tunnel or reverse
  proxy set `TRUST_PROXY=true` so "address" is the visitor's (last
  `X-Forwarded-For` hop), not the proxy's. Without it, forwarding headers from
  visitors are also not passed on to Jellyfin.
* **Cutting off access**: disabling an account disables its profiles' Jellyfin
  users; disabling it, an admin password reset, or the member changing their
  password also rotates every profile's Jellyfin password, which makes
  Jellyfin drop all existing tokens (TVs, phones, browsers).
* **CSRF**: state-changing routes require `Content-Type: application/json` and
  a matching `Origin` (when present), on top of SameSite cookies.
* **Admin key** is read from env (`JELLYFIN_API_KEY`) and only used
  server-side.
* Profiles cannot sign in on Jellyfin's own login page (unknown password,
  hidden). TVs and phone apps sign in with **Quick Connect**: the app shows a
  code, and the person approves it from Home Fin (profile menu → *Sign in a
  TV*), which signs that device in as the profile.

---

## 5. HTTP API (`/homefin-api`)

All JSON. `401` when no session, `404` for anything outside the account.

| Method & path | Who | Purpose |
|---|---|---|
| `GET  /config` | anyone | `{ enabled, serverName, allowInvites }` |
| `POST /auth/login` | anyone | `{ email, password }` → session cookie, `{ account, profiles }` |
| `POST /auth/logout` | session | end session |
| `GET  /me` | session | `{ account, profiles }` |
| `PATCH /me` | session | change name / email / password (needs current password) |
| `GET  /avatars` | anyone | preset avatar catalogue |
| `POST /profiles` | session | create profile `{ name, avatar, maturity, pin? }` |
| `PATCH /profiles/:id` | session | rename, avatar, maturity, set/clear PIN (needs `currentPin` if set, or `accountPassword` for *Forgot PIN?*) |
| `DELETE /profiles/:id` | session | delete profile **and** its Jellyfin user (not the last one; same PIN / password rule) |
| `POST /profiles/:id/session` | session | `{ pin?, device }` → Jellyfin `AuthenticationResult` for this device |
| `GET  /trending` | session | household Top 10 films / series over the last 7 days |
| `GET  /invites/:code` | anyone | is this invite valid? (for the join page) |
| `POST /auth/move/check` | anyone | `{ username, password }` of a Jellyfin login → `{ name, keepsPassword }` if it can move to Home Fin (not an administrator, not already a profile) |
| `POST /auth/move` | anyone | same credentials plus `{ mode: 'new', email, newPassword? }` or `{ mode: 'join', email, accountPassword }` and `profileName` → the Jellyfin user becomes a profile (history kept) of a new account or of that existing one, signs in. A Jellyfin password of 8+ characters is kept (devices stay signed in); a shorter one is replaced with a random one |
| `POST /invites/:code/accept` | anyone | `{ name, email, password }` → creates account + first profile, signs in |
| `GET  /admin/accounts` | admin | list accounts with profiles |
| `POST /admin/accounts` | admin | create account directly `{ name, email, password }` |
| `PATCH /admin/accounts/:id` | admin | disable/enable, make admin, reset password |
| `DELETE /admin/accounts/:id` | admin | delete account and its profiles' Jellyfin users |
| `GET  /admin/invites` · `POST /admin/invites` · `DELETE /admin/invites/:id` | admin | manage invite links (7-day default expiry) |
| `GET  /admin/jellyfin-users` | admin | existing Jellyfin users not yet linked |
| `POST /admin/adopt` | admin | link an existing Jellyfin user as a profile of an account (keeps their history; the service sets a new random password) |
| `GET /requests/config` | viewer | `{ enabled, movies, tv, policy, isAdmin }` for whoever is watching |
| `GET /requests/search?q=` | viewer | Radarr + Sonarr lookup, films and shows interleaved, each with `state` (available / partial / downloading / processing / pending / declined / failed / null) |
| `GET /requests` | viewer | `{ mine, household }` with live state |
| `POST /requests` | viewer | `{ type: 'movie' \| 'tv', id, seasons? }` (TMDB id for films, TVDB for shows) → pending, or sent straight to Radarr / Sonarr for admins and `auto` accounts |
| `DELETE /requests/:id` | requester (pending) / admin | cancel |
| `GET /admin/requests`, `POST /admin/requests/:id/approve` \| `/decline` | admin | approval queue; decline takes an optional `reason` |
| `GET /admin/integrations`, `POST /admin/integrations/:service/test`, `PUT` / `DELETE /admin/integrations/:service` | admin | Sonarr / Radarr address, key, quality profile, root folder (tested before saving; the key is never returned) |
| `PUT /admin/requests-settings` | admin | `{ defaultPolicy }` for plain Jellyfin users |
| `GET /links`, `GET` / `PUT /admin/links` | viewer / admin | quick links (`audience`: admins or everyone) |

"Viewer" = the caller's Jellyfin token in `X-Jellyfin-Token` (checked with
Jellyfin's `/Users/Me`), or a Home Fin account session cookie.

`device` is the browser's Jellyfin device identity (`{ id, name, client,
version }`) so the token is issued to *that* device and shows up correctly in
Jellyfin's dashboard and can be revoked there.

**Trending**: the service asks Jellyfin (admin key) for each Home Fin profile's
items played in the last 7 days, counts distinct viewers per film / series
(series counted once per viewer), breaks ties by total plays, and caches the
result for 10 minutes.

---

## 6. Web client

New routes (stable layout), only active when `homefinAccounts.enabled` is set
in `config.json`:

| Route | Page |
|---|---|
| `#/homefin/login` | Sign in (email + password) |
| `#/homefin/profiles` | **Who's watching?** grid; PIN pad for locked profiles |
| `#/homefin/profiles/manage` | Manage Profiles: add / edit (name, avatar, maturity, PIN) / delete |
| `#/homefin/join?code=…` | Accept an invite |
| `#/homefin/account` | Account: name, email, password; admin section if admin |
| `#/homefin/admin` | Admin: accounts, invite links, adopt existing users |
| `#/homefin/move` | Move a Jellyfin login to Home Fin (self-service) |
| `#/homefin/requests` | Requests: search Sonarr / Radarr, ask for titles, admin approval queue |
| `#/homefin/settings` (also `#/mypreferencesmenu`) | Settings: profile, playback, subtitles, display; admins also Requests (Sonarr / Radarr), Quick links, Server |

Behaviour:

* When the client has no Jellyfin session and accounts are enabled, it goes to
  `#/homefin/login` instead of Jellyfin's login page. When an account is signed
  in but no profile is chosen, it goes to *Who's watching?*.
* Header profile button opens the Netflix menu: other profiles, *Manage
  Profiles*, *Account*, *Sign in a TV*, *Sign out of Home Fin*.
* Switching profile = ask the service for that profile's token, swap the
  Jellyfin credentials, reload Home.
* Sign out = Jellyfin logout + service logout.
* Jellyfin's own login still works (e.g. for the admin's existing Jellyfin
  account) at `#/login?classic=1`.

Config:

```json
"homefinAccounts": { "enabled": true, "apiPath": "/homefin-api" }
```

---

## 7. Recommendations

Runs in the web client per profile; the household Top 10 comes from the service.

### 7.1 Taste profile

Signals from the profile's own Jellyfin data (latest ~300 items):

| Signal | Weight |
|---|---|
| Finished film / episode | 1.0 |
| Partly watched | played % (min 0.2) |
| Re-watched | × (1 + 0.3 × extra plays), capped at 2 |
| In My List (favourite) | + 1.5 |
| Thumbs up (Likes = true) | + 2.0 |
| Thumbs down (Likes = false) | − 3.0 (and never recommended) |

Episodes roll up into their series (log-scaled by episodes watched, so one
binge doesn't drown everything). Each signal decays with a 45-day half-life.

Features per title: genres, top-billed cast (first 5), directors, studios,
tags (TMDb keywords), decade, film vs series. The profile is the decayed,
weighted sum of these features, normalised per feature family.

### 7.2 Scoring a candidate

Candidates: unwatched films; series with nothing watched yet; series with a new
season since you last watched (flagged *New Season*).

```
score = 0.55 · taste_match      (cosine over feature families, genre-weighted)
      + 0.20 · quality          (community + critic rating, shrunk to the mean when sparse)
      + 0.10 · freshness        (added in the last 30 days / new season)
      + 0.10 · household        (trending among other profiles)
      + 0.05 · exploration      (stable per-day jitter so rows rotate, not shuffle)
```

### 7.3 Rows (in page order, de-duplicated so a title shows at most twice)

1. Billboard — highest-scoring title with a logo; reason tags from its strongest
   signal ("We think you'll love this!", "Starring Ana de Armas",
   "#2 in Series Today", "New on Home Fin").
2. Continue Watching for {profile}
3. Top Picks for {profile}
4. Top 10 Series / Films on Home Fin Today (household; falls back to top rated)
5. Because you watched {recent title} ×2 (Jellyfin similar items, re-ranked)
6. {Mood} {Genre} {Series|Films} ×3 — e.g. *Critically Acclaimed Witty Series*,
   *Exciting Crime Films*, built from the profile's top genres with a mood word
   from the genre (and *Critically Acclaimed* when the row is rating-filtered)
7. My List
8. New on Home Fin
9. Starring {top actor}
10. Watch It Again (finished titles you loved, older than 60 days)

Feedback loop: thumbs up / down in the hover preview and More Info pop-up write
Jellyfin `Likes`, which feed straight back into 7.1.

---

## 8. Deployment

```
cloudflared ──► homefin-accounts :8097 ──┬─ /homefin-api/*  handled here
                                          └─ everything else proxied ► Jellyfin :8096
                                                                     (serving this web build)
```

* The service can act as the **front door** (`JELLYFIN_URL` set,
  `PROXY_JELLYFIN=true`): it handles `/homefin-api` and transparently proxies
  every other request, including streams and websockets, to Jellyfin. Point
  your tunnel at it instead of Jellyfin, and add its address to Jellyfin's
  *Known proxies* so client IPs stay correct.
* Or keep your proxy and route only `/homefin-api/*` to the service.
* Env: `JELLYFIN_URL`, `JELLYFIN_API_KEY`, `HOMEFIN_SECRET`,
  `HOMEFIN_DB` (default `./data/homefin.db`), `PORT` (8097),
  `HOMEFIN_PUBLIC_URL`, `HOMEFIN_ADMIN_EMAIL` / `HOMEFIN_ADMIN_PASSWORD`
  (creates the first admin on first start).

See `homefin/accounts/README.md` for the step-by-step.
