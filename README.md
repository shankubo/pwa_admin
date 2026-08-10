# Server Admin PWA

PWA mobile complète pour administrer un serveur Linux (Raspberry Pi ou VM/serveur Debian/Ubuntu) : sites web (Nginx), Docker (conteneurs + sauvegardes de bases de données), sauvegardes locales et Google Drive, monitoring système (CPU/RAM/disque/température), gestion des paquets Debian/OS, et sécurité réseau (ports, fail2ban).

Voir le plan d'implémentation complet pour l'architecture détaillée, l'ordre des phases et les décisions de conception.

## Structure

- `apps/api` — backend Fastify (Node.js), sert aussi le frontend buildé et l'API REST/WebSocket.
- `apps/web` — frontend React + Vite, PWA installable.
- `packages/shared` — types TypeScript partagés entre l'API et le frontend.
- `deploy/` — unit systemd, règles sudoers scoped, scripts d'installation et de déploiement.

## Développement (machine de dev)

```bash
npm install
npm run build --workspace=packages/shared   # compile les types partagés (nécessaire avant dev:api)
cp .env.example .env   # puis générer des secrets JWT (openssl rand -base64 48)

npm run dev:api   # démarre le backend Fastify sur le port 8443
npm run dev:web   # démarre le frontend Vite (proxy /api vers le backend)
```

> **Note Windows** : `better-sqlite3` (module natif) nécessite les Visual Studio Build Tools pour compiler sur Windows. Sur le Raspberry Pi (Debian ARM avec gcc/make/python3), ce problème ne se pose pas. Le typecheck (`tsc --noEmit`) et le build du frontend PWA sont validés sans ce module sur une machine de dev Windows ; le démarrage réel du serveur est à tester sur le Pi (ou après installation des Build Tools).

## Déploiement sur le serveur

Le déploiement se fait en syncant le code source puis en buildant **sur la machine cible elle-même** (les modules natifs comme `better-sqlite3` doivent compiler sur l'architecture cible — cross-compiler depuis Windows serait fragile).

```bash
./deploy/deploy-to-pi.sh shan@ubuntu_ext
# puis, sur le serveur :
ssh ubuntu_ext
cd ~/pwa_admin
cp deploy/env.server.example .env    # puis remplir les secrets JWT
./deploy/install.sh                   # installe sudoers.d + unit systemd
npm run create-admin --workspace=apps/api -- <username> <password>
sudo systemctl enable --now pwa-admin
sudo journalctl -u pwa-admin -f
```

Le service tourne sous l'utilisateur admin existant (pas de compte système séparé sur un serveur mono-admin), avec des permissions élevées strictement scoped via `deploy/sudoers.d/pwa-admin` (nginx reload/restart, apt update/upgrade, fail2ban ban/unban, `ss` — jamais un accès root complet ni le service lancé en root).

## État actuel

Toutes les phases du plan sont implémentées :

- **Auth** : login + 2FA TOTP + JWT (access + refresh), rate limiting.
- **System** : monitoring temps réel (CPU/RAM/disque/température/throttling) via WebSocket, alertes par seuils.
- **Docker** : containers/images/volumes/networks, start/stop/restart/remove, logs et stats live, prune.
- **Nginx** : vhosts (liste/détail/enable/disable), édition de config avec validation `nginx -t` + historique de versions + rollback, reload/restart, logs live, statut certificats SSL.
- **Sites** : vue agrégée Nginx + Docker par site.
- **Backups** : jobs planifiés (node-cron), sauvegarde de volumes Docker (conteneur alpine jetable), sauvegarde de bases de données dans des conteneurs (Postgres/MySQL/MariaDB/Mongo/Redis), restauration avec snapshot de sécurité automatique, upload Google Drive (Service Account), rétention configurable.
- **OS/Debian** : info système, paquets installés/upgradables, jobs asynchrones update-check/upgrade avec suivi live, gestion des paquets held.
- **Réseau & Sécurité** : ports ouverts, analytics de trafic (top pages, visiteurs) dérivées des logs Nginx, blocage/déblocage d'IP via fail2ban.
- **PWA** : manifest + service worker (network-only sur `/api`), navigation par menu hamburger, installable.

## Sécurité

- Aucune commande shell n'est jamais construite par concaténation de chaîne : `execFile`/`spawn` en argv-array uniquement (`apps/api/src/utils/exec.ts`).
- Chemins de fichiers Nginx canonicalisés et vérifiés contre les racines configurées (anti path traversal).
- Toutes les actions destructives (start/stop/remove Docker, enable/disable/reload Nginx, upgrade/remove paquet OS, ban/unban IP, restore backup) sont journalisées dans `audit_log` (visible via `/api/audit` et l'écran Settings).
- 2FA TOTP recommandé pour tout compte administrateur.

### Accès réseau : Tailscale uniquement, jamais public

Cette app a un contrôle total sur Docker/Nginx/apt/pare-feu — elle ne doit **jamais** être exposée publiquement (pas de route Cloudflare Tunnel, pas de reverse-proxy public vers le port 8443). L'accès admin passe exclusivement par [Tailscale](https://tailscale.com), qui crée un VPN mesh privé où le port n'est joignable que depuis les appareils déjà authentifiés sur le tailnet — aucun paquet d'un attaquant sur Internet n'atteint même le port.

**Mise en place (déjà faite sur `shan@ubuntu_ext` / fr01pc999)** :

1. **Pare-feu (UFW)** : le port 8443 est explicitement `DENY` depuis le LAN (`192.168.1.0/24`) et le VPN WireGuard existant (`10.66.66.0/24`), et `ALLOW` uniquement depuis la plage Tailscale (`100.64.0.0/10`). Toute autre IP reste bloquée par la politique par défaut (`deny incoming`). Règles dans `sudo ufw status numbered`.
2. **HTTPS via certificat Tailscale** : `tailscale cert <machine>.<tailnet>.ts.net` génère un vrai certificat Let's Encrypt (validé par les navigateurs, pas d'avertissement) stocké dans `secrets/tailscale-cert/` et référencé par `TLS_CERT_PATH`/`TLS_KEY_PATH` dans `.env`. Le serveur Fastify écoute alors en HTTPS natif.
3. **Renouvellement automatique** : `deploy/pwa-admin-cert-renew.timer` (systemd timer, hebdomadaire) relance `deploy/renew-tailscale-cert.sh`, qui régénère le certificat si besoin et redémarre le service. Vérifier avec `sudo systemctl list-timers pwa-admin-cert-renew.timer`.

**Accès depuis vos appareils** : installez Tailscale sur votre téléphone/PC, connectez-vous au même compte (`votre.adresse_mail@...`), puis ouvrez `https://<machine>.<tailnet>.ts.net:8443` (ou l'IP Tailscale `https://100.x.x.x:8443`). Fonctionne aussi bien en 4G/5G qu'en Wi-Fi — Tailscale route le trafic peu importe le réseau physique.

**Ce qu'il ne faut jamais faire** : ajouter une route publique Cloudflare Tunnel vers le port 8443, ouvrir 8443 dans la box/routeur (port forwarding), ou l'ajouter à une config Nginx avec un `server_name` public. Ces trois erreurs exposeraient l'app à tout Internet malgré le pare-feu applicatif (2FA, rate limiting) — le pare-feu réseau (UFW + Tailscale) est la protection principale, pas une seconde ligne de défense optionnelle.
