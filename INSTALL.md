# Guide d'installation

> Version illustrée, étape par étape : [Guide d'installation (page web)](https://claude.ai/code/artifact/72591b38-fa86-4bd3-a24c-4451077b8041)

Ce fichier est la référence technique versionnée avec le code. La page ci-dessus couvre le même contenu avec une présentation visuelle plus accessible aux débutants.

## Prérequis

- Un serveur Linux (Raspberry Pi ou VM/serveur Debian/Ubuntu x86_64) avec Docker et Nginx déjà installés, accès SSH avec un compte `sudo`.
- Node.js 20+ sur le serveur (`node -v` pour vérifier).
- Un compte [Tailscale](https://tailscale.com) gratuit — protège l'accès au panneau d'administration (voir [Sécurité](#sécurité) plus bas).

## Installation

```bash
# 1. Depuis votre ordinateur : synchroniser + builder sur le serveur
./deploy/deploy-to-pi.sh votre_compte@votre-serveur /opt/pwa-admin pwa-admin-svc

# 2. Sur le serveur : installer sudoers/systemd/USB/cert-renew sous un compte dédié
ssh votre_compte@votre-serveur
cd /opt/pwa-admin
sudo ./deploy/install.sh /opt/pwa-admin pwa-admin-svc --create-user

# 3. Config + secrets JWT
sudo -u pwa-admin-svc cp deploy/env.server.example .env
openssl rand -base64 48   # coller dans JWT_ACCESS_SECRET
openssl rand -base64 48   # coller dans JWT_REFRESH_SECRET
sudo -u pwa-admin-svc nano .env

# 4. Certificat HTTPS via Tailscale (une fois Tailscale connecté, voir plus bas)
sudo mkdir -p secrets/tailscale-cert
cd secrets/tailscale-cert
sudo tailscale cert votre-machine.votre-tailnet.ts.net
sudo chown pwa-admin-svc:pwa-admin-svc *
cd /opt/pwa-admin

# 5. Premier admin + démarrage
sudo -u pwa-admin-svc -H npm run create-admin --workspace=apps/api -- votre_identifiant votre_mot_de_passe
sudo systemctl enable --now pwa-admin
sudo journalctl -u pwa-admin -f
```

Le dernier journal doit afficher `pwa-admin API listening on https://0.0.0.0:8443`.

Ouvrez ensuite `https://votre-machine.votre-tailnet.ts.net:8443` depuis un appareil connecté à votre tailnet, connectez-vous avec l'identifiant créé, puis activez la 2FA dans Réglages → Compte.

`--create-user` crée un compte système dédié (`pwa-admin-svc`, sans connexion interactive) plutôt que de faire tourner l'app sous votre compte admin personnel — recommandé pour isoler l'application. `./deploy/install.sh` sans ce flag reste disponible pour une installation plus simple sous un compte existant.

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
