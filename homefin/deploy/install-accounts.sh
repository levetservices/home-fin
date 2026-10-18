#!/usr/bin/env bash
# Install (or update) the Home Fin accounts service on a Debian / Ubuntu server with systemd.
#
#   sudo ./install-accounts.sh [--public-url URL] [--email EMAIL] [--api-key KEY]
#                              [--jellyfin-url URL] [--port PORT] [--no-trust-proxy]
#
# First run asks for anything not given, writes /etc/homefin/accounts.env (with a new secret),
# and starts the homefin-accounts service as the front door on PORT (default 8097).
# Later runs keep that file as it is and just update the code and restart the service.
set -euo pipefail

PUBLIC_URL=""
EMAIL=""
API_KEY=""
JELLYFIN_URL="http://127.0.0.1:8096"
PORT=8097
TRUST_PROXY=true

ENV_DIR=/etc/homefin
ENV_FILE="$ENV_DIR/accounts.env"
APP_DIR=/opt/homefin/accounts
DATA_DIR=/opt/homefin/data
SERVICE=homefin-accounts
UNIT="/etc/systemd/system/$SERVICE.service"
RUN_USER=homefin

usage() {
    sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --public-url) PUBLIC_URL="${2:?--public-url needs a URL}"; shift 2 ;;
        --email) EMAIL="${2:?--email needs an address}"; shift 2 ;;
        --api-key) API_KEY="${2:?--api-key needs a key}"; shift 2 ;;
        --jellyfin-url) JELLYFIN_URL="${2:?--jellyfin-url needs a URL}"; shift 2 ;;
        --port) PORT="${2:?--port needs a number}"; shift 2 ;;
        --no-trust-proxy) TRUST_PROXY=false; shift ;;
        -h|--help) usage ;;
        *) echo "Unknown option: $1" >&2; usage 1 ;;
    esac
done

[ "$(id -u)" -eq 0 ] || { echo "Run this with sudo (it installs a system service)." >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemd is needed; for Docker see homefin/accounts/README.md." >&2; exit 1; }

# node:sqlite arrived in Node 22.5.
NODE="$(command -v node || true)"
if [ -z "$NODE" ] || ! "$NODE" -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 5) ? 0 : 1)'; then
    cat >&2 <<EOM
The accounts service needs Node.js 22.5 or newer (found: $([ -n "$NODE" ] && "$NODE" -v || echo none)).
Install Node 22, then run this again:
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
Nothing has been changed.
EOM
    exit 1
fi

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$REPO/homefin/accounts"
[ -f "$SRC/src/server.mjs" ] || { echo "Can't find the accounts service in $SRC" >&2; exit 1; }

# A value for the env file: double-quoted, with \ and " escaped (systemd's EnvironmentFile rules).
quote() {
    local value="${1//\\/\\\\}"
    printf '"%s"' "${value//\"/\\\"}"
}

ask() {
    local prompt="$1" var="$2"
    while [ -z "${!var}" ]; do read -r -p "$prompt: " "${var?}"; done
}

FIRST_RUN=false
if [ ! -f "$ENV_FILE" ]; then
    FIRST_RUN=true
    echo "Setting up the Home Fin accounts service."
    echo
    ask "Home Fin web address people will use (e.g. https://tv.example.com)" PUBLIC_URL
    ask "Your email (the first admin account)" EMAIL
    echo "Create a Jellyfin API key: Jellyfin → Dashboard → API Keys → + (name it Home Fin)."
    ask "Paste the API key" API_KEY
    PASSWORD=""
    while :; do
        read -r -s -p "Choose a password for $EMAIL (8+ characters): " PASSWORD; echo
        [ "${#PASSWORD}" -ge 8 ] || { echo "Too short."; continue; }
        read -r -s -p "Type it again: " AGAIN; echo
        [ "$PASSWORD" = "$AGAIN" ] && break
        echo "They didn't match."
    done

    install -d -m 700 "$ENV_DIR"
    umask 077
    {
        echo "# Home Fin accounts service (homefin/deploy/install-accounts.sh). Root-only: it holds secrets."
        echo "# HOMEFIN_SECRET encrypts the profile passwords: back it up, and never change it."
        echo "JELLYFIN_URL=$(quote "$JELLYFIN_URL")"
        echo "JELLYFIN_API_KEY=$(quote "$API_KEY")"
        echo "HOMEFIN_SECRET=$(quote "$(head -c 32 /dev/urandom | base64)")"
        echo "HOMEFIN_DB=$(quote "$DATA_DIR/homefin.db")"
        echo "HOMEFIN_PUBLIC_URL=$(quote "$PUBLIC_URL")"
        echo "PORT=$PORT"
        echo "PROXY_JELLYFIN=true"
        echo "TRUST_PROXY=$TRUST_PROXY"
    } > "$ENV_FILE"
    umask 022
    chmod 600 "$ENV_FILE"
else
    echo "Keeping the existing settings in $ENV_FILE; updating the service code."
fi

id "$RUN_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$RUN_USER"
install -d -m 750 -o "$RUN_USER" -g "$RUN_USER" "$DATA_DIR"

# Copy the code, so pulling a newer version doesn't change what's running until this is rerun.
rm -rf "$APP_DIR.new"
mkdir -p "$APP_DIR.new"
cp -a "$SRC/package.json" "$SRC/src" "$APP_DIR.new/"
rm -rf "$APP_DIR"
mv "$APP_DIR.new" "$APP_DIR"

# The first admin account goes straight into the database, so its password is never written
# to disk (it's passed on stdin). Skipped when the database already has accounts.
if $FIRST_RUN; then
    printf '%s' "$PASSWORD" | runuser -u "$RUN_USER" -- env HOMEFIN_DB="$DATA_DIR/homefin.db" \
        "$NODE" --disable-warning=ExperimentalWarning --input-type=module -e '
            const [dir, email] = process.argv.slice(1);
            const { openDatabase } = await import(`${dir}/src/db.mjs`);
            const { hashSecret } = await import(`${dir}/src/crypto.mjs`);
            let password = "";
            for await (const chunk of process.stdin) password += chunk;
            const store = openDatabase(process.env.HOMEFIN_DB);
            if (store.countAccounts() === 0) {
                store.createAccount({ email, name: "Admin", passwordHash: await hashSecret(password), isAdmin: true });
                console.log(`Created the admin account ${email}.`);
            } else {
                console.log("The database already has accounts; sign in with an existing one.");
            }
        ' "$APP_DIR" "$EMAIL"
    unset PASSWORD AGAIN
fi

cat > "$UNIT" <<EOF
[Unit]
Description=Home Fin accounts (front door for Jellyfin)
After=network-online.target jellyfin.service
Wants=network-online.target

[Service]
User=$RUN_USER
Group=$RUN_USER
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
WorkingDirectory=$APP_DIR
ExecStart=$NODE --disable-warning=ExperimentalWarning src/server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"

PORT_NOW=$(sed -n 's/^PORT=//p' "$ENV_FILE" | tr -d '"')
HEALTHY=false
echo -n "Waiting for the service"
for _ in $(seq 1 20); do
    if "$NODE" -e 'fetch(process.argv[1]).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))' "http://127.0.0.1:${PORT_NOW:-8097}/homefin-api/health"; then
        HEALTHY=true
        echo " — running."
        break
    fi
    echo -n .
    sleep 1
done
if ! $HEALTHY; then
    echo
    echo "The service didn't come up. Its log:" >&2
    journalctl -u "$SERVICE" -n 30 --no-pager >&2 || true
    exit 1
fi

cat <<EOF

Home Fin accounts is running on port ${PORT_NOW:-8097} (systemctl status $SERVICE, journalctl -u $SERVICE).

Still to do$($FIRST_RUN || echo ', if not done already'):
  1. Turn accounts on in the web client:
       sudo $REPO/homefin/deploy/install-web.sh --accounts on
  2. Point your Cloudflare tunnel's public hostname at http://<this server>:${PORT_NOW:-8097}
     (instead of :8096).
  3. Jellyfin → Dashboard → Networking → Known proxies: add 127.0.0.1, then restart Jellyfin.
  4. Open your Home Fin address, sign in with your email and password, and create your profile.
EOF
