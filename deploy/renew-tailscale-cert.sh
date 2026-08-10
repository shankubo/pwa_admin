#!/usr/bin/env bash
set -euo pipefail

# Renews the Tailscale HTTPS certificate used by pwa-admin and restarts the
# service so it picks up the fresh cert. Tailscale certs are Let's Encrypt
# backed and expire ~90 days out; `tailscale cert` is idempotent and safe to
# run repeatedly (it renews if the cert is close to expiry, no-ops otherwise).

APP_DIR="${1:-$HOME/pwa_admin}"
CERT_DIR="$APP_DIR/secrets/tailscale-cert"
DOMAIN="$(tailscale status --json | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["Self"]["DNSName"].rstrip("."))')"

mkdir -p "$CERT_DIR"
cd "$CERT_DIR"
sudo tailscale cert "$DOMAIN"
sudo chown "$(whoami)":"$(whoami)" "$DOMAIN.crt" "$DOMAIN.key"
chmod 644 "$DOMAIN.crt"
chmod 600 "$DOMAIN.key"

sudo systemctl restart pwa-admin
echo "Tailscale cert renewed/verified for $DOMAIN, service restarted."
