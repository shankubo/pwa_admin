#!/usr/bin/env bash
set -euo pipefail

# Installation script for pwa-admin-pi, run ON the Raspberry Pi after
# deploy-to-pi.sh has synced and built the app.
#
# This variant assumes the service runs as an existing low-privilege admin
# user (already in the `docker` group, and `adm` if nginx logs are group-owned
# by adm) rather than creating a fresh piadmin-svc system user — simpler when
# you're the sole admin of the box. See pwa-admin-pi.service's User=/Group=
# before running this if your setup differs.

APP_DIR="${1:-$HOME/pwa_admin_pi}"
SERVICE_USER="${2:-$(whoami)}"

echo "== Checking ${SERVICE_USER} is in the docker group =="
if ! id -nG "${SERVICE_USER}" | grep -qw docker; then
  echo "User ${SERVICE_USER} is not in the docker group. Run: sudo usermod -aG docker ${SERVICE_USER}"
  exit 1
fi

echo "== Installing sudoers rules =="
sudo cp "$(dirname "$0")/sudoers.d/pwa-admin-pi" /etc/sudoers.d/pwa-admin-pi
sudo chmod 440 /etc/sudoers.d/pwa-admin-pi
sudo visudo -c -f /etc/sudoers.d/pwa-admin-pi

echo "== Installing systemd unit =="
sed "s#/home/shan/pwa_admin_pi#${APP_DIR}#g; s/User=shan/User=${SERVICE_USER}/; s/Group=shan/Group=${SERVICE_USER}/" \
  "$(dirname "$0")/pwa-admin-pi.service" | sudo tee /etc/systemd/system/pwa-admin-pi.service > /dev/null
sudo systemctl daemon-reload

echo "== Done. Next steps =="
echo "1. Copy deploy/env.server.example to ${APP_DIR}/.env and fill in the JWT secrets (openssl rand -base64 48)"
echo "2. Create the first admin: cd ${APP_DIR} && npm run create-admin --workspace=apps/api -- <username> <password>"
echo "3. Enable and start: sudo systemctl enable --now pwa-admin-pi"
echo "4. Check status: sudo systemctl status pwa-admin-pi && sudo journalctl -u pwa-admin-pi -f"
