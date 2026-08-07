#!/usr/bin/env bash
set -euo pipefail

# Syncs the local repo to the Raspberry Pi and builds it there (native modules
# like better-sqlite3 must compile on-device — cross-compiling from a dev
# machine is fragile and not worth it here).
#
# Usage: ./deploy/deploy-to-pi.sh user@host [remote_dir]

REMOTE="${1:?Usage: deploy-to-pi.sh user@host [remote_dir]}"
REMOTE_DIR="${2:-~/pwa_admin_pi}"

echo "== Syncing source to ${REMOTE}:${REMOTE_DIR} =="
rsync -az --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude '.claude' \
  --exclude 'data' \
  --exclude 'secrets' \
  --exclude '.env' \
  ./ "${REMOTE}:${REMOTE_DIR}/"

echo "== Installing dependencies + building on the Pi =="
ssh "${REMOTE}" "cd ${REMOTE_DIR} && npm install && npm run build --workspace=packages/shared && npm run build --workspace=apps/api && npm run build --workspace=apps/web"

echo "== Done. Remote dir: ${REMOTE_DIR} =="
echo "Next: configure .env, then run/enable the service (see deploy/install.sh and README.md)."
