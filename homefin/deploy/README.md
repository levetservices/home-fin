# Putting Home Fin on your Jellyfin server

Home Fin replaces Jellyfin's **web client** (what you see in the browser). Your
Jellyfin server, libraries and users stay exactly as they are. You need:

1. **Jellyfin 10.11.x** (Home Fin is built on the 10.11.11 web client).
2. The **Home Fin web build**, installed in its own folder, with Jellyfin told to
   serve that folder instead of its own (Jellyfin's files are never changed, so
   switching back is one setting).
3. The **accounts service** (`homefin/accounts`), if you want Home Fin accounts
   and profiles. It sits in front of Jellyfin as the "front door".

```
browser ─► Cloudflare tunnel ─► homefin-accounts :8097 ─┬─ /homefin-api/*  (accounts)
                                                        └─ everything else ─► Jellyfin :8096
                                                                              serving /opt/homefin/web
```

## 1. Build and install the web client

On the server (needs git, Node.js 20+ and about 3.5 GB of memory including swap; the build
takes a few minutes; the script stops with the swap commands if there isn't enough):

```sh
git clone -b home-fin https://github.com/levetservices/home-fin.git /opt/homefin/src
sudo /opt/homefin/src/homefin/deploy/install-web.sh --accounts on
```

This builds the client and installs it to `/opt/homefin/web`. Use
`--accounts off` to try the Netflix look first without accounts (Jellyfin's own
sign-in is used then); you can rerun with `--accounts on` later.

## 2. Point Jellyfin at it (once)

**Docker** (`jellyfin/jellyfin` image) — mount the *parent* folder and set the
web directory, then recreate the container:

```yaml
  jellyfin:
    image: jellyfin/jellyfin:10.11.11
    environment:
      JELLYFIN_WEB_DIR: /homefin/web
    volumes:
      - /opt/homefin:/homefin:ro
      # …your existing config / cache / media volumes
```

(Mount `/opt/homefin`, not `/opt/homefin/web`: updates swap that folder, and a
mount of the folder itself would keep showing the old copy.)

**Debian / Ubuntu package** — in `/etc/default/jellyfin` set

```sh
JELLYFIN_WEB_OPT="--webdir=/opt/homefin/web"
```

then `sudo systemctl restart jellyfin`.

**Windows** — add `--webdir "C:\homefin\web"` to the Jellyfin service's start
arguments (install the build there instead of `/opt/homefin/web`).

## 3. Run the accounts service

Follow `homefin/accounts/README.md` (Docker Compose example there). For the
setup above use:

```yaml
  homefin-accounts:
    build: /opt/homefin/src/homefin/accounts
    environment:
      JELLYFIN_URL: http://jellyfin:8096
      JELLYFIN_API_KEY: <Dashboard → API Keys → +>
      HOMEFIN_SECRET: <openssl rand -base64 32, keep it safe>
      HOMEFIN_ADMIN_EMAIL: you@example.com
      HOMEFIN_ADMIN_PASSWORD: <pick one>
      HOMEFIN_PUBLIC_URL: https://tv.example.com
      PROXY_JELLYFIN: "true"
      TRUST_PROXY: "true"
    volumes:
      - /opt/homefin/data:/data
    restart: unless-stopped
```

Then point the Cloudflare tunnel's public hostname at
`http://homefin-accounts:8097` (instead of Jellyfin's 8096), and add the
service's address to Jellyfin → Dashboard → Networking → **Known proxies**.

Open your Home Fin address, sign in with the admin email and password, create
your profile, then invite everyone else from Account → Open admin.

## Updating and undoing

```sh
cd /opt/homefin/src && git pull
sudo homefin/deploy/install-web.sh --rebuild      # Jellyfin keeps running; reload the browser
sudo homefin/deploy/install-web.sh --rollback     # back to the version before
```

To go back to Jellyfin's own web client entirely, remove `JELLYFIN_WEB_DIR` /
`--webdir` and restart Jellyfin; point the tunnel back at 8096 if you also want
to stop the accounts service.

## Rehearsed

This exact setup was run end to end against Jellyfin 10.11.11: the install
script, Jellyfin with `--webdir`, the accounts service as front door with
`PROXY_JELLYFIN` and `TRUST_PROXY`, a first visit in a fresh browser landing
on the Home Fin sign-in, profiles, Home with live updates (websockets) through
the front door, and update / rollback without restarting Jellyfin. Not
rehearsed: a real Cloudflare tunnel, Docker volume mounts and the Windows
service.
