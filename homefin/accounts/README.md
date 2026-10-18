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
* **Bring over an existing Jellyfin user** (keeps their watch history): Admin →
  *Existing Jellyfin users* → choose the account it should become a profile of.
  Administrator users are left as normal Jellyfin logins.

## TVs and phone apps

Profiles don't have a password you can type into the Jellyfin TV or phone apps.
Use **Quick Connect**: pick *Quick Connect* in the app, then in Home Fin open
the profile menu → *Sign in a TV* and enter the code.

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
`/homefin-api` to `http://127.0.0.1:8097`.
