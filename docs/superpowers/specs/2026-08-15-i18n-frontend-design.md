# Multi-langue frontend (FR/EN/TA) — Spec

Date : 2026-08-15
Statut : validé, prêt pour plan d'implémentation

## Contexte

L'app est actuellement 100% en français, chaînes codées en dur dans ~19 écrans
(`apps/web/src/routes/`) et les composants partagés (`components/layout/`,
`components/wizard/`, `components/ui/`), soit environ 11 400 lignes de JSX.
L'admin veut pouvoir basculer l'interface en anglais et en tamoul.

## Périmètre

**Dans le périmètre** :
- Toute l'interface web statique : labels, boutons, titres, messages de
  validation côté client, tooltips, texte de navigation (`navItems.ts`,
  `externalNavItems.ts`).
- Sélecteur de langue dans Settings, persistance par navigateur.
- Détection automatique de la langue navigateur au premier lancement.

**Hors périmètre** (chantier séparé, session future) :
- Messages d'erreur renvoyés par `apps/api` (actuellement des chaînes
  françaises libres dans les handlers Fastify, 69+ points d'appel dans 12+
  modules). Continueront d'apparaître en français quelle que soit la langue
  choisie côté frontend, jusqu'à ce que l'API expose des codes d'erreur
  structurés traduisibles.
- Sorties brutes de commandes système affichées telles quelles (logs Docker,
  PM2, Nginx, résultats `apt`/`ufw`) — ce sont des données, pas de l'UI.
- Contenu du plugin privé `imanote` (non modifié depuis ce dépôt, cf. règle
  établie dans CLAUDE.md).

## Stack

- **i18next** + **react-i18next** — gestion des traductions et hook `useTranslation()`.
- **i18next-browser-languagedetector** — détecte `navigator.language` au
  premier lancement (avant tout choix explicite de l'utilisateur), retombe
  sur `fr` si la langue détectée n'est pas parmi `fr`/`en`/`ta`.
- **i18next-http-backend** — charge les namespaces JSON à la demande depuis
  `public/locales/`, pas d'embarquement de toutes les traductions dans le
  bundle JS initial.

Nouvelles dépendances dans `apps/web/package.json` : `i18next`,
`react-i18next`, `i18next-browser-languagedetector`, `i18next-http-backend`.

## Organisation des fichiers

```
apps/web/public/locales/
  fr/
    common.json       # boutons partagés, statuts, confirmations, erreurs génériques
    nav.json           # labels de navItems.ts / externalNavItems.ts
    dashboard.json
    docker.json
    nginx.json
    sites.json
    os.json
    pm2.json
    network.json
    security.json
    wizard.json
    applications.json
    backups.json
    restore.json
    usbExplorer.json
    system.json
    services.json
    help.json
    about.json
    settings.json
    login.json
  en/
    (même structure)
  ta/
    (même structure)
```

Un namespace = un fichier `apps/web/src/routes/<Écran>.tsx` (correspondance
1:1), plus `common` pour tout ce qui est partagé entre plusieurs écrans
(boutons Annuler/Confirmer/Enregistrer, libellés de statut Actif/Inactif,
dialogues de confirmation génériques) et `nav` pour le drawer de navigation.
Les composants sous `components/wizard/` utilisent le namespace `wizard`;
`components/layout/` et `components/ui/` utilisent `common`.

## Initialisation i18next

Nouveau fichier `apps/web/src/lib/i18n.ts`, importé une fois au point d'entrée
(`main.tsx`) avant le rendu de `<App/>`. Configuration :
- `fallbackLng: "fr"`
- `supportedLngs: ["fr", "en", "ta"]`
- `ns`: liste de tous les namespaces ci-dessus, chargés à la demande par écran
  (chaque route appelle `useTranslation("dashboard")` par exemple — charge
  paresseux, cohérent avec le souci de perf déjà présent dans ce projet).
- backend `loadPath: "/locales/{{lng}}/{{ns}}.json"`.

## Store de préférence de langue

Nouveau `apps/web/src/stores/language.store.ts`, calqué exactement sur
`uiMode.store.ts` (Zustand + middleware `persist`) :

```ts
export type Language = "fr" | "en" | "ta";

interface LanguageState {
  language: Language | null; // null = pas de choix explicite, on suit la détection navigateur
  setLanguage: (lang: Language) => void;
}
```

- Persisté sous la clé localStorage `pwa-admin-language`.
- Préférence par navigateur/appareil uniquement, jamais envoyée au backend ni
  liée à l'identité utilisateur — même justification que `uiMode.store.ts` et
  `serverConnections.store.ts` (pas de système de rôles/permissions dans cette
  app, chaque device a sa propre préférence).
- Un effet dans `App.tsx` (ou un petit hook `useSyncLanguage()`) appelle
  `i18n.changeLanguage()` quand `language` change dans le store, et à
  l'initialisation si `language !== null` (sinon on laisse
  `i18next-browser-languagedetector` faire la détection auto).

## Sélecteur de langue (Settings)

Nouveau bloc `<Card>` "Langue" dans `apps/web/src/routes/Settings.tsx`, placé
après le bloc "Compte" existant. Trois boutons (FR / EN / TA) ou un `<select>`
— composant `LanguageSwitcher` dans `components/layout/`, suit le style
visuel déjà établi (Card, Button de `components/ui/`). Change immédiatement
la langue affichée sans rechargement de page (react-i18next re-render réactif
via le hook `useTranslation`).

## Migration du contenu — approche par lots

Ordre de migration (chaque lot = un commit revuable, `tsc --noEmit` après
chaque lot) :

1. **Infrastructure** : install dépendances, `lib/i18n.ts`,
   `stores/language.store.ts`, `LanguageSwitcher`, bloc Settings, `main.tsx`.
   `common.json` et `nav.json` créés avec les chaînes vraiment partagées.
2. **Layout partagé** : `Shell.tsx`, `TopBar.tsx`, `AppDrawer.tsx`,
   `navItems.ts`/`externalNavItems.ts`, `RequireAuth.tsx`, `UpdateBanner.tsx`,
   `PullToRefresh.tsx`, `ServerSwitcher.tsx`. Visible sur tous les écrans —
   migré tôt pour valider le mécanisme avant le gros du travail.
3. **Login** (premier écran vu, namespace isolé, bon deuxième test).
4. **Écrans "management"** : Docker, Nginx, Sites, OsSystem, Pm2,
   NetworkSecurity, Security.
5. **Écrans "ops"** : Wizard (+ `components/wizard/**`), Applications,
   Backups, Restore, UsbExplorer, System, Services.
6. **Écrans "bottom"** : Help, About, Settings (reste du fichier).
7. **Composants UI génériques restants** : `ConfirmDialog.tsx`,
   `LiveLogPanel.tsx`, `StatusLed.tsx`, `Card.tsx`/`Button.tsx` si des
   chaînes littérales y sont codées en dur.

Pour chaque fichier migré : extraction des chaînes françaises visibles en
clés `t("clé.imbriquée")`, ajout dans `fr/<namespace>.json`, traduction
manuelle en `en/<namespace>.json` et `ta/<namespace>.json`. Les chaînes
interpolées (ex: `` `${count} paquets` ``) utilisent l'interpolation
i18next (`t("packages.count", { count })`) plutôt que de la concaténation.

## Ce qui ne change pas

- Les identifiants de code, noms de variables, commentaires, messages de
  commit restent en anglais (déjà la convention du projet).
- Les données brutes affichées telles quelles (JSON de config Nginx, logs de
  conteneurs, sorties `df -h`) ne sont pas traduites.
- Aucun changement backend dans cette phase.

## Tests

- `npx tsc --noEmit -p tsconfig.json` sur `apps/web` après chaque lot.
- `npm run dev:web`, vérification visuelle du changement de langue (FR → EN
  → TA) sur : Login, Dashboard, Settings, puis un écran de chaque lot migré.
- Vérifier que la détection automatique navigateur fonctionne (changer la
  langue du navigateur, vider localStorage, recharger).
- Vérifier qu'aucune clé de traduction manquante n'apparaît (i18next log en
  mode dev si une clé est absente — à surveiller dans la console).

## Risques / points d'attention

- Pas d'environnement de staging — chaque lot testé en local (`dev:web`)
  avant commit, déploiement final sur le serveur de prod comme d'habitude
  (`build --workspace=packages/shared` → `build:api` → `build:web`,
  redémarrage manuel du service).
- Traduction tamoule : à défaut de locuteur tamoul dans l'équipe, les
  traductions seront générées avec soin mais devront idéalement être
  relues par un locuteur natif avant une large diffusion — signalé mais non
  bloquant pour cette phase.
- `navItems.ts` exporte actuellement des `label: string` statiques utilisés
  directement dans `AppDrawer.tsx` — devra passer à des clés de traduction
  résolues via `t()` au moment du rendu plutôt qu'à la définition du tableau
  (les hooks React ne peuvent pas être appelés au niveau module).
