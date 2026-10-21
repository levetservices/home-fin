# Home Fin accounts

Netflix-style **accounts → profiles** for Jellyfin. One email + password per
person or household; up to five profiles inside it ("Dad", "Alana", "Kids"),
each with its own history, My List and recommendations. Profiles belong to
their account only and never show on Jellyfin's own login screen.

How it works, the data model, the API and the security choices are in
[`../SPEC.md`](../SPEC.md). In one line: every profile is a hidden Jellyfin
user whose (random, encrypted) password only this service knows; picking a
profile in Home Fin asks this service for a Jellyfin session for that profile.

No npm packages, just Node 22.5+ (it uses the built-in `node:sqlite`).

## Set up

1. **Create a Jellyfin API key**: Dashboard → API Keys → **+** → name it
   `Home Fin`.
2. **Make a secret**: `openssl rand -base64 32`. Keep it somewhere safe: it
   encrypts the profile passwords.
3. **Run the service** next to Jellyfin. With Docker Compose:

   ```yaml
   services:
     jellyfin:
       image: jellyfin/jellyfin:10.11.11
       volumes:
         - ./config:/config
         - ./cache:/cache
         - /path/to/media:/media
         - ./home-fin/dist:/jellyfin/jellyfin-web:ro   # the Home Fin web build
       restart: unless-stopped

     homefin-accounts:
       build: ./home-fin/homefin/accounts
       environment:
         JELLYFIN_URL: http://jellyfin:8096
         JELLYFIN_API_KEY: <from step 1>
         HOMEFIN_SECRET: <from step 2>
         HOMEFIN_ADMIN_EMAIL: you@example.com
         HOMEFIN_ADMIN_PASSWORD: <pick one>
         HOMEFIN_PUBLIC_URL: https://tv.example.com
         PROXY_JELLYFIN: "true"
         TRUST_PROXY: "true"   # only reachable through your tunnel / proxy
       volumes:
         - ./homefin-data:/data
       ports:
         - "8097:8097"
       restart: unless-stopped
   ```

4. **Point your tunnel / reverse proxy at port 8097 instead of 8096.** The
   service answers `/homefin-api/*` and passes everything else (pages, API,
   video, websockets) straight to Jellyfin. In Jellyfin, add the service's
   address under Dashboard → Networking → **Known proxies** so Jellyfin still
   sees real client IPs.

   Set `TRUST_PROXY=true` when the service is only reachable through that
   tunnel / proxy (don't publish port 8097 to the internet as well). Sign-in
   limits then apply per visitor rather than to everyone at once.

   Prefer to keep your current proxy pointing at Jellyfin? Set
   `PROXY_JELLYFIN=false` and add one rule that sends `/homefin-api/*` to
   port 8097. It must be the **same host name** as Jellyfin (the sign-in
   cookie is same-site only).

5. **Turn it on in the web client**: in the web build's `config.json` set

   ```json
   "homefinAccounts": { "enabled": true, "apiPath": "/homefin-api" }
   ```

6. Open Home Fin, sign in with the admin email and password, and create your
   profiles.

## Adding people

* **Invite link** (easiest): Account → Admin → *Invite someone*. Copy the link
  and send it. They choose their name, email and password, and land on their
  profile. Links last 7 days and work once.
* **Create the account yourself**: Admin → *Add account* with a temporary
  password.
* **Let people move themselves over** (easiest for an existing server): the
  sign-in page has *Move it to Home Fin*. They type their old Jellyfin username
  and password, add an email, and their Jellyfin user becomes their profile,
  with its history, in a new account or in one someone in their household
  already has (with that account's password). Admin → *Existing Jellyfin users*
  has a ready-made message to send them. A Jellyfin password of 8+ characters
  stays the same, so their TVs and phones stay signed in; a shorter one is
  replaced. Administrators keep their normal Jellyfin login.
* **Bring over an existing Jellyfin user yourself** (keeps their watch history): Admin →
  *Existing Jellyfin users* → choose the account it should become a profile of.
  Administrator users are left as normal Jellyfin logins.

## Profile locks

Any profile can have a 4-digit PIN (Manage Profiles → the profile → *Profile
Lock*). Forgot it? *Forgot PIN?* on the PIN screen asks for the account
password instead, then lets you change or remove the PIN.

## Taking access away

* **Disable** an account (Admin → Accounts) and every TV, phone and browser
  watching as its profiles is signed out straight away; enabling it again
  lets them sign back in.
* A **password change** (by the member, or an admin reset) also signs every
  device out of that account's profiles.
* **Delete** removes the account, its profiles and their watch history.

## TVs and phone apps

Profiles don't have a password you can type into the Jellyfin TV or phone apps.
Use **Quick Connect**: pick *Quick Connect* in the app, then in Home Fin open
the profile menu → *Sign in a TV* and enter the code.

## Requests (built-in Jellyseerr) and quick links

Connect Radarr and Sonarr in Home Fin under **Settings → Requests** (address,
API key from their Settings → General, quality profile and folder). Everyone
then gets a **Requests** link in the header: search any film or show, pick
seasons, and ask for it. Titles that aren't in the library also show up under
*Not here yet* on the normal search page.

* Admins' requests go straight through. For everyone else, choose per account
  on **People**: *Need my approval* (default), *Go straight through* or *Can't
  request*. People still on a Jellyfin login follow the default in Settings →
  Requests.
* Approved films are added to Radarr and searched for; shows are added to
  Sonarr with only the requested seasons monitored. The Requests page shows
  each one's progress until it's in the library.
* The service talks to Sonarr / Radarr itself, so it needs to reach them on
  your network (on a firewalled VM, allow outgoing connections to their
  ports).

**Quick links** (Settings → Quick links) put Sonarr, Radarr, Prowlarr,
qBittorrent and the rest of your stack in the profile menu. Admins see all of
them; mark a link *Everyone* to show it to the household too.

## Environment

| Variable | Default | |
|---|---|---|
| `JELLYFIN_URL` | `http://127.0.0.1:8096` | Jellyfin, as this service reaches it |
| `JELLYFIN_API_KEY` | required | Jellyfin admin API key |
| `HOMEFIN_SECRET` | required | 32 bytes, base64 / hex |
| `HOMEFIN_DB` | `./data/homefin.db` | SQLite file (back it up) |
| `PORT` / `HOST` | `8097` / `0.0.0.0` | |
| `API_PATH` | `/homefin-api` | must match `homefinAccounts.apiPath` |
| `PROXY_JELLYFIN` | `false` | front-door mode |
| `TRUST_PROXY` | `false` | visitor address from `X-Forwarded-For` (behind a tunnel / proxy only) |
| `HOMEFIN_PUBLIC_URL` | | `https://…` turns on `Secure` cookies |
| `HOMEFIN_COOKIE_SECURE` | from public URL | force `true` / `false` |
| `HOMEFIN_SERVER_NAME` | `Home Fin` | shown on sign-in pages |
| `HOMEFIN_ADMIN_EMAIL` / `HOMEFIN_ADMIN_PASSWORD` | | first admin, created only when there are no accounts |

## Develop

```sh
npm test      # node:test suite with a fake Jellyfin
npm start     # needs the env above
```

The web client's dev server (`npm start` in the repo root) proxies
`/homefin-api` to `http://127.0.0.1:8097` (override with
`HOMEFIN_ACCOUNTS_URL`). Remember `homefinAccounts.enabled` in `src/config.json`
is `false` in the repository; switch it on only in your local or deployed copy.
