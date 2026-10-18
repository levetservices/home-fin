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

**Debian / Ubuntu** (Jellyfin installed as a package) — one command. It needs
Node.js 22.5+ (it tells you how to install it if yours is older), asks for your
Home Fin web address, your email, a password and a Jellyfin API key (Dashboard →
API Keys → **+**), and sets up a `homefin-accounts` systemd service:

```sh
sudo /opt/homefin/src/homefin/deploy/install-accounts.sh
sudo /opt/homefin/src/homefin/deploy/install-web.sh --accounts on
```

Settings live in `/etc/homefin/accounts.env` (root-only; **back up
`HOMEFIN_SECRET`**, it encrypts the profile passwords) and the database in
`/opt/homefin/data`. Your password goes straight into the database and is never
written to a file. Rerunning the script later updates the service and keeps the
settings.

**Docker** — follow `homefin/accounts/README.md`. For the setup above use:

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

Then, either way:

* Point the Cloudflare tunnel's public hostname at the accounts service on port
  **8097** (instead of Jellyfin's 8096): `http://localhost:8097` when
  `cloudflared` runs on the same machine, `http://homefin-accounts:8097` in
  Docker, otherwise `http://<server address>:8097`.
* Jellyfin → Dashboard → Networking → **Known proxies**: add the address the
  service reaches Jellyfin from (`127.0.0.1` on the same machine), then restart
  Jellyfin.
* Use the tunnel address at home too. With accounts on, Jellyfin's own port
  (8096) doesn't serve the sign-in, and the sign-in cookie is only sent over
  https, so `http://<server address>:8097` won't keep you signed in either.

Open your Home Fin address, sign in with the admin email and password, create
your profile, then invite everyone else from Account → Open admin. The Jellyfin
TV and phone apps keep working: they sign in with **Quick Connect** (profile menu
→ *Sign in a TV*).

## Updating and undoing

```sh
cd /opt/homefin/src && git pull
sudo homefin/deploy/install-web.sh --rebuild      # Jellyfin keeps running; reload the browser
sudo homefin/deploy/install-accounts.sh           # updates the accounts service (Debian / Ubuntu)
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
service. `install-accounts.sh` was run end to end with systemd stubbed out (first
install, admin sign-in through the front door, rerun as an update); on a real
server it is the systemd unit it writes that runs the service.
