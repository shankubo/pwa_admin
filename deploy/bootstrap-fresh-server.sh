#!/usr/bin/env bash
set -euo pipefail

# Bootstraps pwa-admin from ZERO on a brand-new Debian/Ubuntu box — the
# hardware-swap / disaster-recovery path (Raspberry Pi/PC replacement). Run
# this directly ON the new machine, as a user with sudo access and either a
# keyboard/screen or an SSH session already reachable by some means OTHER
# than Tailscale (Tailscale isn't set up yet on this box — that's the whole
# point of Phase 5 below).
#
# Standalone on purpose: pwa-admin itself can't drive this, because it isn't
# installed here yet. This script's only job is to get a plain `git pull` +
# `npm run build` + `systemctl start pwa-admin` away from a working install —
# everything else (Docker containers/images, volumes, databases, nginx
# vhosts, Applications) is restored by pwa-admin ITSELF once it's running,
# via Restore > Migration serveur, reading the manifest.json this script only
# locates and validates (never parses/restores individual items — that's
# deliberately left to the existing, tested restore endpoints in the app).
#
# Two things this script can NEVER automate away, by design — both are called
# out below when reached, not silently skipped:
#   - Tailscale device auth: `tailscale up` prints a URL a human must open on
#     ANOTHER already-authenticated device/browser and approve. No auth-key
#     is read from the migration manifest (an auth-key on a lost/stolen USB
#     drive would be a standing tailnet-access credential — too risky for
#     what's meant to be a rare recovery script). Pass --authkey yourself at
#     invocation time if you generated a one-off key in the Tailscale admin
#     console beforehand; otherwise you'll be prompted interactively.
#   - Initial sudo/console access to this blank machine — a prerequisite of
#     running this script at all, not something it can bootstrap itself.
#
# Usage:
#   ./bootstrap-fresh-server.sh <APP_DIR> <SERVICE_USER> [--authkey KEY]
#
# Example:
#   ./bootstrap-fresh-server.sh /home/pwa-admin-svc pwa-admin-svc

APP_DIR="${1:?Usage: bootstrap-fresh-server.sh <APP_DIR> <SERVICE_USER> [--authkey KEY]}"
SERVICE_USER="${2:?Usage: bootstrap-fresh-server.sh <APP_DIR> <SERVICE_USER> [--authkey KEY]}"
TAILSCALE_AUTHKEY=""
prev=""
for i in "$@"; do
  if [ "$prev" = "--authkey" ]; then TAILSCALE_AUTHKEY="$i"; fi
  prev="$i"
done

REPO_URL="https://github.com/shankubo/pwa_admin.git"

log() { echo "== $1 =="; }

# --- Phase 0: prerequisites ---------------------------------------------
log "Phase 0 — Verifications prealables"

if [ "$(id -u)" -eq 0 ]; then
  echo "Ne pas lancer ce script en tant que root directement — utilisez un compte avec sudo." >&2
  exit 1
fi
if ! sudo -n true 2>/dev/null && ! sudo -v; then
  echo "Ce script necessite un acces sudo interactif." >&2
  exit 1
fi
if [ ! -f /etc/os-release ] || ! grep -qE '^ID(_LIKE)?=.*\b(debian|ubuntu)\b' /etc/os-release; then
  echo "Ce script ne cible que Debian/Ubuntu (/etc/os-release non reconnu)." >&2
  exit 1
fi

echo "Branchez le disque USB contenant l'instantane de migration (manifest.json)."
read -rp "Point de montage du disque USB [auto-detection si vide]: " USB_MOUNT
if [ -z "$USB_MOUNT" ]; then
  # Best-effort auto-detect: any USB-transport block device currently mounted.
  USB_MOUNT="$(lsblk -J -o MOUNTPOINT,TRAN 2>/dev/null | \
    grep -B1 '"tran": "usb"' | grep -oE '"/[^"]*"' | tr -d '"' | head -n1 || true)"
fi
if [ -z "$USB_MOUNT" ] || [ ! -d "$USB_MOUNT" ]; then
  echo "Disque USB introuvable. Relancez en indiquant le point de montage exact." >&2
  exit 1
fi

MANIFEST_PATH="$(find "$USB_MOUNT" -maxdepth 6 -path '*/migration/*/manifest.json' 2>/dev/null | sort | tail -n1 || true)"
if [ -z "$MANIFEST_PATH" ] || [ ! -f "$MANIFEST_PATH" ]; then
  echo "Aucun manifest.json de migration trouve sous ${USB_MOUNT}/BACKUP/<hostname>/migration/." >&2
  echo "Verifiez que vous avez bien pris un instantane de migration sur l'ancien serveur (Backups > Migration serveur)." >&2
  exit 1
fi
log "Manifeste trouve: ${MANIFEST_PATH}"

# --- Phase 0.5: dependency audit ----------------------------------------
log "Phase 0.5 — Audit des dependances"

HAS_DOCKER=false; HAS_NODE=false; HAS_NGINX=false; HAS_TAILSCALE=false
command -v docker >/dev/null 2>&1 && HAS_DOCKER=true
command -v node >/dev/null 2>&1 && HAS_NODE=true
command -v nginx >/dev/null 2>&1 && HAS_NGINX=true
command -v tailscale >/dev/null 2>&1 && HAS_TAILSCALE=true

MISSING_BASE=""
for bin in curl git gnupg rsync; do
  command -v "$bin" >/dev/null 2>&1 || MISSING_BASE="${MISSING_BASE} ${bin}"
done

printf '%-12s %s\n' "Docker" "$([ "$HAS_DOCKER" = true ] && docker --version || echo manquant)"
printf '%-12s %s\n' "Node.js" "$([ "$HAS_NODE" = true ] && node --version || echo manquant)"
printf '%-12s %s\n' "nginx" "$([ "$HAS_NGINX" = true ] && nginx -v 2>&1 || echo manquant)"
printf '%-12s %s\n' "Tailscale" "$([ "$HAS_TAILSCALE" = true ] && tailscale version | head -n1 || echo manquant)"
printf '%-12s %s\n' "Paquets base" "$([ -z "$MISSING_BASE" ] && echo "tous presents" || echo "manquants:${MISSING_BASE}")"

read -rp "Installer les elements manquants ci-dessus ? [o/N] " CONFIRM_INSTALL
if [ "$CONFIRM_INSTALL" != "o" ] && [ "$CONFIRM_INSTALL" != "O" ]; then
  echo "Abandon — rien n'a ete modifie."
  exit 0
fi

# --- Phase 1: base OS packages -------------------------------------------
if [ -n "$MISSING_BASE" ]; then
  log "Phase 1 — Paquets systeme de base"
  sudo apt-get update
  sudo apt-get install -y curl git ca-certificates gnupg rsync
else
  log "Phase 1 — Paquets de base deja presents, ignore"
fi

# --- Phase 2: Docker -------------------------------------------------------
if [ "$HAS_DOCKER" = false ]; then
  log "Phase 2 — Installation de Docker"
  curl -fsSL https://get.docker.com | sudo sh
else
  log "Phase 2 — Docker deja present, ignore"
fi
if ! id -nG "$SERVICE_USER" 2>/dev/null | grep -qw docker; then
  log "Ajout de ${SERVICE_USER} au groupe docker"
  sudo usermod -aG docker "$SERVICE_USER" 2>/dev/null || true
fi

# --- Phase 3: Node.js -------------------------------------------------------
if [ "$HAS_NODE" = false ]; then
  log "Phase 3 — Installation de Node.js (NodeSource, LTS)"
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  log "Phase 3 — Node.js deja present, ignore"
fi

# --- Phase 4: nginx ----------------------------------------------------
if [ "$HAS_NGINX" = false ]; then
  log "Phase 4 — Installation de nginx"
  sudo apt-get install -y nginx
else
  log "Phase 4 — nginx deja present, ignore"
fi

# --- Phase 5: Tailscale (interactive auth checkpoint) -----------------------
log "Phase 5 — Tailscale"
if [ "$HAS_TAILSCALE" = false ]; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
if sudo tailscale status >/dev/null 2>&1; then
  log "Tailscale deja authentifie sur cette machine, auth ignoree"
else
  echo ""
  echo "*** ETAPE INTERACTIVE REQUISE ***"
  if [ -n "$TAILSCALE_AUTHKEY" ]; then
    sudo tailscale up --authkey "$TAILSCALE_AUTHKEY"
  else
    echo "Une URL d'authentification va s'afficher — ouvrez-la sur un appareil deja"
    echo "connecte a votre tailnet et approuvez-la."
    sudo tailscale up
    read -rp "Appuyez sur Entree une fois l'authentification Tailscale confirmee..." _
  fi
fi

# --- Phase 6: clone + build pwa-admin ---------------------------------------
log "Phase 6 — Clonage et build de pwa-admin"
if [ -d "${APP_DIR}/.git" ]; then
  echo "${APP_DIR} contient deja un clone git — build sur l'existant."
else
  sudo mkdir -p "$APP_DIR"
  sudo chown "$(id -u):$(id -g)" "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi
(
  cd "$APP_DIR"
  npm install
  npm run build --workspace=packages/shared
  npm run build --workspace=apps/api
  npm run build --workspace=apps/web
)

# --- Phase 7: existing install.sh -------------------------------------------
log "Phase 7 — deploy/install.sh"
"${APP_DIR}/deploy/install.sh" "$APP_DIR" "$SERVICE_USER" --create-user

# --- Phase 8: .env + restore pwa-admin's own config + start ----------------
log "Phase 8 — Configuration .env et demarrage"
if [ ! -f "${APP_DIR}/.env" ]; then
  sudo -u "$SERVICE_USER" cp "${APP_DIR}/deploy/env.server.example" "${APP_DIR}/.env"
  JWT1="$(openssl rand -base64 48)"
  JWT2="$(openssl rand -base64 48)"
  sudo -u "$SERVICE_USER" sed -i \
    -e "s#^JWT_ACCESS_SECRET=.*#JWT_ACCESS_SECRET=${JWT1}#" \
    -e "s#^JWT_REFRESH_SECRET=.*#JWT_REFRESH_SECRET=${JWT2}#" \
    -e "s#^SERVICE_USER=.*#SERVICE_USER=${SERVICE_USER}#" \
    "${APP_DIR}/.env"
  echo "Un .env minimal a ete genere — TLS_CERT_PATH/TLS_KEY_PATH/BACKUP_LOCAL_ROOT restent a ajuster manuellement (voir deploy/env.server.example)."
fi

# The ONLY restore step done in bash — pwa-admin can't restore its own
# config before it's running. Everything else (Docker, DB, nginx vhosts,
# Applications) is deliberately left to pwa-admin itself once started (see
# Phase 9's reminder), via MigrationService.restoreFromManifest.
PWA_ADMIN_CONFIG_ITEM="$(grep -A4 '"category": "pwa-admin-config"' "$MANIFEST_PATH" | grep '"archiveRelPath"' | head -n1 | sed -E 's/.*"archiveRelPath": *"([^"]*)".*/\1/' || true)"
if [ -n "$PWA_ADMIN_CONFIG_ITEM" ] && [ -f "$PWA_ADMIN_CONFIG_ITEM" ]; then
  log "Restauration de .env + secrets/ depuis le manifeste"
  sudo tar xzf "$PWA_ADMIN_CONFIG_ITEM" -C "$APP_DIR"
  sudo chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}/.env" "${APP_DIR}/secrets"
else
  echo "Aucune configuration pwa-admin (.env/secrets) trouvee dans le manifeste — le .env genere ci-dessus reste actif, a completer manuellement."
fi

sudo systemctl enable --now pwa-admin

echo ""
read -rp "Nom d'utilisateur admin a creer: " ADMIN_USER
read -rsp "Mot de passe admin: " ADMIN_PASS
echo ""
(cd "$APP_DIR" && sudo -u "$SERVICE_USER" -H npm run create-admin --workspace=apps/api -- "$ADMIN_USER" "$ADMIN_PASS")

# --- Phase 9: summary --------------------------------------------------
log "Phase 9 — Recapitulatif"
TS_DOMAIN="$(sudo tailscale status --json 2>/dev/null | grep -m1 '"DNSName"' | sed -E 's/.*"DNSName": *"([^"]*)\.".*/\1/' || true)"
echo "pwa-admin est demarre. Verifiez: sudo journalctl -u pwa-admin -n 20 --no-pager"
if [ -n "$TS_DOMAIN" ]; then
  echo "URL probable une fois le certificat emis: https://${TS_DOMAIN}.<votre-tailnet>.ts.net:8443"
fi
echo ""
echo "Prochaines etapes MANUELLES (non automatisables depuis ce script) :"
echo "  1. Emettre un nouveau certificat TLS Tailscale (l'ancien n'est pas portable):"
echo "     sudo tailscale cert <nom-de-cette-machine>.<tailnet>.ts.net"
echo "     puis renseigner TLS_CERT_PATH/TLS_KEY_PATH dans ${APP_DIR}/.env et redemarrer pwa-admin."
echo "  2. Connectez-vous a pwa-admin, allez dans Restore > Migration serveur, choisissez"
echo "     l'instantane sur ${USB_MOUNT}, et lancez la restauration (conteneurs/images Docker,"
echo "     volumes, bases de donnees, config Nginx, Applications)."
echo "  3. Gardez le disque USB branche jusqu'a la fin de cette restauration."
