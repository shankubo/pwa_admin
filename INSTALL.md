# Guide d'installation

> Version illustrée, étape par étape : [Guide d'installation (page web)](https://claude.ai/code/artifact/72591b38-fa86-4bd3-a24c-4451077b8041)

Ce fichier est la référence technique versionnée avec le code. La page ci-dessus couvre le même contenu avec une présentation visuelle plus accessible aux débutants.

## Prérequis

- Un serveur Linux (Raspberry Pi ou VM/serveur Debian/Ubuntu x86_64) avec Docker et Nginx déjà installés, accès SSH avec un compte `sudo`.
- Node.js 20+ sur le serveur (`node -v` pour vérifier).
- Un compte [Tailscale](https://tailscale.com) gratuit — protège l'accès au panneau d'administration (voir [Sécurité](#sécurité) plus bas).

## Deux méthodes d'installation

Le dépôt est public (`github.com/shankubo/pwa_admin`), donc le code peut être récupéré **directement depuis le serveur** sans passer par un ordinateur local — c'est la méthode recommandée pour la plupart des cas. Une seconde méthode (synchronisation depuis un ordinateur local) reste disponible si vous préférez éditer/tester depuis votre PC avant d'envoyer sur le serveur, ou si `git` n'est pas disponible côté serveur.

| | Méthode A — tout en SSH (recommandé) | Méthode B — depuis un PC local |
|---|---|---|
| Où tourne `git clone`/`npm install`/build | Sur le serveur, via une session SSH | Le code est synchronisé (`rsync`) depuis votre PC, le build tourne quand même sur le serveur |
| Prérequis supplémentaire | `git` installé sur le serveur | `rsync`/`ssh` disponibles sur votre PC |
| Cas d'usage typique | Premier déploiement, serveur distant sans accès physique facile | Vous développez/modifiez le code localement avant de le pousser |

---

## Méthode A — Installation tout en SSH (depuis GitHub)

Toutes les commandes ci-dessous s'exécutent **dans une session SSH ouverte sur le serveur** — aucune installation locale requise.

### Étape 1 — Se connecter au serveur

```bash
ssh votre_compte@votre-serveur
```

### Étape 2 — Cloner le dépôt public

Le dépôt ne contient aucun secret (audit effectué avant la mise en public) — un `git clone` HTTPS simple suffit, pas besoin de clé SSH GitHub à cette étape.

```bash
sudo mkdir -p /opt/pwa-admin
sudo chown "$(whoami):$(whoami)" /opt/pwa-admin
git clone https://github.com/shankubo/pwa_admin.git /opt/pwa-admin
cd /opt/pwa-admin
```

> Remplacez `/opt/pwa-admin` par le chemin de votre choix — il sera réutilisé dans toutes les commandes suivantes (`APP_DIR`).

### Étape 3 — Installer les dépendances et builder

Le build doit obligatoirement se faire **sur le serveur lui-même** : `better-sqlite3` compile un module natif spécifique à l'architecture (ARM sur Raspberry Pi, x86_64 sur un VPS) — un build fait ailleurs ne fonctionnerait pas une fois copié.

```bash
npm install
npm run build --workspace=packages/shared   # types partagés, à builder en premier
npm run build --workspace=apps/api
npm run build --workspace=apps/web
```

### Étape 4 — Installer sudoers/systemd/USB/renouvellement de certificat

`deploy/install.sh` met en place tout ce qui nécessite les droits root : règles `sudo` strictement scopées (jamais `NOPASSWD: ALL`), unité systemd, page de maintenance, montage automatique USB, timer de renouvellement de certificat Tailscale.

```bash
sudo ./deploy/install.sh /opt/pwa-admin pwa-admin-svc --create-user
```

- `--create-user` crée un compte système dédié (`pwa-admin-svc`, sans connexion interactive possible) qui fera tourner l'application — recommandé pour isoler l'app de votre compte admin personnel.
- Sans `--create-user`, l'app tourne sous le compte que vous avez utilisé pour vous connecter en SSH (plus simple, mais moins isolé) — dans ce cas remplacez `pwa-admin-svc` par `$(whoami)` dans toutes les commandes qui suivent.

### Étape 5 — Configuration et secrets JWT

```bash
sudo -u pwa-admin-svc cp deploy/env.server.example .env
openssl rand -base64 48   # copiez le résultat dans JWT_ACCESS_SECRET
openssl rand -base64 48   # copiez le résultat dans JWT_REFRESH_SECRET
sudo -u pwa-admin-svc nano .env
```

Dans `nano`, collez les deux secrets générés ci-dessus dans `JWT_ACCESS_SECRET` et `JWT_REFRESH_SECRET`. Les autres valeurs par défaut conviennent pour un premier démarrage.

### Étape 6 — Certificat HTTPS via Tailscale

L'application sert HTTPS nativement sur le port 8443 — pas de reverse-proxy devant elle. Le certificat vient de Tailscale, pas de Let's Encrypt (l'app n'est jamais exposée publiquement, voir [Sécurité](#sécurité)).

```bash
# Si Tailscale n'est pas encore installé/connecté sur ce serveur :
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up   # ouvre un lien à valider dans un navigateur, sur un appareil déjà connecté à votre tailnet

# Une fois Tailscale connecté, émettre le certificat :
sudo mkdir -p secrets/tailscale-cert
cd secrets/tailscale-cert
sudo tailscale cert votre-machine.votre-tailnet.ts.net
sudo chown pwa-admin-svc:pwa-admin-svc *
cd /opt/pwa-admin
```

Remplacez `votre-machine.votre-tailnet.ts.net` par le nom DNS Tailscale réel de ce serveur (visible via `sudo tailscale status` ou dans la console d'admin Tailscale).

### Étape 7 — Restreindre le pare-feu à Tailscale uniquement

```bash
sudo ufw deny 8443/tcp
sudo ufw allow in on tailscale0 to any port 8443
sudo ufw status numbered
```

Vérifiez dans la sortie que le port 8443 n'apparaît **jamais** en `ALLOW` pour une source autre que `tailscale0`.

### Étape 8 — Créer le premier compte admin et démarrer le service

```bash
sudo -u pwa-admin-svc -H npm run create-admin --workspace=apps/api -- votre_identifiant votre_mot_de_passe
sudo systemctl enable --now pwa-admin
sudo journalctl -u pwa-admin -f
```

Le journal doit afficher `pwa-admin API listening on https://0.0.0.0:8443`. Interrompez le suivi (`Ctrl+C`) une fois cette ligne visible.

### Étape 9 — Première connexion

Depuis un appareil connecté à votre tailnet, ouvrez `https://votre-machine.votre-tailnet.ts.net:8443`, connectez-vous avec l'identifiant créé à l'étape 8, puis activez la 2FA dans **Réglages → Compte**.

---

## Méthode B — Depuis un ordinateur local, puis déploiement sur le serveur

Utile si vous voulez d'abord cloner/modifier le code sur votre PC avant de l'envoyer, ou si `git` n'est pas installé côté serveur.

```bash
# 1. Sur votre PC : cloner le dépôt public
git clone https://github.com/shankubo/pwa_admin.git
cd pwa_admin

# 2. Depuis votre PC : synchroniser + builder sur le serveur (rsync, pas de git côté serveur nécessaire)
./deploy/deploy-to-pi.sh votre_compte@votre-serveur /opt/pwa-admin pwa-admin-svc

# 3. Sur le serveur : installer sudoers/systemd/USB/cert-renew sous un compte dédié
ssh votre_compte@votre-serveur
cd /opt/pwa-admin
sudo ./deploy/install.sh /opt/pwa-admin pwa-admin-svc --create-user

# 4. Config + secrets JWT
sudo -u pwa-admin-svc cp deploy/env.server.example .env
openssl rand -base64 48   # coller dans JWT_ACCESS_SECRET
openssl rand -base64 48   # coller dans JWT_REFRESH_SECRET
sudo -u pwa-admin-svc nano .env

# 5. Certificat HTTPS via Tailscale (une fois Tailscale connecté, voir Méthode A étape 6)
sudo mkdir -p secrets/tailscale-cert
cd secrets/tailscale-cert
sudo tailscale cert votre-machine.votre-tailnet.ts.net
sudo chown pwa-admin-svc:pwa-admin-svc *
cd /opt/pwa-admin

# 6. Pare-feu (voir Méthode A étape 7)
sudo ufw deny 8443/tcp
sudo ufw allow in on tailscale0 to any port 8443

# 7. Premier admin + démarrage
sudo -u pwa-admin-svc -H npm run create-admin --workspace=apps/api -- votre_identifiant votre_mot_de_passe
sudo systemctl enable --now pwa-admin
sudo journalctl -u pwa-admin -f
```

`--create-user` crée un compte système dédié (`pwa-admin-svc`, sans connexion interactive) plutôt que de faire tourner l'app sous votre compte admin personnel — recommandé pour isoler l'application. `./deploy/install.sh` sans ce flag reste disponible pour une installation plus simple sous un compte existant.

---

## Mettre à jour une installation existante

Une fois installé (méthode A ou B), les mises à jour suivantes se font **directement sur le serveur**, en SSH :

```bash
ssh votre_compte@votre-serveur
cd /opt/pwa-admin

sudo -u pwa-admin-svc git fetch origin master -q
sudo -u pwa-admin-svc git checkout -f origin/master -B master

sudo -u pwa-admin-svc -H npm run build --workspace=packages/shared
sudo -u pwa-admin-svc -H npm run build --workspace=apps/api
sudo -u pwa-admin-svc -H npm run build --workspace=apps/web

# Uniquement si deploy/sudoers.d/pwa-admin.template a changé dans cette mise à jour :
sudo ./deploy/install.sh /opt/pwa-admin pwa-admin-svc --create-user

sudo systemctl restart pwa-admin
sudo journalctl -u pwa-admin -n 20 --no-pager
```

Le redémarrage du service nécessite un mot de passe sudo interactif — c'est volontaire, le service ne doit pas pouvoir se redémarrer lui-même sans confirmation humaine. Une alternative existe (`deploy/auto-update.sh`, à installer manuellement en cron) pour automatiser entièrement ce cycle sur les serveurs où vous le souhaitez — voir les commentaires en tête de ce script.

## Après l'installation

| Réglage | Où | Pourquoi |
|---|---|---|
| Activer la 2FA (TOTP) | Réglages → Compte | Un mot de passe seul ne suffit pas pour un panneau qui contrôle Docker, Nginx et le pare-feu. |
| Renouvellement auto du certificat | `sudo systemctl enable --now pwa-admin-cert-renew.timer` | Le certificat Tailscale est renouvelé chaque semaine sans intervention. |
| Vérifier le pare-feu | `sudo ufw status numbered` | Le port de l'application ne doit jamais être ouvert au réseau local ni à Internet — uniquement à Tailscale. |

## Sécurité

- **Ne jamais exposer l'application sur Internet.** Pas de reverse-proxy public, pas de tunnel Cloudflare, pas de port forwarding. L'accès passe exclusivement par Tailscale.
- **Activer la 2FA** dès la première connexion.
- **Mettre en place au moins deux sauvegardes** : une locale (automatique dès l'installation) et une hors du serveur (Google Drive ou disque USB).
- **Consulter le journal d'audit** (écran Réglages) périodiquement — chaque action destructive y est journalisée.

### Réseau privé avec Tailscale

```bash
# Sur le serveur
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up   # ouvre un lien à valider dans un navigateur

# Restreindre le pare-feu à Tailscale uniquement
sudo ufw deny 8443/tcp
sudo ufw allow in on tailscale0 to any port 8443
sudo ufw status numbered
```

Installez ensuite Tailscale sur vos autres appareils (téléphone, PC) et connectez-vous avec le même compte — l'application devient accessible depuis n'importe quel réseau.

### Sauvegardes

Trois destinations complémentaires, à combiner plutôt qu'à choisir :

- **Locale** — active dès l'installation, mais ne survit pas à une panne matérielle du serveur.
- **Disque USB externe** — branchez un disque, l'app le détecte automatiquement ; activez-le comme cible depuis l'écran Sauvegardes.
- **Google Drive** — copie hors site automatique après une connexion OAuth2 unique depuis l'écran Sauvegardes.

La restauration passe par un assistant guidé en 3 étapes (source → contenu → confirmation tapée), séparé de l'écran Sauvegardes pour réduire le risque de clic accidentel.

### Clonage de site et bascule d'urgence

Filet de sécurité manuel pour les incidents :

1. **Cloner** — depuis l'écran Sites, bouton *Cloner* : copie les fichiers, la base de données et démarre un conteneur applicatif jumeau, qui tourne en permanence en parallèle de l'original.
2. **Mettre à jour** — le clone est figé à sa création ; *Mettre à jour depuis l'original* refait une copie complète à partir de l'état actuel.
3. **Basculer** — *Basculer vers le duplicata* redirige tout le trafic du site vers son clone (réversible). Le conteneur du clone démarre automatiquement si besoin ; la bascule est annulée si la nouvelle config Nginx échoue ses propres tests.

C'est un outil manuel de reprise après sinistre, pas une bascule automatique en cas de panne.

## Aperçu des fonctionnalités

- **Sites & Nginx** — liste des vhosts, activation/désactivation, mode maintenance, historique de config avec retour arrière.
- **Docker** — conteneurs/images/volumes/réseaux, logs en direct, sans terminal.
- **Sauvegardes** — locales, USB, Google Drive, restauration guidée.
- **Monitoring** — CPU/RAM/disque/température en temps réel, alertes par seuils.

Voir le [README.md](README.md) et [CLAUDE.md](CLAUDE.md) pour la référence technique complète (architecture, modules backend, conventions de développement).
