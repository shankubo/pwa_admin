#!/usr/bin/env bash
set -euo pipefail

# Installation script for pwa-admin, run ON the target server after the code
# has been synced and built (deploy-to-pi.sh, or manually).
#
# Two supported paths:
#   1. Default (no --create-user): runs as an EXISTING low-privilege admin
#      user (already in the `docker` group, and `adm` if nginx logs are
#      group-owned by adm) — the model used by the two current production
#      servers (shan@ubuntu_ext, the Pi). Simpler when you're the sole admin
#      of the box and don't need account isolation.
#   2. --create-user: creates a dedicated system service account (no login
#      shell, system UID range) and runs pwa-admin under that instead of a
#      personal admin login — recommended for NEW installs. See README.md's
#      "Compte dédié" section for the full walkthrough (deploy-to-pi.sh's
#      BUILD_AS_USER argument, sudo -u for create-admin, etc.).
#
# Usage: ./deploy/install.sh <APP_DIR> <SERVICE_USER> [--create-user]

APP_DIR="${1:-$HOME/pwa_admin}"
SERVICE_USER="${2:-$(whoami)}"
CREATE_USER=false
for arg in "$@"; do
  [ "$arg" = "--create-user" ] && CREATE_USER=true
done

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "$CREATE_USER" = true ] && ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  echo "== Creating dedicated system service account ${SERVICE_USER} =="
  # --system: system UID range (sub-1000 on Debian/Ubuntu), not the human
  # range. --shell /usr/sbin/nologin: blocks interactive login without
  # blocking systemd User=, sudo -u, or SSH command execution. --home-dir
  # set to APP_DIR deliberately, so the account's home and the app's install
  # dir are provably the same path — one directory concept, not two that can
  # drift apart. No password is set (useradd leaves the shadow entry locked).
  sudo useradd --system --create-home --home-dir "${APP_DIR}" \
    --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

echo "== Checking ${SERVICE_USER} is in the docker group =="
if ! id -nG "${SERVICE_USER}" | grep -qw docker; then
  if [ "$CREATE_USER" = true ]; then
    sudo usermod -aG docker "${SERVICE_USER}"
  else
    echo "User ${SERVICE_USER} is not in the docker group. Run: sudo usermod -aG docker ${SERVICE_USER}"
    exit 1
  fi
fi

if [ "$CREATE_USER" = true ] && [ "$(stat -c '%G' /var/log/nginx 2>/dev/null || true)" = "adm" ]; then
  if ! id -nG "${SERVICE_USER}" | grep -qw adm; then
    echo "== Adding ${SERVICE_USER} to adm group (nginx logs are group-owned by adm on this box) =="
    sudo usermod -aG adm "${SERVICE_USER}"
  fi
fi

if [ "$CREATE_USER" = true ]; then
  echo "== Preparing ${APP_DIR} for operator rsync + service-account build =="
  # setgid so files the operator rsyncs in, and files the build produces as
  # SERVICE_USER, both end up group-readable/writable by the same group —
  # avoids a second manual chgrp/chmod pass after every sync.
  sudo mkdir -p "${APP_DIR}"
  sudo chgrp "${SERVICE_USER}" "${APP_DIR}"
  sudo chmod 2775 "${APP_DIR}"
fi

echo "== Installing sudoers rules =="
sed "s#__PWA_ADMIN_USER__#${SERVICE_USER}#g; s#__PWA_ADMIN_APP_DIR__#${APP_DIR}#g" \
  "${DEPLOY_DIR}/sudoers.d/pwa-admin.template" | sudo tee /etc/sudoers.d/pwa-admin > /dev/null
sudo chmod 440 /etc/sudoers.d/pwa-admin
sudo visudo -c -f /etc/sudoers.d/pwa-admin

echo "== Installing systemd unit =="
sed "s#/home/shan/pwa_admin#${APP_DIR}#g; s/User=shan/User=${SERVICE_USER}/; s/Group=shan/Group=${SERVICE_USER}/" \
  "${DEPLOY_DIR}/pwa-admin.service" | sudo tee /etc/systemd/system/pwa-admin.service > /dev/null
sudo systemctl daemon-reload

echo "== Installing maintenance-mode page (NGINX_MAINTENANCE_ROOT default: /var/www/server-admin-maintenance) =="
sudo mkdir -p /var/www/server-admin-maintenance
sudo cp "${DEPLOY_DIR}/maintenance-page/index.html" /var/www/server-admin-maintenance/index.html

echo "== Preparing data/secrets directories =="
mkdir -p "${APP_DIR}/data" "${APP_DIR}/secrets"
sudo chown "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}/data" "${APP_DIR}/secrets"

echo "== Ensuring SERVICE_USER is set in ${APP_DIR}/.env =="
# apps/api/src/config/env.ts reads this (not process.env.USER, which systemd
# never populates for a service unit) as the source of truth for chown calls
# that must agree with the sudoers "chown ${SERVICE_USER} ..." rules above.
if [ -f "${APP_DIR}/.env" ]; then
  if grep -q '^SERVICE_USER=' "${APP_DIR}/.env"; then
    sed -i "s/^SERVICE_USER=.*/SERVICE_USER=${SERVICE_USER}/" "${APP_DIR}/.env"
  else
    echo "SERVICE_USER=${SERVICE_USER}" >> "${APP_DIR}/.env"
  fi
else
  echo "(.env not found yet at ${APP_DIR}/.env — remember to add SERVICE_USER=${SERVICE_USER} once you create it)"
fi

echo "== Installing Tailscale cert-renew timer (optional, requires Tailscale already configured) =="
sed "s#__PWA_ADMIN_USER__#${SERVICE_USER}#g; s#__PWA_ADMIN_APP_DIR__#${APP_DIR}#g" \
  "${DEPLOY_DIR}/pwa-admin-cert-renew.service" | sudo tee /etc/systemd/system/pwa-admin-cert-renew.service > /dev/null
sudo cp "${DEPLOY_DIR}/pwa-admin-cert-renew.timer" /etc/systemd/system/pwa-admin-cert-renew.timer
sudo systemctl daemon-reload

echo "== Installing USB backup auto-mount (optional — only used if you enable USB backups) =="
BACKUP_UID="$(id -u "${SERVICE_USER}")"
BACKUP_GID="$(id -g "${SERVICE_USER}")"
sed "s#__PWA_ADMIN_UID__#${BACKUP_UID}#g; s#__PWA_ADMIN_GID__#${BACKUP_GID}#g" \
  "${DEPLOY_DIR}/usb-backup/backup-usb-mount.sh" | sudo tee /usr/local/bin/backup-usb-mount.sh > /dev/null
sudo chmod 755 /usr/local/bin/backup-usb-mount.sh
sudo cp "${DEPLOY_DIR}/usb-backup/backup-usb-mount@.service" /etc/systemd/system/backup-usb-mount@.service
sudo cp "${DEPLOY_DIR}/usb-backup/99-backup-usb.rules" /etc/udev/rules.d/99-backup-usb.rules
sudo systemctl daemon-reload
sudo udevadm control --reload-rules

echo "== Done. Next steps =="
echo "1. Copy deploy/env.server.example to ${APP_DIR}/.env and fill in the JWT secrets (openssl rand -base64 48),"
echo "   then re-run this script (or manually add SERVICE_USER=${SERVICE_USER}) if .env didn't exist yet."
if [ "$CREATE_USER" = true ]; then
  echo "2. Create the first admin (nologin account — must run via sudo -u):"
  echo "   cd ${APP_DIR} && sudo -u ${SERVICE_USER} -H npm run create-admin --workspace=apps/api -- <username> <password>"
else
  echo "2. Create the first admin: cd ${APP_DIR} && npm run create-admin --workspace=apps/api -- <username> <password>"
fi
echo "3. Enable and start: sudo systemctl enable --now pwa-admin"
echo "4. Check status: sudo systemctl status pwa-admin && sudo journalctl -u pwa-admin -f"
echo "5. Optional — enable weekly Tailscale cert renewal: sudo systemctl enable --now pwa-admin-cert-renew.timer"
echo "6. Optional — USB backups: plug a drive in, then check 'mount | grep backup-usb' and enable via the Backups screen."
