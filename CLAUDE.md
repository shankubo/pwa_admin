# Pi Admin PWA — instructions pour Claude Code

PWA mobile complète pour administrer un Raspberry Pi de production (Debian 13 trixie, aarch64) sans SSH : Docker, Nginx, sauvegardes (locales + Google Drive), monitoring système, paquets OS, réseau/sécurité, PM2, matériel. Déployée et testée en continu contre le vrai serveur de production — pas d'environnement de staging séparé.

## Architecture

Monorepo npm workspaces :

```
apps/api          Backend Fastify (Node.js) — sert aussi le frontend buildé + API REST/WS
apps/web          Frontend React + Vite, PWA installable (manifest + service worker)
packages/shared   Types TypeScript partagés (DTOs, protocole WebSocket) entre api et web
deploy/           Unit systemd, règles sudoers scoped, scripts d'installation/déploiement
docs/             Documentation complémentaire
```

Le service `pwa-admin-pi` tourne directement sur le Pi (pas containerisé) sous l'utilisateur `shan` (pas de compte système dédié — serveur mono-admin), écoutant en HTTPS natif sur le port 8443. `apps/api` sert à la fois l'API `/api/*` et les fichiers statiques buildés de `apps/web` (`fastify-static`, fallback SPA vers `index.html`).

### apps/api — modules backend (`apps/api/src/modules/`)

Chaque module suit le pattern `*.routes.ts` (endpoints Fastify) + `*.service.ts` (logique métier) + parfois `*.ws.ts` (canal WebSocket) :

- **auth** — login, 2FA (TOTP via otplib), JWT access+refresh, rate limiting sur login
- **system** — snapshot CPU/RAM/disque/température, stream WS `sys.stats`/`sys.alerts`
- **docker** — containers/images/volumes/networks, logs/stats live (WS `docker.logs`/`docker.stats`), export/import d'images (.tar), backup one-off de volumes
- **nginx** — vhosts (liste/détail/enable/disable), édition config validée (`nginx -t` avant application, historique de versions), reload/restart, logs (WS `nginx.logs`), statut certificat SSL, test d'accessibilité HTTP réel, sauvegarde de la config complète
- **sites** — vue agrégée Nginx + Docker par site
- **network** — ports ouverts (`ss -tulpn`), analytics de trafic (top pages/visiteurs depuis les logs Nginx), fail2ban (statut/ban/unban)
- **os** — info système, paquets installés/upgradables, jobs async update/upgrade avec suivi live (WS `os.upgrade`), paquets held
- **backup** — jobs planifiés (node-cron), sauvegarde volumes/bind-mounts, restauration avec snapshot de sécurité, upload Google Drive, comparaison local↔Drive
- **dbbackup** — détection DB (Docker + natif : MariaDB/MySQL/PostgreSQL/Redis), dump/restore
- **application** — "Applications" composites (conteneur + dossiers + DB), backups full/partiels via `rsync --link-dest`, upload Drive asynchrone avec suivi de progression
- **pm2** — process Node.js gérés par PM2 sur l'hôte (hors Docker) : liste, start/stop/restart/reload, logs live (WS `pm2.logs`)
- **hardware** — modèle Pi, tension, horloge, interfaces réseau/IP, Wi-Fi (scan/connexion via nmcli), statut SSH, services systemd actifs/en échec
- **security** — vue d'ensemble sécurité : UFW, fail2ban, SSH, Tailscale, unattended-upgrades, TLS de l'app, 2FA/JWT
- **audit** — lecture du journal d'audit

Services transverses (`apps/api/src/services/`) : `docker.client.ts` (dockerode), `gdrive.client.ts` (OAuth2 Google Drive), `scheduler.ts` (node-cron), `wsHub.ts` (multiplexage WebSocket).

### apps/web — écrans (`apps/web/src/routes/`)

Dashboard, Docker, Nginx, Sites, OsSystem, Pm2, NetworkSecurity, Security, Applications, Backups, System, Help, About, Settings, Login. Navigation par menu hamburger (`components/layout/AppDrawer.tsx`, `navItems.ts`). Composants UI réutilisables dans `components/ui/` (Card, Button, ConfirmDialog).

### packages/shared

Types TS purs, un fichier par domaine dans `src/types/`, tous ré-exportés depuis `src/index.ts`. **Toujours ajouter un nouveau type ici et l'exporter depuis `index.ts`**, jamais dupliquer un type entre `apps/api` et `apps/web`.

## Conventions établies (à respecter strictement)

### Sécurité — le point non négociable de ce projet

- **Jamais de shell string interpolé.** Seul `runCommand`/`spawnCommand` dans `apps/api/src/utils/exec.ts` est autorisé pour exécuter des commandes système, toujours en argv-array (`execFile`/`spawn`), jamais de concaténation de chaîne shell.
- **Le service ne tourne jamais en root.** Toute élévation passe par des règles `sudoers.d/pwa-admin-pi` **scoped à la commande exacte** (jamais `NOPASSWD: ALL`). Ce fichier a une section par module ; toute nouvelle commande nécessitant sudo doit y être ajoutée avec un commentaire expliquant pourquoi.
- **`Defaults!<liste de binaires> !requiretty,!use_pty`** doit couvrir tout nouveau binaire invoqué via sudo dans les règles scoped — sans ça, `sudo` échoue en environnement non-interactif (le service n'a pas de TTY) avec "a terminal is required". C'est un piège classique : oublier `!use_pty` casse silencieusement une nouvelle règle sudo alors que la syntaxe sudoers est valide.
- **Accès réseau Tailscale-only.** L'app n'est jamais exposée publiquement — voir la section "Accès réseau" du README. Ne jamais suggérer un reverse-proxy public, un port-forward, ou une route Cloudflare Tunnel vers le port 8443.
- Toute action destructive (start/stop/remove Docker, enable/disable/reload Nginx, upgrade/remove paquet OS, ban/unban IP, restore backup, suppression fichier Drive) passe par `withAudit()` (`apps/api/src/middleware/auditLog.ts`) et est journalisée dans `audit_log`.
- Chemins de fichiers (vhosts Nginx, backups) toujours canonicalisés et vérifiés contre une racine autorisée avant tout accès filesystem — anti path-traversal.

### Déploiement et tests

- **Il n'y a pas d'environnement de staging.** Tout changement backend/frontend est testé directement contre le vrai serveur de production (`shan@server`, accessible via Tailscale). C'est le mode de travail accepté sur ce projet.
- Pattern de déploiement de fichiers modifiés vers le Pi : transfert via `base64 -w0 <fichier> | ssh shan@server "base64 -d > ~/<chemin>"` — **jamais** un simple `cat | ssh "cat > ..."`, qui corrompt l'encodage (mojibake) sur les caractères accentués français.
- Après tout changement, rebuild sur le Pi lui-même (jamais de cross-compile depuis Windows — `better-sqlite3` doit compiler sur l'architecture cible) : `npm run build --workspace=packages/shared`, puis `apps/api`, puis `apps/web`, dans cet ordre (shared d'abord, les deux autres en dépendent).
- Redémarrage du service : `sudo systemctl restart pwa-admin-pi`, puis vérifier `sudo journalctl -u pwa-admin-pi -n 20 --no-pager` pour confirmer un démarrage propre.
- **Pattern de test end-to-end** : créer un compte admin de debug temporaire (`npm run create-admin --workspace=apps/api -- <nom> <mdp>`), se logger via curl pour obtenir un JWT, exercer les vrais endpoints contre le vrai état du serveur, vérifier le résultat à la fois via la réponse API et directement en base/filesystem, **puis supprimer le compte de debug** (dans l'ordre `refresh_tokens` → `audit_log` → `users`, contraintes FK) avant de considérer la tâche terminée.
- Toujours `npx tsc --noEmit -p tsconfig.json` sur `apps/api` et `apps/web` (et `npx tsc -p tsconfig.json` sur `packages/shared`) avant de déployer — le CI n'existe pas sur ce projet, c'est la seule vérification automatisée.

### Style de code

- Pas de commentaires inutiles ; quand un commentaire existe, il explique un POURQUOI non-évident (contrainte cachée, workaround, piège), jamais un QUOI que le code montre déjà.
- Les routes Fastify valident systématiquement leur `body` via JSON Schema inline plutôt que de faire confiance aux types TypeScript seuls (les types ne protègent pas au runtime).
- Les mappers DB→API (snake_case → camelCase) vivent dans `apps/api/src/db/models/*.ts` (`xToApiShape()`), jamais de retour direct de lignes SQLite brutes vers le client.
- Les longues opérations (upload Drive, upgrade apt, compression) suivent le pattern "retour immédiat + statut pollé" plutôt que de bloquer la requête HTTP — voir `AppBackupRun.driveUploadStatus` ou `OsJob` comme exemples.
- Interface utilisateur en français (l'app est utilisée par un administrateur francophone) ; les identifiants de code, commentaires et messages de commit restent en anglais.

### Ce qui a déjà cassé une fois (ne pas répéter)

- `fastifyStatic` avec `wildcard: false` casse tout le service de fichiers statiques (fallback SPA sur tout, y compris les vrais assets JS/CSS).
- `NoNewPrivileges=true` dans le unit systemd bloque **tout** sudo, y compris les règles scoped légitimes — ne jamais l'activer sur ce service.
- Le scope OAuth Google Drive doit être `https://www.googleapis.com/auth/drive` (pas `drive.file`) car `GDRIVE_ROOT_FOLDER_ID` pointe vers un dossier créé manuellement par l'admin dans son Drive, pas par l'app — `drive.file` ne donne accès qu'aux fichiers que l'app crée elle-même et empêcherait de lister ce dossier racine.
- Une commande `sudo` qui échoue avec "a terminal is required" en prod alors qu'elle marche en SSH interactif = oubli de `!use_pty` dans l'override sudoers, pas un problème de règle manquante.

## Commandes utiles

```bash
npm run dev:api              # backend en dev (tsx watch)
npm run dev:web               # frontend en dev (vite)
npm run build:api             # build apps/api
npm run build:web             # build apps/web
npm run build --workspace=packages/shared   # build des types partagés (requis avant build:api)
npm run create-admin --workspace=apps/api -- <user> <pass>
```

Voir le README.md pour le détail du déploiement initial et la posture réseau/sécurité complète.
