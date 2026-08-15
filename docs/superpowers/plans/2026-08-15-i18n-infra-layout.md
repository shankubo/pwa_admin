# Multi-langue — Infrastructure + Layout partagé + Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Installer l'infrastructure i18next dans `apps/web`, migrer tout le chrome partagé de l'application (drawer de navigation, top bar, bannière de mise à jour, sélecteur de serveur, garde d'authentification) et l'écran Login vers des chaînes traduites, avec un sélecteur de langue fonctionnel dans Settings.

**Architecture:** `i18next` + `react-i18next` chargent des fichiers JSON par namespace depuis `apps/web/public/locales/{fr,en,ta}/*.json` via `i18next-http-backend` (chargement à la demande, pas embarqué dans le bundle). La langue choisie est détectée automatiquement au premier lancement (`i18next-browser-languagedetector`) puis persistée dans un store Zustand (`language.store.ts`) calqué sur `uiMode.store.ts` existant. Un composant `LanguageSwitcher` dans Settings permet de la changer manuellement.

**Tech Stack:** i18next, react-i18next, i18next-browser-languagedetector, i18next-http-backend, Zustand (déjà en place), TypeScript, Vite.

**Spec:** [docs/superpowers/specs/2026-08-15-i18n-frontend-design.md](../specs/2026-08-15-i18n-frontend-design.md)

## Global Constraints

- Langues supportées : `fr` (défaut/fallback), `en`, `ta`. Copié verbatim du spec.
- Namespaces JSON sous `apps/web/public/locales/<lng>/<namespace>.json`, un namespace par écran + `common` (partagé) + `nav` (navigation).
- Le store de langue (`stores/language.store.ts`) suit exactement le pattern de `apps/web/src/stores/uiMode.store.ts` : Zustand + middleware `persist`, préférence par navigateur uniquement, jamais envoyée au backend.
- Aucun changement backend (`apps/api`) dans ce plan — hors périmètre (voir spec, section "Hors périmètre").
- Après chaque tâche : `npx tsc --noEmit -p apps/web/tsconfig.json` doit passer (exécuté depuis la racine du repo).
- Identifiants de code, noms de fichiers, commentaires restent en anglais. Seul le contenu des fichiers `public/locales/**/*.json` et les valeurs traduites changent de langue.

---

## Task 1: Installer les dépendances i18next

**Files:**
- Modify: `apps/web/package.json`

**Interfaces:**
- Produces: `i18next`, `react-i18next`, `i18next-browser-languagedetector`, `i18next-http-backend` disponibles comme imports dans `apps/web/src/**`.

- [ ] **Step 1: Installer les paquets npm**

Run (depuis la racine du repo, `d:\Shan PWA\pwa_admin`) :
```bash
npm install --workspace=apps/web i18next react-i18next i18next-browser-languagedetector i18next-http-backend
```

- [ ] **Step 2: Vérifier l'installation**

Run: `npm ls --workspace=apps/web i18next react-i18next i18next-browser-languagedetector i18next-http-backend`
Expected: les 4 paquets listés avec un numéro de version, aucune erreur `UNMET DEPENDENCY`.

- [ ] **Step 3: Vérifier que le typecheck existant passe toujours**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: aucune erreur (aucun fichier source modifié à cette étape, juste `package.json`/`package-lock.json`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json package-lock.json
git commit -m "chore(web): ajouter les dépendances i18next"
```

---

## Task 2: Créer les fichiers de traduction `common` et `nav`

**Files:**
- Create: `apps/web/public/locales/fr/common.json`
- Create: `apps/web/public/locales/en/common.json`
- Create: `apps/web/public/locales/ta/common.json`
- Create: `apps/web/public/locales/fr/nav.json`
- Create: `apps/web/public/locales/en/nav.json`
- Create: `apps/web/public/locales/ta/nav.json`

**Interfaces:**
- Produces: clés `common:*` et `nav:*` disponibles via `useTranslation(["common", "nav"])` dans les tâches suivantes. Les clés exactes définies ici sont celles consommées par les tâches 5-9.

- [ ] **Step 1: Créer `common.json` pour les 3 langues**

`apps/web/public/locales/fr/common.json`:
```json
{
  "actions": {
    "add": "Ajouter",
    "cancel": "Annuler",
    "confirm": "Confirmer",
    "remove": "Retirer",
    "save": "Enregistrer",
    "update": "Mettre à jour",
    "dismiss": "Ignorer",
    "back": "Retour"
  },
  "app": {
    "name": "Server Admin"
  },
  "update": {
    "available": "Nouvelle version disponible."
  },
  "serverSwitcher": {
    "openLabel": "Changer de serveur",
    "currentServer": "Serveur actuel",
    "otherServers": "Autres serveurs",
    "removeServer": "Retirer {{label}}",
    "addServer": "Ajouter un serveur",
    "namePlaceholder": "Nom (ex: Pi)",
    "urlPlaceholder": "https://…tailnet.ts.net:8443"
  }
}
```

`apps/web/public/locales/en/common.json`:
```json
{
  "actions": {
    "add": "Add",
    "cancel": "Cancel",
    "confirm": "Confirm",
    "remove": "Remove",
    "save": "Save",
    "update": "Update",
    "dismiss": "Dismiss",
    "back": "Back"
  },
  "app": {
    "name": "Server Admin"
  },
  "update": {
    "available": "New version available."
  },
  "serverSwitcher": {
    "openLabel": "Switch server",
    "currentServer": "Current server",
    "otherServers": "Other servers",
    "removeServer": "Remove {{label}}",
    "addServer": "Add a server",
    "namePlaceholder": "Name (e.g. Pi)",
    "urlPlaceholder": "https://…tailnet.ts.net:8443"
  }
}
```

`apps/web/public/locales/ta/common.json`:
```json
{
  "actions": {
    "add": "சேர்",
    "cancel": "ரத்துசெய்",
    "confirm": "உறுதிப்படுத்து",
    "remove": "அகற்று",
    "save": "சேமி",
    "update": "புதுப்பி",
    "dismiss": "தவிர்",
    "back": "பின்செல்"
  },
  "app": {
    "name": "Server Admin"
  },
  "update": {
    "available": "புதிய பதிப்பு கிடைக்கிறது."
  },
  "serverSwitcher": {
    "openLabel": "சேவையகத்தை மாற்று",
    "currentServer": "தற்போதைய சேவையகம்",
    "otherServers": "மற்ற சேவையகங்கள்",
    "removeServer": "{{label}} ஐ அகற்று",
    "addServer": "சேவையகம் சேர்",
    "namePlaceholder": "பெயர் (எ.கா. Pi)",
    "urlPlaceholder": "https://…tailnet.ts.net:8443"
  }
}
```

- [ ] **Step 2: Créer `nav.json` pour les 3 langues**

`apps/web/public/locales/fr/nav.json`:
```json
{
  "dashboard": "Dashboard",
  "docker": "Docker",
  "nginx": "Nginx",
  "sites": "Sites",
  "os": "OS / Paquets",
  "pm2": "Node.js (PM2)",
  "network": "Réseau & Sécurité",
  "security": "Sécurité serveur",
  "wizard": "Assistant",
  "applications": "Applications",
  "backups": "Backups",
  "restore": "Restore",
  "usbExplorer": "Disque externe USB",
  "system": "System",
  "services": "Services",
  "help": "Aide",
  "about": "À propos",
  "settings": "Settings",
  "menu": {
    "open": "Ouvrir le menu",
    "close": "Fermer"
  },
  "alerts": "Alertes",
  "easyMode": {
    "switchToAdvanced": "Revenir au mode avancé",
    "switchToEasy": "Passer en mode simplifié"
  }
}
```

`apps/web/public/locales/en/nav.json`:
```json
{
  "dashboard": "Dashboard",
  "docker": "Docker",
  "nginx": "Nginx",
  "sites": "Sites",
  "os": "OS / Packages",
  "pm2": "Node.js (PM2)",
  "network": "Network & Security",
  "security": "Server Security",
  "wizard": "Wizard",
  "applications": "Applications",
  "backups": "Backups",
  "restore": "Restore",
  "usbExplorer": "External USB Drive",
  "system": "System",
  "services": "Services",
  "help": "Help",
  "about": "About",
  "settings": "Settings",
  "menu": {
    "open": "Open menu",
    "close": "Close"
  },
  "alerts": "Alerts",
  "easyMode": {
    "switchToAdvanced": "Switch back to advanced mode",
    "switchToEasy": "Switch to simple mode"
  }
}
```

`apps/web/public/locales/ta/nav.json`:
```json
{
  "dashboard": "டாஷ்போர்டு",
  "docker": "Docker",
  "nginx": "Nginx",
  "sites": "தளங்கள்",
  "os": "OS / தொகுப்புகள்",
  "pm2": "Node.js (PM2)",
  "network": "நெட்வொர்க் & பாதுகாப்பு",
  "security": "சேவையக பாதுகாப்பு",
  "wizard": "வழிகாட்டி",
  "applications": "பயன்பாடுகள்",
  "backups": "காப்புப்பிரதிகள்",
  "restore": "மீட்டமை",
  "usbExplorer": "வெளிப்புற USB வட்டு",
  "system": "System",
  "services": "சேவைகள்",
  "help": "உதவி",
  "about": "பற்றி",
  "settings": "அமைப்புகள்",
  "menu": {
    "open": "மெனுவைத் திற",
    "close": "மூடு"
  },
  "alerts": "எச்சரிக்கைகள்",
  "easyMode": {
    "switchToAdvanced": "மேம்பட்ட பயன்முறைக்குத் திரும்பு",
    "switchToEasy": "எளிய பயன்முறைக்கு மாறு"
  }
}
```

- [ ] **Step 3: Vérifier que les fichiers sont du JSON valide**

Run: `node -e "['fr','en','ta'].forEach(l => ['common','nav'].forEach(n => JSON.parse(require('fs').readFileSync(\`apps/web/public/locales/${l}/${n}.json\`))))"`
Expected: aucune erreur (sortie vide = succès).

- [ ] **Step 4: Commit**

```bash
git add apps/web/public/locales/fr/common.json apps/web/public/locales/en/common.json apps/web/public/locales/ta/common.json apps/web/public/locales/fr/nav.json apps/web/public/locales/en/nav.json apps/web/public/locales/ta/nav.json
git commit -m "feat(web): fichiers de traduction common et nav (fr/en/ta)"
```

---

## Task 3: Créer `lib/i18n.ts` et l'initialiser dans `main.tsx`

**Files:**
- Create: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: rien (fichiers statiques créés en Task 2, servis par Vite depuis `public/`).
- Produces: `import "@/lib/i18n"` initialise i18next avant le premier rendu ; toute la suite du plan peut utiliser `useTranslation()` de `react-i18next`.

- [ ] **Step 1: Créer `apps/web/src/lib/i18n.ts`**

```ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import HttpBackend from "i18next-http-backend";

export const SUPPORTED_LANGUAGES = ["fr", "en", "ta"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "fr",
    supportedLngs: [...SUPPORTED_LANGUAGES],
    ns: ["common", "nav"],
    defaultNS: "common",
    backend: {
      loadPath: "/locales/{{lng}}/{{ns}}.json",
    },
    detection: {
      // localStorage checked first so an explicit choice (set by
      // language.store.ts via i18n.changeLanguage) wins on repeat visits;
      // falls through to navigator language only when nothing is stored yet.
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "pwa-admin-i18n-language",
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
```

- [ ] **Step 2: Importer `lib/i18n` dans `main.tsx` avant le rendu**

En l'état actuel, `apps/web/src/main.tsx` :
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

Remplacer par :
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "@/lib/i18n";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 3: Vérifier le typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: aucune erreur. Si `i18next-http-backend`/`i18next-browser-languagedetector` n'exportent pas de types par défaut compatibles, vérifier `node_modules/i18next-http-backend/index.d.ts` — les deux paquets embarquent leurs propres `.d.ts`, aucun `@types/*` supplémentaire à installer normalement.

- [ ] **Step 4: Test manuel de démarrage**

Run: `npm run dev:web` (depuis la racine du repo), ouvrir l'app dans un navigateur.
Expected: l'app se charge normalement (aucun texte traduit encore visible car aucun composant n'utilise `useTranslation` — seul le chargement ne doit pas planter). Ouvrir les devtools réseau : une requête vers `/locales/fr/common.json` et `/locales/fr/nav.json` doit apparaître avec un statut 200.
Arrêter le serveur dev (Ctrl+C) une fois vérifié.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/i18n.ts apps/web/src/main.tsx
git commit -m "feat(web): initialiser i18next au démarrage de l'app"
```

---

## Task 4: Créer le store de préférence de langue

**Files:**
- Create: `apps/web/src/stores/language.store.ts`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `SupportedLanguage`, `SUPPORTED_LANGUAGES` de `@/lib/i18n` (Task 3) ; `i18n` (default export) de `@/lib/i18n`.
- Produces: `useLanguageStore` avec `{ language: SupportedLanguage | null; setLanguage: (lang: SupportedLanguage) => void }`, consommé par `LanguageSwitcher` (Task 8) et par le hook de synchronisation ajouté ici dans `App.tsx`.

- [ ] **Step 1: Créer `apps/web/src/stores/language.store.ts`**

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SupportedLanguage } from "@/lib/i18n";

interface LanguageState {
  /** null = aucun choix explicite ; on suit i18next-browser-languagedetector
   * (navigator.language) plutôt que de forcer une langue. */
  language: SupportedLanguage | null;
  setLanguage: (language: SupportedLanguage) => void;
}

/** Préférence de langue — même pattern que uiMode.store.ts : préférence par
 * navigateur/appareil, jamais envoyée au backend, jamais liée à l'identité
 * utilisateur (pas de système de rôles dans cette app). */
export const useLanguageStore = create<LanguageState>()(
  persist(
    (set) => ({
      language: null,
      setLanguage: (language) => set({ language }),
    }),
    { name: "pwa-admin-language" }
  )
);
```

- [ ] **Step 2: Synchroniser le store avec i18next dans `App.tsx`**

État actuel de `apps/web/src/App.tsx` (imports + début de fonction) :
```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Shell } from "@/components/layout/Shell";
import { RequireAuth } from "@/components/layout/RequireAuth";
import { Dashboard } from "@/routes/Dashboard";
import { Login } from "@/routes/Login";
// ... autres imports de routes inchangés
import { externalRoutes } from "@/routes/external";

export default function App() {
  return (
    <BrowserRouter>
```

Ajouter l'import et l'effet de synchronisation :
```tsx
import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Shell } from "@/components/layout/Shell";
import { RequireAuth } from "@/components/layout/RequireAuth";
import { Dashboard } from "@/routes/Dashboard";
import { Login } from "@/routes/Login";
// ... autres imports de routes inchangés
import { externalRoutes } from "@/routes/external";
import { useLanguageStore } from "@/stores/language.store";
import i18n from "@/lib/i18n";

export default function App() {
  const language = useLanguageStore((s) => s.language);

  useEffect(() => {
    // language === null signifie "pas de choix explicite" : on laisse
    // i18next-browser-languagedetector gérer la détection initiale déjà
    // effectuée dans lib/i18n.ts, sans forcer de changeLanguage ici.
    if (language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  return (
    <BrowserRouter>
```

Ne pas oublier de fermer la fonction avec la parenthèse déjà existante (le corps du `<Routes>` reste inchangé).

- [ ] **Step 3: Vérifier le typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/stores/language.store.ts apps/web/src/App.tsx
git commit -m "feat(web): store de préférence de langue synchronisé avec i18next"
```

---

## Task 5: Migrer `navItems.ts` vers des clés de traduction

**Files:**
- Modify: `apps/web/src/components/layout/navItems.ts`
- Modify: `apps/web/src/components/layout/externalNavItems.ts`
- Modify: `apps/web/src/components/layout/AppDrawer.tsx`
- Modify: `apps/web/src/components/layout/TopBar.tsx`

**Interfaces:**
- Consumes: clés `nav:*` définies en Task 2 (`dashboard`, `docker`, `nginx`, `sites`, `os`, `pm2`, `network`, `security`, `wizard`, `applications`, `backups`, `restore`, `usbExplorer`, `system`, `services`, `help`, `about`, `settings`, `menu.open`, `alerts`, `easyMode.switchToAdvanced`, `easyMode.switchToEasy`).
- Produces: `NavItem.labelKey: string` (remplace `label: string`) — toute future entrée de nav (y compris `externalNavItems.ts`, généré par l'installeur imanote et hors du dépôt public, mais dont la forme doit rester compatible) utilise ce champ.

`navItems.ts` exporte actuellement des `label: string` statiques au niveau module — un hook React (`useTranslation`) ne peut pas être appelé là. La solution : le tableau porte une **clé** de traduction (`labelKey`), résolue avec `t()` au moment du rendu dans `AppDrawer`/`TopBar`.

- [ ] **Step 1: Modifier l'interface `NavItem` et les entrées dans `navItems.ts`**

État actuel : voir `apps/web/src/components/layout/navItems.ts:25-57` (interface `NavItem` avec `label: string`, tableau `navItems` avec des labels français en dur).

Remplacer tout le fichier par :
```ts
import type { LucideIcon } from "lucide-react";
import type { ServiceName } from "@pwa-admin/shared";
import {
  LayoutDashboard,
  Container,
  Globe,
  Server,
  Network,
  Package,
  DatabaseBackup,
  Activity,
  Settings,
  Boxes,
  Hexagon,
  HelpCircle,
  Info,
  ShieldCheck,
  RotateCcw,
  Wrench,
  Usb,
  Wand2,
} from "lucide-react";
import { externalNavItems } from "./externalNavItems";

export interface NavItem {
  to: string;
  /** Clé de traduction dans le namespace "nav" (ex: "dashboard" → nav:dashboard). */
  labelKey: string;
  icon: LucideIcon;
  group: "top" | "management" | "ops" | "bottom";
  /** Hidden from the nav until /services/overview confirms this service is
   * installed on the current deployment — no point sending the admin to a
   * page that just says "not installed" (see useInstalledServices). Omitted
   * for every item that's always relevant regardless of what's installed. */
  requiresService?: ServiceName;
}

export const navItems: NavItem[] = [
  { to: "/", labelKey: "dashboard", icon: LayoutDashboard, group: "top" },
  { to: "/docker", labelKey: "docker", icon: Container, group: "management", requiresService: "docker" },
  { to: "/nginx", labelKey: "nginx", icon: Server, group: "management", requiresService: "webserver" },
  { to: "/sites", labelKey: "sites", icon: Globe, group: "management" },
  { to: "/os", labelKey: "os", icon: Package, group: "management" },
  { to: "/pm2", labelKey: "pm2", icon: Hexagon, group: "management", requiresService: "pm2" },
  { to: "/network", labelKey: "network", icon: Network, group: "management" },
  { to: "/security", labelKey: "security", icon: ShieldCheck, group: "management" },
  { to: "/wizard", labelKey: "wizard", icon: Wand2, group: "ops" },
  { to: "/applications", labelKey: "applications", icon: Boxes, group: "ops" },
  { to: "/backups", labelKey: "backups", icon: DatabaseBackup, group: "ops" },
  { to: "/restore", labelKey: "restore", icon: RotateCcw, group: "ops" },
  { to: "/usb-explorer", labelKey: "usbExplorer", icon: Usb, group: "ops" },
  { to: "/system", labelKey: "system", icon: Activity, group: "ops" },
  { to: "/services", labelKey: "services", icon: Wrench, group: "ops" },
  { to: "/help", labelKey: "help", icon: HelpCircle, group: "bottom" },
  { to: "/about", labelKey: "about", icon: Info, group: "bottom" },
  { to: "/settings", labelKey: "settings", icon: Settings, group: "bottom" },
  ...externalNavItems,
];
```

- [ ] **Step 2: Adapter `externalNavItems.ts`**

Ce fichier est régénéré par l'installeur du plugin privé imanote (non modifié depuis ce dépôt selon CLAUDE.md) — mais le fichier actuellement commité doit rester compatible avec le nouveau contrat `NavItem` pour que `tsc` passe. État actuel : `apps/web/src/components/layout/externalNavItems.ts:1-8` avec `label: "Saisietemps.fr"`.

Remplacer par :
```ts
// GÉNÉRÉ par pwa-admin-plugin-imanote/install.sh — ne pas éditer à la main
import type { NavItem } from "./navItems";
import { Clock } from "lucide-react";

export const externalNavItems: NavItem[] = [
  { to: "/imanote", labelKey: "imanote", icon: Clock, group: "ops" },
];
```

Ajouter la clé correspondante dans les 3 fichiers `nav.json` créés en Task 2 (clé `"imanote": "Saisietemps.fr"` inchangée dans les 3 langues — nom propre, ne se traduit pas) :

`apps/web/public/locales/fr/nav.json`, `en/nav.json`, `ta/nav.json` — ajouter après `"settings"` :
```json
  "settings": "Settings",
  "imanote": "Saisietemps.fr",
```
(adapter la valeur `"Settings"`/`"அமைப்புகள்"` selon le fichier — seule la nouvelle ligne `"imanote"` est ajoutée, identique dans les 3 fichiers).

- [ ] **Step 3: Résoudre `labelKey` dans `AppDrawer.tsx`**

État actuel : voir `apps/web/src/components/layout/AppDrawer.tsx` en entier (fichier lu ci-dessus). Le composant `NavGroup` boucle sur `items.map((item) => ...)` et affiche `{item.label}` à la ligne 60 ; le titre "Server Admin" est en dur ligne 83 ; `aria-label="Ouvrir le menu"` n'existe pas dans ce fichier (c'est dans TopBar) mais `Dialog.Close` n'a pas de label — laissé tel quel (icône seule, pas de régression).

Remplacer le contenu complet de `apps/web/src/components/layout/AppDrawer.tsx` par :
```tsx
import * as Dialog from "@radix-ui/react-dialog";
import { NavLink } from "react-router-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { navItems } from "./navItems";
import { cn } from "@/lib/utils";
import { useHostname } from "@/lib/useHostname";
import { useInstalledServices } from "@/lib/useInstalledServices";
import { useUiModeStore, type UiMode } from "@/stores/uiMode.store";

interface AppDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Easy Mode's deliberately closed set of screens — a non-technical operator
// sees only these plus the Wizard. Explicit allowlist rather than a NavItem
// field: keeps all mode-filtering logic in one place and requires no changes
// to externalNavItems.ts's generation contract (imanote is hidden by
// omission, not by a special case).
const EASY_MODE_PATHS = new Set(["/", "/help", "/about", "/settings", "/wizard"]);

function NavGroup({
  group,
  installedServices,
  mode,
  onNavigate,
}: {
  group: "top" | "management" | "ops" | "bottom";
  installedServices: ReturnType<typeof useInstalledServices>;
  mode: UiMode;
  onNavigate: () => void;
}) {
  const { t } = useTranslation("nav");
  const items = navItems.filter(
    (i) =>
      i.group === group &&
      // Until the first /services/overview answer arrives, installedServices
      // is null — show every item rather than hiding docker/pm2 during that
      // brief window (see useInstalledServices's own doc comment).
      (!i.requiresService || !installedServices || installedServices.has(i.requiresService)) &&
      (mode === "advanced" || EASY_MODE_PATHS.has(i.to))
  );
  return (
    <div className="flex flex-col gap-1">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-muted"
            )
          }
        >
          <item.icon className="h-5 w-5 shrink-0" />
          {t(item.labelKey)}
        </NavLink>
      ))}
    </div>
  );
}

export function AppDrawer({ open, onOpenChange }: AppDrawerProps) {
  const { t } = useTranslation("common");
  const hostname = useHostname();
  const installedServices = useInstalledServices();
  const mode = useUiModeStore((s) => s.mode);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed inset-y-0 left-0 z-50 flex w-[85vw] max-w-xs flex-col gap-6 overflow-y-auto bg-card p-4 shadow-xl outline-none"
          style={{ paddingTop: "calc(1rem + env(safe-area-inset-top))" }}
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between">
            <div>
              <Dialog.Title className="text-lg font-semibold">{t("app.name")}</Dialog.Title>
              {hostname && <p className="text-xs text-muted-foreground">{hostname}</p>}
            </div>
            <Dialog.Close className="rounded-md p-1 hover:bg-muted">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>

          <NavGroup group="top" installedServices={installedServices} mode={mode} onNavigate={() => onOpenChange(false)} />
          <div className="h-px bg-border" />
          <NavGroup group="management" installedServices={installedServices} mode={mode} onNavigate={() => onOpenChange(false)} />
          <div className="h-px bg-border" />
          <NavGroup group="ops" installedServices={installedServices} mode={mode} onNavigate={() => onOpenChange(false)} />
          <div className="mt-auto h-px bg-border" />
          <NavGroup group="bottom" installedServices={installedServices} mode={mode} onNavigate={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 4: Résoudre `labelKey` et traduire les chaînes restantes dans `TopBar.tsx`**

État actuel : voir `apps/web/src/components/layout/TopBar.tsx` en entier (fichier lu ci-dessus). `current?.label` ligne 27, `aria-label="Ouvrir le menu"` ligne 41, `aria-label`/`title` du bouton mode Easy/Advanced lignes 54-55, `aria-label="Alertes"` ligne 63.

Remplacer le contenu complet de `apps/web/src/components/layout/TopBar.tsx` par :
```tsx
import { useEffect } from "react";
import { Menu, Bell, Wand2 } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { navItems } from "./navItems";
import { ServerSwitcher } from "./ServerSwitcher";
import { useHostname } from "@/lib/useHostname";
import { useWebServerEngine } from "@/lib/useWebServerEngine";
import { useUiModeStore } from "@/stores/uiMode.store";
import { cn } from "@/lib/utils";

interface TopBarProps {
  onMenuClick: () => void;
  alertCount?: number;
}

export function TopBar({ onMenuClick, alertCount = 0 }: TopBarProps) {
  const { t } = useTranslation(["nav", "common"]);
  const location = useLocation();
  const current = navItems.find((i) => (i.to === "/" ? location.pathname === "/" : location.pathname.startsWith(i.to)));
  const hostname = useHostname();
  const webServerEngine = useWebServerEngine();
  const mode = useUiModeStore((s) => s.mode);
  const toggleMode = useUiModeStore((s) => s.toggleMode);
  // The nav menu's own "Nginx" label stays static (see useWebServerEngine's
  // doc comment) — only the page title, which is actually visible while the
  // admin is looking at this exact screen, reflects the real detected engine.
  const pageLabel =
    current?.to === "/nginx" && webServerEngine === "apache"
      ? "Apache"
      : current
        ? t(current.labelKey, { ns: "nav" })
        : t("app.name", { ns: "common" });

  useEffect(() => {
    document.title = hostname ? `${pageLabel} — ${hostname}` : pageLabel;
  }, [pageLabel, hostname]);

  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card/95 px-3 backdrop-blur"
      style={{ paddingTop: "env(safe-area-inset-top)", height: "calc(3.5rem + env(safe-area-inset-top))" }}
    >
      <button
        type="button"
        onClick={onMenuClick}
        aria-label={t("menu.open", { ns: "nav" })}
        className="rounded-md p-2 hover:bg-muted"
      >
        <Menu className="h-6 w-6" />
      </button>
      <div className="flex flex-col items-center leading-tight">
        <h1 className="text-base font-semibold">{pageLabel}</h1>
        {hostname && <span className="text-[11px] text-muted-foreground">{hostname}</span>}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={toggleMode}
          aria-label={mode === "easy" ? t("easyMode.switchToAdvanced", { ns: "nav" }) : t("easyMode.switchToEasy", { ns: "nav" })}
          title={mode === "easy" ? t("easyMode.switchToAdvanced", { ns: "nav" }) : t("easyMode.switchToEasy", { ns: "nav" })}
          className={cn("rounded-md p-2 hover:bg-muted", mode === "easy" && "text-primary")}
        >
          <Wand2 className="h-5 w-5" />
        </button>
        <ServerSwitcher />
        <button
          type="button"
          aria-label={t("alerts", { ns: "nav" })}
          className="relative rounded-md p-2 hover:bg-muted"
        >
          <Bell className="h-5 w-5" />
          {alertCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {alertCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 5: Vérifier le typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: aucune erreur.

- [ ] **Step 6: Test manuel**

Run: `npm run dev:web`, se connecter à l'app (ou observer le drawer si déjà connecté).
Expected: le drawer de navigation et le titre de la top bar affichent toujours les mêmes libellés français qu'avant (comportement inchangé — seule la source a changé, la langue par défaut reste `fr`). Ouvrir le drawer, vérifier que tous les items sont présents et lisibles.
Arrêter le serveur dev une fois vérifié.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/layout/navItems.ts apps/web/src/components/layout/externalNavItems.ts apps/web/src/components/layout/AppDrawer.tsx apps/web/src/components/layout/TopBar.tsx apps/web/public/locales/fr/nav.json apps/web/public/locales/en/nav.json apps/web/public/locales/ta/nav.json
git commit -m "feat(web): traduire la navigation (drawer, top bar) via i18next"
```

---

## Task 6: Traduire `UpdateBanner.tsx` et `RequireAuth.tsx`

**Files:**
- Modify: `apps/web/src/components/layout/UpdateBanner.tsx`
- Modify: `apps/web/src/components/layout/RequireAuth.tsx` (vérification seule, aucune chaîne visible à traduire)

**Interfaces:**
- Consumes: clés `common:update.available`, `common:actions.update`, `common:actions.dismiss` (Task 2).
- Produces: rien de nouveau consommé par d'autres tâches.

- [ ] **Step 1: Traduire `UpdateBanner.tsx`**

État actuel : voir fichier lu ci-dessus, lignes 26 (`"Nouvelle version disponible."`), 33 (`"Mettre à jour"`), et `aria-label="Ignorer"` ligne 37.

Remplacer le contenu complet par :
```tsx
import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Surfaces the service worker's "new version ready" state instead of
 * updating silently — critical on iOS, where an installed PWA's service
 * worker almost never wakes up on its own to check for updates, so without
 * an explicit in-app affordance there's no reliable way to notice or force
 * a stale build to refresh (registerType "prompt" in vite.config.ts is what
 * makes needRefresh actually fire, instead of autoUpdate swapping versions
 * invisibly with nothing for this component to hook into).
 */
export function UpdateBanner() {
  const { t } = useTranslation("common");
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="sticky top-0 z-40 flex items-center justify-between gap-2 bg-primary px-3 py-2 text-sm text-primary-foreground">
      <div className="flex items-center gap-2">
        <RefreshCw className="h-4 w-4 shrink-0" />
        <span>{t("update.available")}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => updateServiceWorker(true)}
          className="rounded-md bg-primary-foreground/20 px-3 py-1 font-medium hover:bg-primary-foreground/30"
        >
          {t("actions.update")}
        </button>
        <button
          type="button"
          aria-label={t("actions.dismiss")}
          onClick={() => setNeedRefresh(false)}
          className="rounded-md p-1 hover:bg-primary-foreground/20"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Vérifier `RequireAuth.tsx`**

Ce fichier (lu ci-dessus) ne contient aucune chaîne visible à l'utilisateur (juste un `<Navigate>` et `null`) — aucune modification nécessaire. Ne pas y toucher.

- [ ] **Step 3: Vérifier le typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/layout/UpdateBanner.tsx
git commit -m "feat(web): traduire la bannière de mise à jour via i18next"
```

---

## Task 7: Traduire `ServerSwitcher.tsx`

**Files:**
- Modify: `apps/web/src/components/layout/ServerSwitcher.tsx`

**Interfaces:**
- Consumes: clés `common:serverSwitcher.*`, `common:actions.add`, `common:actions.cancel` (Task 2).

- [ ] **Step 1: Traduire les chaînes en dur**

État actuel : voir fichier lu ci-dessus. Chaînes à remplacer : `aria-label="Changer de serveur"` (l.36), `"Serveur actuel"` (l.45), `"Autres serveurs"` (l.50), `` `Retirer ${s.label}` `` (l.64, devient interpolation i18next), placeholders `"Nom (ex: Pi)"` (l.80) et `"https://…tailnet.ts.net:8443"` (l.87), `"Ajouter"` (l.94), `"Annuler"` (l.97), `"Ajouter un serveur"` (l.103).

Remplacer le contenu complet par :
```tsx
import { useState } from "react";
import { Server, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useServerConnectionsStore } from "@/stores/serverConnections.store";
import { Button } from "@/components/ui/Button";

/** Switches between fully independent pwa-admin deployments (own DB, own
 * auth, own Tailscale identity) registered client-side — not a remote-host
 * proxy. Switching navigates to the other server's own /login, since a
 * refresh-token cookie doesn't cross origins. */
export function ServerSwitcher() {
  const { t } = useTranslation("common");
  const { servers, addServer, removeServer } = useServerConnectionsStore();
  const [open, setOpen] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const currentOrigin = window.location.origin;

  function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !baseUrl.trim()) return;
    addServer({ id: crypto.randomUUID(), label: label.trim(), baseUrl: baseUrl.trim().replace(/\/$/, "") });
    setLabel("");
    setBaseUrl("");
    setShowAddForm(false);
  }

  function switchTo(url: string) {
    window.location.href = `${url}/login`;
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t("serverSwitcher.openLabel")}
        onClick={() => setOpen((v) => !v)}
        className="rounded-md p-2 hover:bg-muted"
      >
        <Server className="h-5 w-5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-md border border-border bg-card p-2 shadow-lg">
          <p className="px-1 text-xs font-medium text-muted-foreground">{t("serverSwitcher.currentServer")}</p>
          <p className="mb-2 truncate px-1 text-sm">{currentOrigin}</p>

          {servers.length > 0 && (
            <>
              <p className="px-1 text-xs font-medium text-muted-foreground">{t("serverSwitcher.otherServers")}</p>
              <div className="mb-2 flex flex-col gap-1">
                {servers.map((s) => (
                  <div key={s.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => switchTo(s.baseUrl)}
                      className="flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      {s.label}
                      <span className="ml-1 text-xs text-muted-foreground">{s.baseUrl}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={t("serverSwitcher.removeServer", { label: s.label })}
                      onClick={() => removeServer(s.id)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {showAddForm ? (
            <form onSubmit={submitAdd} className="flex flex-col gap-1">
              <input
                type="text"
                placeholder={t("serverSwitcher.namePlaceholder")}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              <input
                type="text"
                placeholder={t("serverSwitcher.urlPlaceholder")}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              <div className="flex gap-1">
                <Button type="submit" size="sm">
                  {t("actions.add")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>
                  {t("actions.cancel")}
                </Button>
              </div>
            </form>
          ) : (
            <Button size="sm" variant="outline" className="w-full" onClick={() => setShowAddForm(true)}>
              <Plus className="h-3.5 w-3.5" /> {t("serverSwitcher.addServer")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Vérifier le typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/layout/ServerSwitcher.tsx
git commit -m "feat(web): traduire le sélecteur de serveur via i18next"
```

---

## Task 8: Créer `LanguageSwitcher` et l'intégrer dans Settings

**Files:**
- Create: `apps/web/src/components/layout/LanguageSwitcher.tsx`
- Create: `apps/web/public/locales/fr/settings.json`
- Create: `apps/web/public/locales/en/settings.json`
- Create: `apps/web/public/locales/ta/settings.json`
- Modify: `apps/web/src/routes/Settings.tsx`

**Interfaces:**
- Consumes: `useLanguageStore` (Task 4), `SUPPORTED_LANGUAGES`/`SupportedLanguage` (Task 3), `Card`/`CardTitle`/`Button` (`@/components/ui/*`, inchangés).
- Produces: `LanguageSwitcher` component réutilisable, sans props, exporté pour un usage futur possible ailleurs (mais monté uniquement dans Settings pour ce plan).

- [ ] **Step 1: Créer les fichiers `settings.json` (namespace du futur écran Settings complet — seule la clé du bloc langue est utilisée dans ce plan, le reste de l'écran Settings est migré dans un plan ultérieur)**

`apps/web/public/locales/fr/settings.json`:
```json
{
  "language": {
    "title": "Langue",
    "fr": "Français",
    "en": "English",
    "ta": "தமிழ்"
  }
}
```

`apps/web/public/locales/en/settings.json`:
```json
{
  "language": {
    "title": "Language",
    "fr": "Français",
    "en": "English",
    "ta": "தமிழ்"
  }
}
```

`apps/web/public/locales/ta/settings.json`:
```json
{
  "language": {
    "title": "மொழி",
    "fr": "Français",
    "en": "English",
    "ta": "தமிழ்"
  }
}
```

(Les noms de langue eux-mêmes restent dans leur propre langue native dans les 3 fichiers — convention standard des sélecteurs de langue, un utilisateur doit reconnaître "English"/"தமிழ்" même s'il ne lit pas encore cette langue.)

- [ ] **Step 2: Créer `LanguageSwitcher.tsx`**

```tsx
import { useTranslation } from "react-i18next";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useLanguageStore } from "@/stores/language.store";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation("settings");
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const current = i18n.resolvedLanguage as SupportedLanguage | undefined;

  return (
    <Card>
      <CardTitle>{t("language.title")}</CardTitle>
      <div className="flex gap-2">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <Button
            key={lang}
            type="button"
            size="sm"
            variant={current === lang ? "default" : "outline"}
            className={cn(current === lang && "pointer-events-none")}
            onClick={() => setLanguage(lang)}
          >
            {t(`language.${lang}`)}
          </Button>
        ))}
      </div>
    </Card>
  );
}
```

- [ ] **Step 3: Intégrer dans `Settings.tsx`**

État actuel : voir `apps/web/src/routes/Settings.tsx:61-76` (début du JSX, bloc "Compte" en premier). Ajouter l'import et le bloc juste après le `<Card>` "Compte" :

Modifier l'import (ligne 13, après `ConfirmDialog`) :
```tsx
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
```

Modifier le JSX (ligne 62-76 actuelles) — insérer `<LanguageSwitcher />` juste après le bloc "Compte" et avant `{user && !user.twoFactorEnabled && ...}` :
```tsx
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitle>Compte</CardTitle>
        {user ? (
          <div className="text-sm">
            <p className="font-medium">{user.username}</p>
            <p className="text-xs text-muted-foreground">
              2FA : {user.twoFactorEnabled ? "activée" : "désactivée"}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        )}
      </Card>

      <LanguageSwitcher />

      {user && !user.twoFactorEnabled && (
        <TwoFactorEnrollCard onEnrolled={() => setUser({ ...user, twoFactorEnabled: true })} />
      )}
```

Le reste du fichier `Settings.tsx` (blocs Jetons d'accès, Journal d'audit, etc.) n'est pas touché dans ce plan — sa traduction complète fait partie du lot "écrans bottom" (voir spec, section Migration, lot 6).

- [ ] **Step 4: Vérifier le typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: aucune erreur.

- [ ] **Step 5: Test manuel du changement de langue**

Run: `npm run dev:web`, se connecter, aller dans Settings.
Expected: un bloc "Langue" apparaît avec 3 boutons Français/English/தமிழ். Cliquer "English" : le drawer de navigation (rouvrir le menu), la top bar, la bannière de mise à jour (si visible) et le sélecteur de serveur basculent immédiatement en anglais, sans rechargement de page. Recharger la page (F5) : la langue anglaise persiste (localStorage). Cliquer "தமிழ்" : bascule en tamoul. Revenir à "Français" pour laisser l'état par défaut.
Arrêter le serveur dev une fois vérifié.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/layout/LanguageSwitcher.tsx apps/web/public/locales/fr/settings.json apps/web/public/locales/en/settings.json apps/web/public/locales/ta/settings.json apps/web/src/routes/Settings.tsx
git commit -m "feat(web): sélecteur de langue dans Settings"
```

---

## Task 9: Traduire l'écran Login

**Files:**
- Create: `apps/web/public/locales/fr/login.json`
- Create: `apps/web/public/locales/en/login.json`
- Create: `apps/web/public/locales/ta/login.json`
- Modify: `apps/web/src/routes/Login.tsx`

**Interfaces:**
- Consumes: `useTranslation("login")`.
- Produces: rien de consommé par d'autres tâches — Login est un écran terminal.

- [ ] **Step 1: Créer les fichiers `login.json`**

`apps/web/public/locales/fr/login.json`:
```json
{
  "title": "Server Admin — Connexion",
  "usernamePlaceholder": "Identifiant",
  "passwordPlaceholder": "Mot de passe",
  "codePlaceholder": "123456",
  "tokenPlaceholder": "Jeton d'accès",
  "connecting": "Connexion…",
  "verifying": "Vérification…",
  "signIn": "Se connecter",
  "validate": "Valider",
  "tokenSignIn": "Connexion par jeton",
  "backToPassword": "Retour au mot de passe",
  "twoFactorPrompt": "Entrez le code de votre application 2FA.",
  "tokenPrompt": "Collez le jeton d'accès généré depuis un autre appareil connecté (Paramètres → Jetons d'accès).",
  "errors": {
    "loginFailed": "Échec de connexion",
    "invalidToken": "Jeton invalide",
    "invalidCode": "Code invalide",
    "network": "Erreur réseau"
  }
}
```

`apps/web/public/locales/en/login.json`:
```json
{
  "title": "Server Admin — Sign in",
  "usernamePlaceholder": "Username",
  "passwordPlaceholder": "Password",
  "codePlaceholder": "123456",
  "tokenPlaceholder": "Access token",
  "connecting": "Signing in…",
  "verifying": "Verifying…",
  "signIn": "Sign in",
  "validate": "Validate",
  "tokenSignIn": "Sign in with token",
  "backToPassword": "Back to password",
  "twoFactorPrompt": "Enter the code from your 2FA app.",
  "tokenPrompt": "Paste the access token generated from another connected device (Settings → Access tokens).",
  "errors": {
    "loginFailed": "Sign-in failed",
    "invalidToken": "Invalid token",
    "invalidCode": "Invalid code",
    "network": "Network error"
  }
}
```

`apps/web/public/locales/ta/login.json`:
```json
{
  "title": "Server Admin — உள்நுழைவு",
  "usernamePlaceholder": "பயனர்பெயர்",
  "passwordPlaceholder": "கடவுச்சொல்",
  "codePlaceholder": "123456",
  "tokenPlaceholder": "அணுகல் டோக்கன்",
  "connecting": "இணைக்கிறது…",
  "verifying": "சரிபார்க்கிறது…",
  "signIn": "உள்நுழை",
  "validate": "உறுதிப்படுத்து",
  "tokenSignIn": "டோக்கன் மூலம் உள்நுழை",
  "backToPassword": "கடவுச்சொல்லுக்குத் திரும்பு",
  "twoFactorPrompt": "உங்கள் 2FA பயன்பாட்டின் குறியீட்டை உள்ளிடவும்.",
  "tokenPrompt": "மற்றொரு இணைக்கப்பட்ட சாதனத்திலிருந்து உருவாக்கப்பட்ட அணுகல் டோக்கனை ஒட்டவும் (அமைப்புகள் → அணுகல் டோக்கன்கள்).",
  "errors": {
    "loginFailed": "உள்நுழைவு தோல்வியடைந்தது",
    "invalidToken": "தவறான டோக்கன்",
    "invalidCode": "தவறான குறியீடு",
    "network": "நெட்வொர்க் பிழை"
  }
}
```

- [ ] **Step 2: Traduire `Login.tsx`**

État actuel : voir fichier lu ci-dessus, en entier. Toutes les chaînes visibles (placeholders, boutons, messages d'erreur par défaut, textes d'aide) sont en français en dur.

Remplacer le contenu complet par :
```tsx
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import { useAuthStore } from "@/stores/auth.store";

const API_BASE = "/api";

export function Login() {
  const { t } = useTranslation("login");
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [step, setStep] = useState<"credentials" | "2fa" | "token">("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("errors.loginFailed"));
        return;
      }
      if (data.requires2fa) {
        setTempToken(data.tempToken);
        setStep("2fa");
      } else {
        setSession(data.accessToken, null);
        navigate("/");
      }
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }

  async function handleTokenSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/token-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: accessToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("errors.invalidToken"));
        return;
      }
      setSession(data.accessToken, null);
      navigate("/");
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }

  async function handle2faSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/2fa/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tempToken, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("errors.invalidCode"));
        return;
      }
      setSession(data.accessToken, null);
      navigate("/");
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardTitle>{t("title")}</CardTitle>
        {step === "credentials" ? (
          <form onSubmit={handleCredentialsSubmit} className="flex flex-col gap-3">
            <input
              type="text"
              placeholder={t("usernamePlaceholder")}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              required
            />
            <input
              type="password"
              placeholder={t("passwordPlaceholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              required
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading}>
              {loading ? t("connecting") : t("signIn")}
            </Button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep("token");
              }}
              className="text-sm text-muted-foreground underline underline-offset-2"
            >
              {t("tokenSignIn")}
            </button>
          </form>
        ) : step === "2fa" ? (
          <form onSubmit={handle2faSubmit} className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{t("twoFactorPrompt")}</p>
            <input
              type="text"
              inputMode="numeric"
              placeholder={t("codePlaceholder")}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
              className="rounded-md border border-border bg-transparent px-3 py-2 text-center text-lg tracking-widest outline-none focus:ring-2 focus:ring-primary"
              required
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading}>
              {loading ? t("verifying") : t("validate")}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleTokenSubmit} className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{t("tokenPrompt")}</p>
            <input
              type="password"
              placeholder={t("tokenPlaceholder")}
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              autoComplete="off"
              className="rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              required
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading}>
              {loading ? t("connecting") : t("signIn")}
            </Button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep("credentials");
              }}
              className="text-sm text-muted-foreground underline underline-offset-2"
            >
              {t("backToPassword")}
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Vérifier le typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: aucune erreur.

- [ ] **Step 4: Test manuel de bout en bout**

Run: `npm run dev:web`, se déconnecter (ou ouvrir un onglet privé) pour atteindre `/login`.
Expected en `fr` (par défaut) : écran de connexion identique à avant. Changer la langue depuis Settings n'est pas possible ici (pas encore connecté) — pour tester `en`/`ta` sur Login, éditer temporairement `localStorage.pwa-admin-language` dans les devtools (`{"state":{"language":"en"},"version":0}`) et recharger, ou utiliser le sélecteur après connexion puis se déconnecter (la langue reste en `localStorage`, indépendante de la session). Vérifier que tous les placeholders, boutons et messages d'aide s'affichent dans la langue choisie, et que soumettre un mauvais mot de passe affiche un message d'erreur traduit.
Remettre `fr` avant de terminer.

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/locales/fr/login.json apps/web/public/locales/en/login.json apps/web/public/locales/ta/login.json apps/web/src/routes/Login.tsx
git commit -m "feat(web): traduire l'écran de connexion via i18next"
```

---

## Task 10: Enregistrer tous les namespaces au démarrage et vérification finale

**Files:**
- Modify: `apps/web/src/lib/i18n.ts`

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: liste `ns` complète pour ce plan — les plans suivants (lots d'écrans) devront y ajouter leurs propres namespaces au fur et à mesure.

- [ ] **Step 1: Ajouter `settings` et `login` à la liste `ns` de `lib/i18n.ts`**

État actuel après Task 3 : `ns: ["common", "nav"]`.

Modifier dans `apps/web/src/lib/i18n.ts` :
```ts
    ns: ["common", "nav", "settings", "login"],
```

- [ ] **Step 2: Vérifier le typecheck complet**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: aucune erreur.

- [ ] **Step 3: Vérifier le build de production**

Run (depuis la racine du repo) :
```bash
npm run build --workspace=packages/shared
npm run build:web
```
Expected: build réussi sans erreur, `apps/web/dist/` généré, et `apps/web/dist/locales/{fr,en,ta}/*.json` présents (copie automatique de `public/` par Vite).

- [ ] **Step 4: Test manuel final de régression**

Run: `npm run dev:web`. Parcourir : Login → connexion → Dashboard → ouvrir le drawer → Settings → changer de langue (FR/EN/TA) → vérifier que le drawer, la top bar et le bloc Langue changent bien, → se déconnecter → vérifier que Login reste dans la langue choisie.
Expected: aucune régression visuelle sur le chrome partagé, aucune clé de traduction manquante visible (pas de texte du type `nav:dashboard` affiché brut — signe d'une clé introuvable).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/i18n.ts
git commit -m "feat(web): enregistrer les namespaces settings et login au démarrage"
```

---

## Fin de ce plan

À ce stade : infrastructure i18next complète, chrome de l'application (drawer, top bar, bannière de mise à jour, sélecteur de serveur) et écran Login entièrement traduits en FR/EN/TA, sélecteur de langue fonctionnel et persistant dans Settings. Les ~18 écrans restants (Dashboard, Docker, Nginx, Sites, OsSystem, Pm2, NetworkSecurity, Security, Wizard + composants wizard, Applications, Backups, Restore, UsbExplorer, System, Services, Help, About, reste de Settings) seront couverts par des plans ultérieurs, un par lot tel que défini dans le spec (section "Migration du contenu").

Prochaine étape suggérée : déployer et valider ce plan sur le serveur de production (pas de staging, cf. CLAUDE.md) avant d'écrire le plan du lot suivant.
