import { useState } from "react";
import { Card, CardTitle } from "@/components/ui/Card";
import {
  HelpCircle,
  LayoutDashboard,
  Container,
  Server,
  Globe,
  Package,
  Hexagon,
  Network,
  Boxes,
  DatabaseBackup,
  Activity,
  Settings as SettingsIcon,
  ChevronDown,
  ChevronUp,
  Terminal,
  CheckCircle2,
} from "lucide-react";

interface HelpSection {
  icon: typeof LayoutDashboard;
  title: string;
  summary: string;
  details: string[];
}

const SECTIONS: HelpSection[] = [
  {
    icon: LayoutDashboard,
    title: "Dashboard",
    summary: "Écran d'accueil : état de santé du Raspberry Pi en un coup d'œil.",
    details: [
      "Les jauges CPU, RAM, disque et température se mettent à jour en temps réel via WebSocket.",
      "Une bannière d'alerte apparaît automatiquement si un seuil critique est dépassé (température, disque plein, etc.).",
      "Cliquez sur une alerte pour aller voir le détail dans l'écran System.",
    ],
  },
  {
    icon: Container,
    title: "Docker",
    summary: "Gestion complète des conteneurs, images, volumes et réseaux.",
    details: [
      "Onglet Conteneurs : démarrer/arrêter/redémarrer/supprimer, voir les logs en direct et les stats CPU/RAM, bouton « Sauvegarde » qui ouvre Applications pré-rempli.",
      "Onglet Images : exporter une image en .tar (téléchargeable), importer un .tar, supprimer.",
      "Onglet Volumes : sauvegarder en un clic, restaurer la dernière sauvegarde, supprimer.",
      "Onglet Réseaux : liste des réseaux Docker configurés.",
    ],
  },
  {
    icon: Server,
    title: "Nginx",
    summary: "Administration du serveur web : sites, configuration, certificats.",
    details: [
      "Liste des vhosts avec statut activé/désactivé, ports, cible du proxy et emplacement du dossier de site.",
      "Chaque site a un lien cliquable qui l'ouvre dans un nouvel onglet, un test d'accessibilité HTTP réel, le trafic des 7 derniers jours et les erreurs récentes.",
      "Édition de la configuration avec validation automatique (nginx -t) avant application — un historique de versions permet de revenir en arrière.",
      "Statut du certificat SSL (Let's Encrypt ou certificat manuel) avec date d'expiration.",
      "Sauvegarde complète de la configuration Nginx (local et/ou Google Drive).",
    ],
  },
  {
    icon: Globe,
    title: "Sites",
    summary: "Vue combinée d'un site : sa config Nginx et son conteneur Docker associé.",
    details: ["Utile pour retrouver rapidement tout ce qui concerne un site sans naviguer entre deux écrans."],
  },
  {
    icon: Package,
    title: "OS / Paquets",
    summary: "Mises à jour et paquets du système Debian.",
    details: [
      "Liste des paquets installés et de ceux disposant d'une mise à jour.",
      "Vérification des mises à jour et application (upgrade/full-upgrade) avec suivi de la progression en direct.",
      "Gestion des paquets « held » (figés, non concernés par les mises à jour).",
    ],
  },
  {
    icon: Hexagon,
    title: "Node.js (PM2)",
    summary: "Applications Node.js tournant directement sur le Pi (hors Docker), gérées par PM2.",
    details: [
      "Liste des process avec statut, CPU, RAM, uptime et nombre de redémarrages.",
      "Actions start/stop/restart/reload et consultation des logs en direct.",
      "Les apps Node.js qui tournent dans un conteneur Docker restent gérées depuis l'écran Docker.",
    ],
  },
  {
    icon: Network,
    title: "Réseau & Sécurité",
    summary: "Exposition réseau, blocage d'IP, et informations matérielles du Pi.",
    details: [
      "Ports ouverts sur la machine, avec le processus ou conteneur propriétaire.",
      "Blocage/déblocage d'adresses IP via fail2ban.",
      "Onglet Système : modèle exact du Raspberry Pi, tension d'alimentation, date/heure et fuseau, interfaces réseau et IP, Wi-Fi (scan et connexion), statut SSH, services actifs et en échec.",
    ],
  },
  {
    icon: Boxes,
    title: "Applications",
    summary: "Le système de sauvegarde le plus complet : conteneur + dossiers + base de données regroupés.",
    details: [
      "Une « Application » associe un ou plusieurs conteneurs, leurs dossiers montés sur le disque, et une base de données optionnelle.",
      "Sauvegarde complète (« full ») : instantané intégral. Sauvegarde partielle : ne copie que les fichiers nouveaux/modifiés depuis le dernier instantané (économise l'espace disque).",
      "Peut être planifiée automatiquement (ex : partielle quotidienne, complète hebdomadaire) via des préréglages simples.",
      "La restauration prend d'abord un instantané de sécurité avant d'écraser les données actuelles.",
      "Une application peut aussi n'avoir qu'une base de données, sans dossier, si le conteneur est sans état (ex : simple reverse-proxy).",
    ],
  },
  {
    icon: DatabaseBackup,
    title: "Backups",
    summary: "Sauvegardes ponctuelles ou planifiées de volumes, dossiers et bases de données.",
    details: [
      "Création de jobs de sauvegarde avec planification cron et rétention configurable.",
      "Cible locale et/ou Google Drive (connexion à autoriser une seule fois dans cet écran).",
      "Historique complet de toutes les sauvegardes et restaurations effectuées.",
    ],
  },
  {
    icon: Activity,
    title: "System",
    summary: "Monitoring détaillé au-delà des jauges du Dashboard.",
    details: [
      "Détail par disque, par interface réseau, statut de throttling/sous-tension, informations sur le système d'exploitation.",
    ],
  },
  {
    icon: SettingsIcon,
    title: "Settings",
    summary: "Compte administrateur et journal d'audit.",
    details: [
      "Activation de la 2FA (recommandé) via un QR code à scanner avec une application d'authentification.",
      "Journal d'audit listant toutes les actions sensibles effectuées (qui, quoi, quand, résultat).",
    ],
  },
];

interface Dependency {
  name: string;
  purpose: string;
  checkCommand: string;
}

const DEPENDENCIES: Dependency[] = [
  { name: "Docker", purpose: "Requis pour le module Docker et les sauvegardes de volumes/conteneurs.", checkCommand: "docker --version" },
  { name: "Nginx", purpose: "Requis pour le module Nginx et le monitoring des sites.", checkCommand: "nginx -v" },
  { name: "systemd", purpose: "Gère le service de l'application et les services listés dans Réseau & Sécurité.", checkCommand: "systemctl --version" },
  { name: "sudo + règles scoped", purpose: "Permet les actions privilégiées (reload nginx, apt, etc.) sans lancer le service en root.", checkCommand: "sudo -l" },
  { name: "fail2ban", purpose: "Requis pour le blocage/déblocage d'IP.", checkCommand: "fail2ban-client --version" },
  { name: "vcgencmd (Raspberry Pi OS/firmware)", purpose: "Température, tension et throttling — spécifique au matériel Raspberry Pi.", checkCommand: "vcgencmd version" },
  { name: "NetworkManager (nmcli)", purpose: "Gestion Wi-Fi (scan, connexion) dans Réseau & Sécurité.", checkCommand: "nmcli --version" },
  { name: "openssh-server", purpose: "Accès SSH et statut affiché dans Réseau & Sécurité.", checkCommand: "sshd -V" },
  { name: "PM2", purpose: "Requis pour le module Node.js (PM2) si des apps Node tournent hors Docker.", checkCommand: "pm2 --version" },
  { name: "MariaDB / MySQL / PostgreSQL / Redis (optionnel)", purpose: "Détectés automatiquement si installés en natif, pour les sauvegardes de base de données.", checkCommand: "systemctl status mariadb" },
  { name: "rsync", purpose: "Utilisé par le module Applications pour les instantanés complets/partiels.", checkCommand: "rsync --version" },
  { name: "Tailscale", purpose: "Accès réseau sécurisé — l'app ne doit jamais être exposée publiquement.", checkCommand: "tailscale version" },
];

function HelpSectionCard({ section }: { section: HelpSection }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <button
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            <section.icon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium">{section.title}</p>
            <p className="text-xs text-muted-foreground">{section.summary}</p>
          </div>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
          {section.details.map((d, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>{d}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function Help() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitle className="flex items-center gap-1">
          <HelpCircle className="h-4 w-4" /> Aide
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Guide rapide de chaque menu de l'application, et liste des dépendances système nécessaires au bon
          fonctionnement de l'outil sur le Raspberry Pi.
        </p>
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Utilisation des menus</h2>
        <div className="flex flex-col gap-2">
          {SECTIONS.map((s) => (
            <HelpSectionCard key={s.title} section={s} />
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-2 flex items-center gap-1 text-sm font-semibold text-muted-foreground">
          <Terminal className="h-4 w-4" /> Dépendances système à installer
        </h2>
        <Card className="mb-2 text-xs text-muted-foreground">
          Ces logiciels doivent être présents sur le Raspberry Pi pour que les modules correspondants
          fonctionnent. La plupart sont déjà standards sur Raspberry Pi OS / Debian.
        </Card>
        <div className="flex flex-col gap-2">
          {DEPENDENCIES.map((dep) => (
            <Card key={dep.name}>
              <p className="text-sm font-medium">{dep.name}</p>
              <p className="text-xs text-muted-foreground">{dep.purpose}</p>
              <code className="mt-1 block w-fit rounded bg-muted px-2 py-1 text-[11px] text-foreground">
                {dep.checkCommand}
              </code>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
