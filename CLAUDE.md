# Server Admin PWA — instructions pour Claude Code

PWA mobile complète pour administrer un serveur Linux de production sans SSH : Docker, Nginx, sauvegardes/restauration (locales + USB/SSD + Google Drive), monitoring système, paquets OS, réseau/sécurité, PM2, services (Tailscale/Docker/PM2), matériel. Déployée et testée en continu contre un vrai serveur de production (Ubuntu x86_64, accessible via Tailscale) — pas d'environnement de staging séparé.

**Dépôt public** (`github.com/shankubo/pwa_admin`, renommé depuis `pwa-admin-pi`) — voir [INSTALL.md](INSTALL.md) pour le guide d'installation destiné aux nouveaux utilisateurs. Aucun secret n'a jamais été commité (audit complet effectué avant la mise en public) ; les noms de serveur/compte réels ont été génériques dans la doc courante — l'historique git antérieur au passage en public conserve encore d'anciens noms, sans impact sur la sécurité puisque l'accès à l'app reste protégé par Tailscale + JWT + 2FA, jamais par l'obscurité du code.

## Architecture

Monorepo npm workspaces :

```
apps/api          Backend Fastify (Node.js) — sert aussi le frontend buildé + API REST/WS
apps/web          Frontend React + Vite, PWA installable (manifest + service worker)
packages/shared   Types TypeScript partagés (DTOs, protocole WebSocket) entre api et web
deploy/           Unit systemd, règles sudoers scoped, scripts d'installation/déploiement
docs/             Documentation complémentaire
```

Le service `pwa-admin` tourne directement sur le serveur (pas containerisé), écoutant en HTTPS natif sur le port 8443, sous un compte système dédié à l'app (`nologin`, UID système, créé via `deploy/install.sh --create-user`) — voir README.md section "Compte dédié". Un déploiement plus ancien peut encore tourner sous un compte admin personnel existant (pas de compte système dédié) ; `install.sh` sans `--create-user` reste le chemin compatible pour ce cas. `apps/api` sert à la fois l'API `/api/*` et les fichiers statiques buildés de `apps/web` (`fastify-static`, fallback SPA vers `index.html`).

### apps/api — modules backend (`apps/api/src/modules/`)

Chaque module suit le pattern `*.routes.ts` (endpoints Fastify) + `*.service.ts` (logique métier) + parfois `*.ws.ts` (canal WebSocket) :

- **auth** — login, 2FA (TOTP via otplib), JWT access+refresh, rate limiting sur login
- **system** — snapshot CPU/RAM/disque/température, stream WS `sys.stats`/`sys.alerts`
- **docker** — containers/images/volumes/networks, logs/stats live (WS `docker.logs`/`docker.stats`), export/import d'images (.tar), backup one-off de volumes
- **nginx** — vhosts (liste/détail/enable/disable), édition config validée (`nginx -t` avant application, historique de versions), reload/restart, logs (WS `nginx.logs`), statut certificat SSL, test d'accessibilité HTTP réel, sauvegarde de la config complète, mode maintenance par site (bascule `location` vers une page statique `/var/www/server-admin-maintenance`, cf. `applyMaintenanceMode` dans `nginx.parser.ts`)
- **sites** — vue agrégée Nginx + Docker par site
- **network** — ports ouverts (`ss -tulpn`), analytics de trafic (top pages/visiteurs depuis les logs Nginx), fail2ban (statut/ban/unban)
- **os** — info système, paquets installés/upgradables, jobs async update/upgrade avec suivi live (WS `os.upgrade`), paquets held
- **backup** — jobs planifiés (node-cron), sauvegarde volumes/bind-mounts, restauration avec snapshot de sécurité, upload Google Drive, comparaison local↔Drive, disque USB/SSD externe (détection/montage auto via udev, copie/parcours d'archives), upload depuis le PC admin (multipart → ligne `backup_history` restaurable), suppression de sauvegarde, téléchargement via token JWT courte durée (le body d'une requête GET ne peut pas porter un header Authorization pour un lien direct)
- **dbbackup** — détection DB (Docker + natif : MariaDB/MySQL/PostgreSQL/Redis), dump/restore
- **application** — "Applications" composites (conteneurs + dossiers + volumes Docker nommés + DB), backups full/partiels via `rsync --link-dest`, export/restauration d'image de conteneur (`docker save`/`load` + recreate sûr : le remplaçant est créé et vérifié avant que l'ancien conteneur soit arrêté), upload Drive asynchrone avec suivi de progression
- **pm2** — process Node.js gérés par PM2 sur l'hôte (hors Docker) : liste, start/stop/restart/reload, logs live (WS `pm2.logs`)
- **hardware** — modèle Pi, tension, horloge, interfaces réseau/IP, Wi-Fi (scan/connexion via nmcli), statut SSH, services systemd actifs/en échec
- **security** — vue d'ensemble sécurité : UFW, fail2ban, SSH, Tailscale, unattended-upgrades, TLS de l'app, 2FA/JWT
- **services** — statut + actions de mise à jour/redémarrage pour Tailscale/Docker/PM2 (réutilise `SecurityService.getTailscaleStatus()` et `Pm2Service.list()`, ne duplique pas leur logique de détection)
- **audit** — lecture du journal d'audit

Services transverses (`apps/api/src/services/`) : `docker.client.ts` (dockerode), `gdrive.client.ts` (OAuth2 Google Drive), `scheduler.ts` (node-cron), `wsHub.ts` (multiplexage WebSocket).

### apps/web — écrans (`apps/web/src/routes/`)

Dashboard, Docker, Nginx, Sites, OsSystem, Pm2, NetworkSecurity, Security, Applications, Backups, Restore, System, Services, Help, About, Settings, Login. Navigation par menu hamburger (`components/layout/AppDrawer.tsx`, `navItems.ts`). Composants UI réutilisables dans `components/ui/` (Card, Button, ConfirmDialog).

**Backups vs Restore — séparation volontaire.** Backups ne fait que créer/supprimer des sauvegardes ; Restore est le seul endroit de l'app qui peut écraser des données, via un assistant en 3 étapes (source → archive groupée par catégorie → confirmation typée "RESTORE"). Ne jamais réintroduire une action de restauration dans Backups/Applications — c'est un choix délibéré pour réduire le risque de clic accidentel.

`components/layout/PullToRefresh.tsx` (enveloppe `<Outlet/>` dans `Shell.tsx`) : tirer l'écran vers le bas et maintenir ~3s force un `window.location.reload()` complet — pas un simple refetch — pour récupérer un service worker à jour après déploiement. `components/layout/ServerSwitcher.tsx` + `stores/serverConnections.store.ts` : sélecteur multi-serveur purement client (localStorage), chaque entrée est un déploiement pwa-admin totalement indépendant (pas de backend partagé) ; changer de serveur redirige vers son propre `/login` car le refresh-token cookie ne traverse pas les origines.

**Duplication de site + bascule manuelle (failover)** — outil de reprise après sinistre déclenché par l'admin, pas un health-check automatique. `SiteDuplicateService` (`apps/api/src/modules/sites/siteDuplicate.service.ts`) clone le contenu d'un site (`sudo rsync`, scopé à `/var/www/*`), sa base de données (dump mono-base + restauration sous un nom `<nom>__duplicate` via `DbBackupService.dumpSingleDatabase`/`restoreSingleDatabaseAs`, nouvelles fonctions distinctes du dump/restore `--all-databases` existant), et un conteneur applicatif lié (`docker.createContainer` à partir de la même image, port libre auto-assigné, tourne en permanence en parallèle de l'original — pas créé à la demande). La bascule (`NginxService.switchToDuplicate`/`switchToPrimary`) réécrit `root`/`proxy_pass` dans la config active via `applyFailoverRewrite` (`nginx.parser.ts`, sœur de `applyMaintenanceMode` — substitue les valeurs de directives sans toucher aux blocs `location`), en suivant exactement le mécanisme snapshot→test→revert-on-failure du mode maintenance. Gardes croisées dans les deux sens entre maintenance et bascule failover sur un même vhost (états combinés interdits). Tables `site_duplicates`/`vhost_failover` (migration `id: 10`).

### packages/shared

Types TS purs, un fichier par domaine dans `src/types/`, tous ré-exportés depuis `src/index.ts`. **Toujours ajouter un nouveau type ici et l'exporter depuis `index.ts`**, jamais dupliquer un type entre `apps/api` et `apps/web`.

## Conventions établies (à respecter strictement)

### Sécurité — le point non négociable de ce projet

- **Jamais de shell string interpolé.** Seul `runCommand`/`spawnCommand` dans `apps/api/src/utils/exec.ts` est autorisé pour exécuter des commandes système, toujours en argv-array (`execFile`/`spawn`), jamais de concaténation de chaîne shell.
- **Le service ne tourne jamais en root.** Toute élévation passe par des règles `sudoers.d/pwa-admin` **scoped à la commande exacte** (jamais `NOPASSWD: ALL`). Ce fichier a une section par module ; toute nouvelle commande nécessitant sudo doit y être ajoutée avec un commentaire expliquant pourquoi.
- **`Defaults!<liste de binaires> !requiretty,!use_pty`** doit couvrir tout nouveau binaire invoqué via sudo dans les règles scoped — sans ça, `sudo` échoue en environnement non-interactif (le service n'a pas de TTY) avec "a terminal is required". C'est un piège classique : oublier `!use_pty` casse silencieusement une nouvelle règle sudo alors que la syntaxe sudoers est valide.
- **Accès réseau Tailscale-only.** L'app n'est jamais exposée publiquement — voir la section "Accès réseau" du README. Ne jamais suggérer un reverse-proxy public, un port-forward, ou une route Cloudflare Tunnel vers le port 8443.
- Toute action destructive (start/stop/remove Docker, enable/disable/reload Nginx, upgrade/remove paquet OS, ban/unban IP, restore backup, suppression fichier Drive) passe par `withAudit()` (`apps/api/src/middleware/auditLog.ts`) et est journalisée dans `audit_log`.
- Chemins de fichiers (vhosts Nginx, backups) toujours canonicalisés et vérifiés contre une racine autorisée avant tout accès filesystem — anti path-traversal.

### Déploiement et tests

- **Il n'y a pas d'environnement de staging.** Tout changement backend/frontend est testé directement contre un vrai serveur de production, accessible via Tailscale. C'est le mode de travail accepté sur ce projet.
- **Déploiement = `git push` puis `git pull` côté serveur**, pas de transfert de fichier individuel : `git add -A && git commit && git push origin master` en local, puis sur le serveur `cd <APP_DIR> && git fetch origin master -q && git checkout -f origin/master -B master`. Le dossier de déploiement sur le serveur est un clone git à part entière (remote via SSH `git@github.com:...`), pas juste un arbre de fichiers synchronisés — `.env`, `data/`, `secrets/`, `node_modules/` sont dans `.gitignore` donc jamais écrasés par ce flux.
- **Auth git d'un compte de service (`--create-user`) : Deploy Key dédiée, pas la clé de l'opérateur.** Un compte `nologin` créé via `--create-user` n'a pas de clé SSH GitHub propre par défaut — générer une paire dédiée (`sudo -u <compte> -H ssh-keygen -t ed25519 -f <APP_DIR>/.ssh/id_ed25519 -N ""`, sans passphrase puisqu'il n'y a pas de shell interactif pour la saisir), l'ajouter comme Deploy Key **lecture seule** sur le repo (`gh repo deploy-key add`), jamais partager/copier la clé personnelle de l'opérateur — garde l'isolation du compte de service même côté auth git.
- Après tout changement, rebuild sur le serveur lui-même (jamais de cross-compile depuis Windows — `better-sqlite3` doit compiler sur l'architecture cible) : `npm run build --workspace=packages/shared`, puis `apps/api`, puis `apps/web`, dans cet ordre (shared d'abord, les deux autres en dépendent).
- Redémarrage du service : `sudo systemctl restart pwa-admin` — **nécessite un mot de passe sudo interactif**, le compte de service n'a pas de règle NOPASSWD pour `systemctl restart pwa-admin` (volontaire : le service ne doit pas pouvoir se redémarrer lui-même sans confirmation humaine). Ne jamais essayer de contourner ça — toujours demander à l'utilisateur de lancer cette commande lui-même dans son propre terminal. Vérifier ensuite `sudo journalctl -u pwa-admin -n 20 --no-pager` pour confirmer un démarrage propre.
- **Exception explicite et unique à cette règle** : `deploy/auto-update.sh` (polling cron toutes les quelques minutes, installé manuellement sur les seuls serveurs où on le souhaite) compare `HEAD` à `origin/master`, et si en retard, fait `git pull --ff-only` + rebuild (shared→api→web) + `sudo systemctl restart pwa-admin` de façon autonome. C'est un choix délibéré (pas de webhook GitHub possible : l'app est Tailscale-only, GitHub ne peut pas atteindre une IP Tailscale privée, donc polling local plutôt qu'un tunnel public). Ceci nécessite la règle sudoers `<compte> ALL=(root) NOPASSWD: /bin/systemctl restart pwa-admin` — **ne jamais élargir cette règle** à d'autres commandes ou contextes ; c'est la seule voie automatisée approuvée pour ce self-restart. Logs dans `data/auto-update.log`. Cron installé manuellement côté serveur (`crontab -e`), pas versionné dans le repo.
- **Sudoers est entièrement templaté** : `deploy/sudoers.d/pwa-admin.template` (tokens `__PWA_ADMIN_USER__`/`__PWA_ADMIN_APP_DIR__`) est la seule source de vérité, substituée et installée par `install.sh` (avec ou sans `--create-user`) — il n'y a plus de fichier sudoers littéral dans le repo. Toute nouvelle commande nécessitant sudo doit être ajoutée à ce template, avec un commentaire expliquant pourquoi. Après un changement, ré-exécuter `install.sh` sur chaque serveur déployé (ou reproduire manuellement sa substitution + `sudo visudo -c -f /etc/sudoers.d/pwa-admin`) — le déploiement git seul ne touche jamais ce fichier système. Oublier cette étape après un commit qui ajoute une règle sudo produit un échec silencieux ("a password is required") qui ressemble à un bug applicatif.
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
- `sites-enabled/<name>` n'est pas toujours un symlink vers `sites-available/<name>` — certains vhosts pré-existants sont des fichiers indépendants divergents dans `sites-enabled` (contenu réellement chargé par nginx différent de `sites-available`). Toujours vérifier avec `readlink` avant d'éditer par nom de vhost ; `resolveActiveVhostPath()` dans `nginx.service.ts` gère ce cas pour le mode maintenance.
- Le mode maintenance doit explicitement ajouter `auth_basic off;` dans son bloc `location` si le `server{}` a un `auth_basic` — sinon cette directive est héritée et bloque l'accès à la page de maintenance elle-même (401 au lieu de la page).
- Un fichier vhost combinant plusieurs `server_name` distincts (ex. plusieurs sous-domaines dans un seul fichier) fait que toute action par-site (maintenance, enable/disable) s'applique à tous les domaines du fichier — séparer un fichier par site si une gestion indépendante est nécessaire.
- `applyMaintenanceMode` (`nginx.parser.ts`) ne doit **pas** filtrer les blocs `server{}` sur `listen 443/ssl` uniquement — un vhost dont TLS est terminé en amont (tunnel/proxy devant le serveur) écoute en clair sur le port 80 et sert du vrai contenu ; le filtrer comme "pas concerné" rend la bascule maintenance un no-op silencieux (le fichier reste inchangé, `nginx -t`/reload réussissent trivialement, mais le site continue de servir normalement). Le bon critère est `isRedirectOnlyBlock` : un bloc est skippé seulement s'il ne fait qu'un `return 301/302 https://...` sans `location` servant réellement du contenu — TLS-terminé ou HTTP-brut-mais-content-serving sont tous deux éligibles à la bascule.
- Route GET sans try/catch alors que les routes POST du même fichier en ont un = piège récurrent (vu sur `/pm2/processes` et `/network/ports`) : Fastify renvoie son 500 générique au lieu d'un message exploitable. Toute route qui shell out ou touche le filesystem doit avoir son propre try/catch, même en lecture.
- `deploy/install.sh` doit copier `deploy/maintenance-page/index.html` vers `NGINX_MAINTENANCE_ROOT` (`/var/www/server-admin-maintenance` par défaut) — cette étape a été oubliée à l'origine, laissant `applyMaintenanceMode` pointer vers un dossier vide (nginx tombe sur son 503 brut au lieu de la vraie page). Si `NGINX_MAINTENANCE_ROOT` change dans `.env`, le dossier doit être recréé/repeuplé manuellement sur le serveur.
- Détection USB backup (`usbBackup.client.ts`) : `lsblk` seul ne distingue pas un vrai disque de sauvegarde externe d'un disque système — un Raspberry Pi qui boote son rootfs depuis un SSD/USB externe (courant une fois la carte SD retirée) reporte `tran=usb` sur `/` lui-même. `SYSTEM_MOUNTPOINTS` (`/`, `/boot`, `/boot/firmware`) exclut ces points de montage de la détection. Séparément, un disque USB non-système *détecté* n'est pas automatiquement un disque de *sauvegarde* : `isBackupConfigured` (présence de `BACKUP/<hostname>`) est le seul signal fiable, posé explicitement via `POST /backups/usb/enable` — ne jamais faire écrire `copyBackupFile`/l'auto-copie sur un disque simplement détecté, seulement sur un disque avec `isBackupConfigured: true`.
- `si.fsSize()` (`system.service.ts`) retourne aussi des pseudo-filesystems (`efivarfs`, `tmpfs`, `overlay`, etc.) mélangés aux vrais disques, dans un ordre non garanti — `efivarfs` fait typiquement quelques centaines de Ko avec un `use%` élevé et trompeur (ex: 62 % d'un disque de 246 Ko), et le Dashboard prenait `disks[0]` aveuglément comme "disque principal". `PSEUDO_FS_TYPES` filtre ces types, et `/` est explicitement trié en première position.

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
