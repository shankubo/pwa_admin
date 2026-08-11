#!/usr/bin/env bash
set -euo pipefail

# Polling auto-update for pwa-admin, meant to run every few minutes via cron
# on the host itself (Tailscale-only device, no public webhook endpoint —
# GitHub can't reach a Tailscale address, so polling replaces a webhook here).
#
# Compares local HEAD against origin/master; if behind, pulls, rebuilds
# (shared -> api -> web, in dependency order — native modules like
# better-sqlite3 must compile on this device, never cross-compiled), and
# restarts the service. The restart requires a dedicated scoped NOPASSWD
# sudoers rule (`systemctl restart pwa-admin`) — normally forbidden by this
# project's "never self-restart without human confirmation" rule, but this
# script IS the human-approved automated path, set up deliberately for this
# repo's own auto-deploy flow.

APP_DIR="${1:-$HOME/pwa_admin}"
LOG_FILE="$APP_DIR/data/auto-update.log"

log() {
  echo "[$(date --iso-8601=seconds)] $*" | tee -a "$LOG_FILE"
}

cd "$APP_DIR"

git fetch origin master -q

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/master)"

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

log "Update available: $LOCAL -> $REMOTE"

if ! git pull --ff-only origin master >>"$LOG_FILE" 2>&1; then
  log "ERROR: git pull failed, aborting"
  exit 1
fi

# Any external plugin (e.g. pwa-admin-plugin-imanote) rewrites the no-op
# extension-point files (_external/index.ts, externalNavItems.ts, etc.) in
# place; the pull above just reset them to their tracked no-op content. Its
# own install.sh is the only source of truth for those files (see that
# plugin's install.sh comment) — re-run it now, before the build, or the
# build fails on stale imports (a route file the plugin dropped outside this
# repo's git tree, like ImaNote.tsx, still references types the reset just
# removed). Convention: plugin repos are cloned as siblings of this repo's
# own directory, named pwa-admin-plugin-*.
for plugin_dir in "$(dirname "$APP_DIR")"/pwa-admin-plugin-*/; do
  [ -f "${plugin_dir}install.sh" ] || continue
  log "Re-running plugin installer: ${plugin_dir}install.sh"
  if ! bash "${plugin_dir}install.sh" "$APP_DIR" >>"$LOG_FILE" 2>&1; then
    log "ERROR: plugin install failed (${plugin_dir}install.sh), aborting"
    exit 1
  fi
done

if ! npm install >>"$LOG_FILE" 2>&1; then
  log "ERROR: npm install failed, aborting"
  exit 1
fi

if ! npm run build --workspace=packages/shared >>"$LOG_FILE" 2>&1; then
  log "ERROR: build shared failed, aborting"
  exit 1
fi

if ! npm run build:api >>"$LOG_FILE" 2>&1; then
  log "ERROR: build:api failed, aborting"
  exit 1
fi

if ! npm run build:web >>"$LOG_FILE" 2>&1; then
  log "ERROR: build:web failed, aborting"
  exit 1
fi

if ! sudo systemctl restart pwa-admin >>"$LOG_FILE" 2>&1; then
  log "ERROR: service restart failed"
  exit 1
fi

log "Deployed $REMOTE and restarted pwa-admin successfully"
