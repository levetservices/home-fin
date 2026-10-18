#!/usr/bin/env bash
# Install the Home Fin web client for Jellyfin, next to (not over) Jellyfin's own web client.
#
#   ./install-web.sh [--target DIR] [--accounts on|off] [--rebuild]
#   ./install-web.sh --rollback [--target DIR]
#
# Builds the client if needed, copies it to DIR (default /opt/homefin/web), and keeps the
# version it replaces in DIR.previous. Jellyfin then serves it once pointed at DIR with
# --webdir / JELLYFIN_WEB_DIR (see homefin/deploy/README.md). Jellyfin's own files are never
# touched, so removing that setting puts the stock client back.
set -euo pipefail

TARGET=/opt/homefin/web
ACCOUNTS=""
REBUILD=false
ROLLBACK=false

usage() {
    sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --target) TARGET="${2:?--target needs a directory}"; shift 2 ;;
        --accounts) ACCOUNTS="${2:?--accounts needs on or off}"; shift 2 ;;
        --rebuild) REBUILD=true; shift ;;
        --rollback) ROLLBACK=true; shift ;;
        -h|--help) usage ;;
        *) echo "Unknown option: $1" >&2; usage 1 ;;
    esac
done

case "$ACCOUNTS" in ""|on|off) ;; *) echo "--accounts must be on or off" >&2; exit 1 ;; esac
TARGET="${TARGET%/}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

if $ROLLBACK; then
    if [ ! -f "$TARGET.previous/index.html" ]; then
        echo "Nothing to roll back to: $TARGET.previous doesn't exist." >&2
        exit 1
    fi
    rm -rf "$TARGET.rollback-tmp"
    [ -d "$TARGET" ] && mv "$TARGET" "$TARGET.rollback-tmp"
    mv "$TARGET.previous" "$TARGET"
    [ -d "$TARGET.rollback-tmp" ] && mv "$TARGET.rollback-tmp" "$TARGET.previous"
    echo "Rolled back: $TARGET is the previous version again (the newer one is now $TARGET.previous)."
    echo "Reload Home Fin in the browser; Jellyfin doesn't need restarting."
    exit 0
fi

command -v node >/dev/null || { echo "Node.js 20+ is needed to build Home Fin." >&2; exit 1; }

if $REBUILD || [ ! -f "$REPO/dist/index.html" ]; then
    echo "Building Home Fin (a few minutes)…"
    (cd "$REPO" && npm ci --no-audit --no-fund && npm run build:production)
fi
[ -f "$REPO/dist/index.html" ] || { echo "Build output missing: $REPO/dist/index.html" >&2; exit 1; }

STAGE="$TARGET.new"
rm -rf "$STAGE"
mkdir -p "$(dirname "$TARGET")"
cp -a "$REPO/dist" "$STAGE"

# Keep the accounts setting from the installed copy unless told otherwise.
if [ -z "$ACCOUNTS" ] && [ -f "$TARGET/config.json" ]; then
    ACCOUNTS=$(node -e 'const c = require(process.argv[1]); console.log(c.homefinAccounts && c.homefinAccounts.enabled ? "on" : "off")' "$TARGET/config.json")
fi
if [ -n "$ACCOUNTS" ]; then
    node -e '
        const fs = require("fs");
        const [file, state] = process.argv.slice(1);
        const config = JSON.parse(fs.readFileSync(file, "utf8"));
        config.homefinAccounts = { ...(config.homefinAccounts || {}), enabled: state === "on" };
        config.homefinAccounts.apiPath ||= "/homefin-api";
        fs.writeFileSync(file, JSON.stringify(config, null, 4) + "\n");
    ' "$STAGE/config.json" "$ACCOUNTS"
fi

rm -rf "$TARGET.previous"
[ -d "$TARGET" ] && mv "$TARGET" "$TARGET.previous"
mv "$STAGE" "$TARGET"

echo
echo "Installed Home Fin to $TARGET (accounts: ${ACCOUNTS:-off})."
[ -d "$TARGET.previous" ] && echo "The version it replaced is in $TARGET.previous (undo with --rollback)."
cat <<EOF

Next, if Jellyfin isn't serving it yet, point Jellyfin at $TARGET and restart Jellyfin once:
  Docker:        mount the folder above it, -v $(dirname "$TARGET"):/homefin:ro, and set
                 JELLYFIN_WEB_DIR=/homefin/$(basename "$TARGET") (mounting $TARGET itself would
                 keep showing the old copy after an update)
  Debian/Ubuntu: JELLYFIN_WEB_OPT="--webdir=$TARGET" in /etc/default/jellyfin
Later updates only need this script again; open browsers just need a reload.
EOF
