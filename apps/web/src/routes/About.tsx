import { Card, CardTitle } from "@/components/ui/Card";
import {
  Info,
  LayoutDashboard,
  Container,
  Server,
  Globe,
  Package,
  Hexagon,
  Network,
  Boxes,
  DatabaseBackup,
  RotateCcw,
  Wrench,
  Activity,
  Settings as SettingsIcon,
  ShieldCheck,
  Cpu,
  Cloud,
  Layers,
  User,
} from "lucide-react";

const APP_VERSION = __GIT_DATE__ ? `${__GIT_DATE__} · ${__GIT_COMMIT__}` : __GIT_COMMIT__;
const DEVELOPER = "Shan.K";

const MODULES: { icon: typeof LayoutDashboard; title: string; description: string }[] = [
  { icon: LayoutDashboard, title: "Dashboard", description: "Vue d'ensemble : CPU, RAM, disque, température, disque USB/SSD connecté et alertes actives en un coup d'œil." },
  { icon: Container, title: "Docker", description: "Conteneurs, images, volumes et réseaux : démarrer, arrêter, logs et stats en direct, export/import d'images, sauvegarde de volumes." },
  { icon: Server, title: "Nginx", description: "Vhosts, activation/désactivation, édition de configuration validée, certificats, accessibilité, trafic, sauvegarde de config, mode maintenance par site." },
  { icon: Globe, title: "Sites", description: "Vue agrégée par site combinant les infos Nginx et les conteneurs Docker associés." },
  { icon: Package, title: "OS / Paquets", description: "Informations système, paquets installés, mises à jour Debian/apt avec suivi en direct." },
  { icon: Hexagon, title: "Node.js (PM2)", description: "Processus Node.js gérés par PM2 directement sur l'hôte : statut, logs en direct, start/stop/restart." },
  { icon: Network, title: "Réseau & Sécurité", description: "Ports ouverts, blocage d'IP (fail2ban), matériel (modèle, tension, IP, Wi-Fi, SSH), services système." },
  { icon: Boxes, title: "Applications", description: "Sauvegardes complètes composées (conteneurs + dossiers + volumes Docker + base de données), pleines ou partielles, locales/USB/Google Drive." },
  { icon: DatabaseBackup, title: "Backups", description: "Création et suppression de sauvegardes de volumes, dossiers et bases de données — local, USB ou Google Drive." },
  { icon: RotateCcw, title: "Restore", description: "Restauration guidée en 3 étapes (source → archive → confirmation), seul point d'entrée de l'app pour restaurer des données." },
  { icon: Activity, title: "System", description: "Monitoring détaillé : température, throttling, disques, réseau, système d'exploitation." },
  { icon: Wrench, title: "Services", description: "Statut et mise à jour des services installés sur le serveur (Tailscale, Docker, PM2)." },
  { icon: SettingsIcon, title: "Settings", description: "Compte administrateur, activation de la 2FA, journal d'audit de toutes les actions sensibles." },
];

export function About() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Cpu className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Server Admin PWA</h1>
            <p className="text-xs text-muted-foreground">Version {APP_VERSION}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Application web progressive (PWA) mobile complète pour administrer un serveur Linux sans avoir à
          ouvrir un terminal SSH. Elle centralise la gestion des sites web (Nginx), des conteneurs Docker, des
          sauvegardes et restaurations (locales, USB/SSD et Google Drive), la surveillance système temps réel
          (CPU, RAM, disque, température), la gestion des paquets Debian/OS, du réseau et de la sécurité, des
          services installés (Tailscale, Docker, PM2) et des processus Node.js — le tout depuis un téléphone,
          en toute sécurité via Tailscale. Plusieurs déploiements indépendants (ex. Pi + serveur Ubuntu) peuvent
          être enregistrés et basculés depuis la même interface.
        </p>
      </Card>

      <Card>
        <CardTitle className="flex items-center gap-1">
          <User className="h-4 w-4" /> Développeur
        </CardTitle>
        <p className="text-sm font-medium">{DEVELOPER}</p>
      </Card>

      <Card>
        <CardTitle className="flex items-center gap-1">
          <Layers className="h-4 w-4" /> Structure de l'application
        </CardTitle>
        <div className="flex flex-col gap-2 text-sm">
          <div>
            <p className="font-medium">apps/api — Backend</p>
            <p className="text-xs text-muted-foreground">
              Fastify (Node.js) : sert l'API REST/WebSocket et le frontend buildé. Authentification JWT + 2FA
              (TOTP), contrôle Docker (dockerode), monitoring (systeminformation), sauvegardes, Google Drive,
              planification (node-cron).
            </p>
          </div>
          <div>
            <p className="font-medium">apps/web — Frontend</p>
            <p className="text-xs text-muted-foreground">
              React + Vite, PWA installable (manifest + service worker). Interface mobile-first avec navigation
              par menu hamburger.
            </p>
          </div>
          <div>
            <p className="font-medium">packages/shared — Types partagés</p>
            <p className="text-xs text-muted-foreground">
              Types TypeScript communs entre l'API et le frontend (DTOs, protocole WebSocket).
            </p>
          </div>
          <div>
            <p className="font-medium">deploy/ — Déploiement</p>
            <p className="text-xs text-muted-foreground">
              Unit systemd, règles sudoers scoped (moindre privilège), scripts d'installation et de renouvellement
              de certificat.
            </p>
          </div>
        </div>
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Modules</h2>
        <div className="flex flex-col gap-2">
          {MODULES.map((m) => (
            <Card key={m.title} className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                <m.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{m.title}</p>
                <p className="text-xs text-muted-foreground">{m.description}</p>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <Card>
        <CardTitle className="flex items-center gap-1">
          <ShieldCheck className="h-4 w-4" /> Sécurité
        </CardTitle>
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          <li>• Aucune commande shell construite par concaténation de chaîne (argv-array uniquement).</li>
          <li>• Privilèges élevés strictement scoped via sudoers, jamais le service lancé en root.</li>
          <li>• Authentification JWT + 2FA (TOTP), journal d'audit de toutes les actions destructives.</li>
          <li>• Accès réseau exclusivement via Tailscale (VPN privé) — jamais exposé publiquement.</li>
        </ul>
      </Card>

      <Card>
        <CardTitle className="flex items-center gap-1">
          <Cloud className="h-4 w-4" /> Stockage des sauvegardes
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Local (disque du serveur), disque USB/SSD externe (détecté et monté automatiquement) et/ou Google
          Drive (compte personnel via OAuth2), configurable par sauvegarde. La restauration se fait depuis
          l'écran Restore, quelle que soit la source d'origine.
        </p>
      </Card>

      <div className="flex items-center justify-center gap-1 py-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5" /> Server Admin PWA {APP_VERSION} — {DEVELOPER}
      </div>
    </div>
  );
}
