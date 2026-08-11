#!/usr/bin/env bash
set -euo pipefail

# Syncs the local repo to the target server and builds it there (native
# modules like better-sqlite3 must compile on-device — cross-compiling from a
# dev machine is fragile and not worth it here).
#
# Usage: ./deploy/deploy-to-pi.sh user@host [remote_dir] [build_as_user]
#
# build_as_user: for a --create-user (dedicated service account) install —
# the service account has no login shell, so it can't be the SSH target
# itself. Sync as your own account (user@host above) into remote_dir (owned
# by build_as_user, prepared by install.sh's chgrp/chmod 2775 step), then run
# every build command as build_as_user via `sudo -u`, so node_modules/dist/
# the compiled better-sqlite3 binary end up owned by the service account
# instead of your own login. Omit for a server using an existing personal-account install, where
# the SSH login already IS the service account.

REMOTE="${1:?Usage: deploy-to-pi.sh user@host [remote_dir] [build_as_user]}"
REMOTE_DIR="${2:-~/pwa_admin}"
BUILD_AS_USER="${3:-}"

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

if [ -n "${BUILD_AS_USER}" ]; then
  echo "== Installing dependencies + building on the server as ${BUILD_AS_USER} =="
  ssh "${REMOTE}" "cd ${REMOTE_DIR} && \
    sudo -u ${BUILD_AS_USER} -H npm install && \
    sudo -u ${BUILD_AS_USER} -H npm run build --workspace=packages/shared && \
    sudo -u ${BUILD_AS_USER} -H npm run build --workspace=apps/api && \
    sudo -u ${BUILD_AS_USER} -H npm run build --workspace=apps/web"
else
  echo "== Installing dependencies + building on the server =="
  ssh "${REMOTE}" "cd ${REMOTE_DIR} && npm install && npm run build --workspace=packages/shared && npm run build --workspace=apps/api && npm run build --workspace=apps/web"
fi

echo "== Done. Remote dir: ${REMOTE_DIR} =="
echo "Next: configure .env, then run/enable the service (see deploy/install.sh and README.md)."
