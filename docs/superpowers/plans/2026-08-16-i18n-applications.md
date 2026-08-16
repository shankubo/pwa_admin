# Multi-langue — Écran Applications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Traduire en FR/EN/TA l'écran `Applications.tsx` (897 lignes, le système de sauvegarde le plus complet — conteneur + dossiers + volumes + base de données regroupés), deuxième écran du lot "ops" du spec i18n après Wizard.

**Architecture:** Un seul namespace `applications` pour tout l'écran (`CronPicker`, `HelpPanel`, `Applications`, `AppCard`, `AppImageHistory`, `DriveUploadIndicator`, `AppRunHistory`, `NewAppForm`). Écran scindé en 2 tâches vu sa taille (897 lignes) et sa densité en texte explicatif long : Task 1 couvre les composants d'affichage/consultation (`CronPicker`, `HelpPanel`, `Applications`, `AppCard`, `AppImageHistory`, `DriveUploadIndicator`, `AppRunHistory`) ; Task 2 couvre le formulaire de création (`NewAppForm`), le plus gros composant isolé.

**Tech Stack:** react-i18next (déjà installé et opérationnel), TypeScript, Vite.

**Spec:** [docs/superpowers/specs/2026-08-15-i18n-frontend-design.md](../specs/2026-08-15-i18n-frontend-design.md)

## Global Constraints

- Langues supportées : `fr` (défaut/fallback), `en`, `ta`. Namespace unique `applications` sous `apps/web/public/locales/<lng>/applications.json`.
- Le namespace `applications` doit être ajouté à la liste `ns` de `apps/web/src/lib/i18n.ts` — lire l'état actuel avant de modifier (ajout dans Task 1 seulement).
- `formatBytes` importé depuis `./Docker` (déjà traduit, signature inchangée) — ne pas y toucher.
- Les chaînes interpolées utilisent l'interpolation i18next, jamais de concaténation. Attention particulière aux pluriels français ("chemin(s)", "volume(s)", "fichier(s)") — utiliser la convention i18next `_one`/`_other`.
- Les valeurs techniques (noms de conteneur/volume/base de données, statuts bruts type "success"/"failed", expressions cron comme `0 3 * * *`, cibles `local`/`gdrive`/`usb` affichées telles quelles dans les checkboxes du formulaire) ne sont PAS traduites — seul le texte d'interface autour l'est.
- Après chaque tâche : `npx tsc --noEmit -p apps/web/tsconfig.json` (depuis la racine du repo) doit passer sans erreur. Note : fichier privé non suivi `apps/web/src/routes/ImaNote.tsx` cause des erreurs TS2305 préexistantes sans rapport — déplacer temporairement si besoin d'un signal propre.
- Aucun changement backend — hors périmètre.
- Tout le contenu traité est du texte d'interface original de cette application.

---

## Task 1: Traduire `CronPicker`, `HelpPanel`, `Applications`, `AppCard`, `AppImageHistory`, `DriveUploadIndicator`, `AppRunHistory`

**Files:**
- Create: `apps/web/public/locales/fr/applications.json`
- Create: `apps/web/public/locales/en/applications.json`
- Create: `apps/web/public/locales/ta/applications.json`
- Modify: `apps/web/src/routes/Applications.tsx` (lignes 1-593 du fichier actuel : tout sauf `NewAppForm`, qui reste identique à l'original — Task 2 s'en charge)
- Modify: `apps/web/src/lib/i18n.ts`

**Interfaces:**
- Consumes: `useTranslation("applications")`, `formatBytes` de `./Docker` (inchangé).
- Produces: les 3 fichiers `applications.json` créés ici seront complétés par Task 2 (ajout de clés `newAppForm` sans toucher aux clés créées ici).

État actuel des composants concernés : voir le contenu lu ci-dessus, lignes 1 à 593. Chaînes à extraire :

**`CronPicker`** (l.36-125) : les 8 `CRON_PRESETS` avec `label`+`hint` chacun (l.43-50), options de select "Désactivé"/"Fréquence prédéfinie"/"Expression cron personnalisée" (l.85-87), placeholder d'exemple cron (l.108, reste technique/non traduit — syntaxe cron), texte d'aide format cron (l.114-115, avec un exemple `0 3 * * *` qui reste non traduit).

**`HelpPanel`** (l.127-214) : question "Comment fonctionne ce système de sauvegarde ?" (l.139), 5 sections avec titre+paragraphe(s) longs : "Qu'est-ce qu'une « Application » ?" (l.151-158), "Backup complet vs backup partiel" (l.162-179, avec liste à puces "Complet"/"Partiel"), "Planification automatique" (l.183-189), "Restauration" (l.193-199), "Stockage local et Google Drive" (l.203-208).

**`Applications`** (l.216-309) : "Applications" (titre section, l.272), boutons "Annuler"/"Nouvelle application" (l.274), "Chargement…" (l.290), "Aucune application configurée." (l.292).

**`AppCard`** (l.317-402) : pluriel "{{count}} chemin(s)" (l.347, interpolé), pluriel "{{count}} volume(s)" (l.349, interpolé), "cibles : {{targets}}" avec suffixes optionnels full/partial cron (l.361-363, techniques non traduits sauf le mot "cibles"), boutons "Backup complet"/"Backup partiel" (l.369, 372), titre+label confirmation suppression "Supprimer l'application {{name}} ?"/"Supprimer" (l.380-381, interpolé), lien "Voir dans Restore" (l.396).

**`AppImageHistory`** (l.410-461) : "Images de conteneur sauvegardées" (l.431).

**`DriveUploadIndicator`** (l.466-515) : "En attente d'envoi vers Google Drive…" (l.473), "Préparation de l'archive avant envoi… (peut prendre plusieurs minutes pour de gros dossiers)" (l.480), "Envoi vers Google Drive… {{pct}}%" (l.488, interpolé), "Envoyé sur Google Drive ({{count}} fichier(s))" (l.501-502, interpolé pluriel), "Échec de l'envoi vers Google Drive{{suffix}}" (l.508-509, interpolé avec suffixe optionnel).

**`AppRunHistory`** (l.520-593) : "Historique des runs" (l.547), "Chargement…" (l.549), "Aucun run pour cette application." (l.550), badges "Backup complet"/"Backup partiel" (l.561), durée interpolée "{{duration}}s" (l.579, reste numérique non traduit — juste le suffixe "s" est universel), "{{count}} fichiers modifiés" (l.583, interpolé pluriel).

- [ ] **Step 1: Créer les fichiers `applications.json` (première moitié — Task 2 les complétera)**

`apps/web/public/locales/fr/applications.json`:
```json
{
  "cronPresets": {
    "hourly": { "label": "Toutes les heures", "hint": "à chaque heure pile" },
    "every6h": { "label": "Toutes les 6 heures", "hint": "00h, 06h, 12h, 18h" },
    "daily2am": { "label": "Quotidien à 2h", "hint": "chaque jour à 2h00 du matin" },
    "daily3am": { "label": "Quotidien à 3h", "hint": "chaque jour à 3h00 du matin" },
    "every12h": { "label": "Toutes les 12h", "hint": "00h et 12h" },
    "weeklySun3am": { "label": "Hebdomadaire (dimanche 3h)", "hint": "chaque dimanche à 3h00" },
    "weeklyMon3am": { "label": "Hebdomadaire (lundi 3h)", "hint": "chaque lundi à 3h00" },
    "monthly3am": { "label": "Mensuel (1er du mois, 3h)", "hint": "le 1er de chaque mois à 3h00" }
  },
  "cronPicker": {
    "disabled": "Désactivé",
    "presetMode": "Fréquence prédéfinie",
    "customMode": "Expression cron personnalisée",
    "customPlaceholder": "ex: 0 3 * * * (minute heure jour mois jour-semaine)",
    "formatHelp": "Format : minute (0-59) heure (0-23) jour-du-mois (1-31) mois (1-12) jour-semaine (0-6, 0=dimanche). Ex : {{example}} = tous les jours à 3h00."
  },
  "help": {
    "question": "Comment fonctionne ce système de sauvegarde ?",
    "whatIsApp": {
      "title": "Qu'est-ce qu'une « Application » ?",
      "text": "Un regroupement logique de tout ce qui appartient à un même site/service que vous gérez sur le Pi : son ou ses conteneurs Docker, les dossiers qui contiennent ses vraies données (photos, uploads, fichiers de config — ce qu'on appelle des « bind mounts »), et éventuellement sa base de données. Sans ce regroupement, il faudrait sauvegarder chaque dossier et chaque base séparément et se souvenir lesquels vont ensemble."
    },
    "fullVsPartial": {
      "title": "Backup complet vs backup partiel",
      "fullLabel": "Complet",
      "fullText": " : capture l'état entier des dossiers à cet instant, comme un point de sauvegarde autonome.",
      "partialLabel": "Partiel",
      "partialText": " : ne copie physiquement que les fichiers nouveaux ou modifiés depuis le dernier backup (complet ou partiel). Les fichiers inchangés ne sont pas dupliqués — ils sont liés au backup précédent, donc chaque backup partiel reste consultable comme un instantané complet, sans consommer d'espace disque supplémentaire pour ce qui n'a pas changé.",
      "dbNote": "La base de données, elle, est toujours sauvegardée intégralement à chaque backup (complet ou partiel) — les dumps de base de données sont rapides, il n'y a pas besoin de version « partielle »."
    },
    "scheduling": {
      "title": "Planification automatique",
      "text": "Une bonne pratique courante : backup partiel tous les jours (rapide, capture les changements récents) et backup complet une fois par semaine (point de repère solide et indépendant). Les deux plannings sont indépendants et optionnels — vous pouvez aussi tout déclencher manuellement avec les boutons « Backup complet » / « Backup partiel » sur chaque application."
    },
    "restore": {
      "title": "Restauration",
      "text": "Dépliez une application pour voir son historique de backups, puis choisissez un point dans le temps à restaurer. La restauration écrase les fichiers actuels par ceux du backup choisi — une confirmation explicite (taper « RESTORE ») est demandée avant toute action, et un backup de sécurité de l'état actuel est automatiquement pris juste avant, au cas où."
    },
    "storage": {
      "title": "Stockage local et Google Drive",
      "text": "Les backups sont toujours écrits localement sur le Pi. Vous pouvez en plus cocher « gdrive » pour qu'une copie soit envoyée automatiquement sur Google Drive (nécessite d'être connecté depuis l'écran Backups) — utile pour survivre à une panne du Pi lui-même, pas seulement à une erreur applicative."
    }
  },
  "sectionTitle": "Applications",
  "cancel": "Annuler",
  "newApp": "Nouvelle application",
  "loading": "Chargement…",
  "empty": "Aucune application configurée.",
  "paths_one": "{{count}} chemin",
  "paths_other": "{{count}} chemins",
  "volumes_one": "{{count}} volume",
  "volumes_other": "{{count}} volumes",
  "targetsLabel": "cibles : {{targets}}",
  "fullBackup": "Backup complet",
  "partialBackup": "Backup partiel",
  "deleteConfirm": {
    "title": "Supprimer l'application {{name}} ?",
    "confirmLabel": "Supprimer"
  },
  "viewInRestore": "Voir dans Restore",
  "imageHistoryTitle": "Images de conteneur sauvegardées",
  "driveUpload": {
    "pending": "En attente d'envoi vers Google Drive…",
    "compressing": "Préparation de l'archive avant envoi… (peut prendre plusieurs minutes pour de gros dossiers)",
    "uploading": "Envoi vers Google Drive… {{pct}}%",
    "success_one": "Envoyé sur Google Drive ({{count}} fichier)",
    "success_other": "Envoyé sur Google Drive ({{count}} fichiers)",
    "failed": "Échec de l'envoi vers Google Drive{{suffix}}",
    "failedSuffix": " : {{error}}"
  },
  "runHistory": {
    "title": "Historique des runs",
    "loading": "Chargement…",
    "empty": "Aucun run pour cette application.",
    "durationSuffix": " · {{duration}}s",
    "filesChanged_one": "{{count}} fichier modifié",
    "filesChanged_other": "{{count}} fichiers modifiés"
  }
}
```

`apps/web/public/locales/en/applications.json`:
```json
{
  "cronPresets": {
    "hourly": { "label": "Every hour", "hint": "on the hour" },
    "every6h": { "label": "Every 6 hours", "hint": "00:00, 06:00, 12:00, 18:00" },
    "daily2am": { "label": "Daily at 2am", "hint": "every day at 2:00am" },
    "daily3am": { "label": "Daily at 3am", "hint": "every day at 3:00am" },
    "every12h": { "label": "Every 12h", "hint": "00:00 and 12:00" },
    "weeklySun3am": { "label": "Weekly (Sunday 3am)", "hint": "every Sunday at 3:00am" },
    "weeklyMon3am": { "label": "Weekly (Monday 3am)", "hint": "every Monday at 3:00am" },
    "monthly3am": { "label": "Monthly (1st of month, 3am)", "hint": "the 1st of every month at 3:00am" }
  },
  "cronPicker": {
    "disabled": "Disabled",
    "presetMode": "Preset frequency",
    "customMode": "Custom cron expression",
    "customPlaceholder": "e.g. 0 3 * * * (minute hour day month weekday)",
    "formatHelp": "Format: minute (0-59) hour (0-23) day-of-month (1-31) month (1-12) day-of-week (0-6, 0=Sunday). E.g.: {{example}} = every day at 3:00am."
  },
  "help": {
    "question": "How does this backup system work?",
    "whatIsApp": {
      "title": "What is an \"Application\"?",
      "text": "A logical grouping of everything belonging to the same site/service you manage on the Pi: its Docker container(s), the folders holding its real data (photos, uploads, config files — known as \"bind mounts\"), and optionally its database. Without this grouping, you'd have to back up each folder and database separately and remember which ones belong together."
    },
    "fullVsPartial": {
      "title": "Full backup vs partial backup",
      "fullLabel": "Full",
      "fullText": ": captures the entire state of the folders at that moment, as a standalone backup point.",
      "partialLabel": "Partial",
      "partialText": ": only physically copies files that are new or modified since the last backup (full or partial). Unchanged files aren't duplicated — they're linked to the previous backup, so every partial backup remains browsable as a complete snapshot, without using extra disk space for what hasn't changed.",
      "dbNote": "The database, on the other hand, is always backed up in full on every backup (full or partial) — database dumps are fast, so there's no need for a \"partial\" version."
    },
    "scheduling": {
      "title": "Automatic scheduling",
      "text": "A common good practice: partial backup every day (fast, captures recent changes) and full backup once a week (a solid, independent reference point). Both schedules are independent and optional — you can also trigger everything manually with the \"Full backup\" / \"Partial backup\" buttons on each application."
    },
    "restore": {
      "title": "Restore",
      "text": "Expand an application to see its backup history, then pick a point in time to restore. Restoring overwrites the current files with those from the chosen backup — explicit confirmation (typing \"RESTORE\") is required before any action, and a safety backup of the current state is automatically taken just before, just in case."
    },
    "storage": {
      "title": "Local storage and Google Drive",
      "text": "Backups are always written locally on the Pi. You can additionally check \"gdrive\" to have a copy automatically sent to Google Drive (requires being connected from the Backups screen) — useful to survive a failure of the Pi itself, not just an application error."
    }
  },
  "sectionTitle": "Applications",
  "cancel": "Cancel",
  "newApp": "New application",
  "loading": "Loading…",
  "empty": "No application configured.",
  "paths_one": "{{count}} path",
  "paths_other": "{{count}} paths",
  "volumes_one": "{{count}} volume",
  "volumes_other": "{{count}} volumes",
  "targetsLabel": "targets: {{targets}}",
  "fullBackup": "Full backup",
  "partialBackup": "Partial backup",
  "deleteConfirm": {
    "title": "Delete application {{name}}?",
    "confirmLabel": "Delete"
  },
  "viewInRestore": "View in Restore",
  "imageHistoryTitle": "Saved container images",
  "driveUpload": {
    "pending": "Waiting to send to Google Drive…",
    "compressing": "Preparing archive before sending… (can take several minutes for large folders)",
    "uploading": "Sending to Google Drive… {{pct}}%",
    "success_one": "Sent to Google Drive ({{count}} file)",
    "success_other": "Sent to Google Drive ({{count}} files)",
    "failed": "Failed to send to Google Drive{{suffix}}",
    "failedSuffix": ": {{error}}"
  },
  "runHistory": {
    "title": "Run history",
    "loading": "Loading…",
    "empty": "No run for this application.",
    "durationSuffix": " · {{duration}}s",
    "filesChanged_one": "{{count}} file changed",
    "filesChanged_other": "{{count}} files changed"
  }
}
```

`apps/web/public/locales/ta/applications.json`:
```json
{
  "cronPresets": {
    "hourly": { "label": "ஒவ்வொரு மணி நேரமும்", "hint": "மணி நேரத்திற்கு ஒருமுறை" },
    "every6h": { "label": "ஒவ்வொரு 6 மணி நேரமும்", "hint": "00, 06, 12, 18 மணி" },
    "daily2am": { "label": "தினமும் அதிகாலை 2 மணி", "hint": "ஒவ்வொரு நாளும் அதிகாலை 2:00" },
    "daily3am": { "label": "தினமும் அதிகாலை 3 மணி", "hint": "ஒவ்வொரு நாளும் அதிகாலை 3:00" },
    "every12h": { "label": "ஒவ்வொரு 12 மணி நேரமும்", "hint": "00 மற்றும் 12 மணி" },
    "weeklySun3am": { "label": "வாராந்திரம் (ஞாயிறு 3 மணி)", "hint": "ஒவ்வொரு ஞாயிறும் அதிகாலை 3:00" },
    "weeklyMon3am": { "label": "வாராந்திரம் (திங்கள் 3 மணி)", "hint": "ஒவ்வொரு திங்களும் அதிகாலை 3:00" },
    "monthly3am": { "label": "மாதாந்திரம் (மாதத்தின் 1ம் தேதி, 3 மணி)", "hint": "ஒவ்வொரு மாதமும் 1ம் தேதி அதிகாலை 3:00" }
  },
  "cronPicker": {
    "disabled": "முடக்கப்பட்டது",
    "presetMode": "முன்னரே அமைக்கப்பட்ட அதிர்வெண்",
    "customMode": "தனிப்பயன் cron வெளிப்பாடு",
    "customPlaceholder": "எ.கா: 0 3 * * * (நிமிடம் மணி நாள் மாதம் வார-நாள்)",
    "formatHelp": "வடிவம்: நிமிடம் (0-59) மணி (0-23) மாத-நாள் (1-31) மாதம் (1-12) வார-நாள் (0-6, 0=ஞாயிறு). எ.கா: {{example}} = ஒவ்வொரு நாளும் அதிகாலை 3:00."
  },
  "help": {
    "question": "இந்த காப்புப்பிரதி அமைப்பு எவ்வாறு செயல்படுகிறது?",
    "whatIsApp": {
      "title": "« பயன்பாடு » என்றால் என்ன?",
      "text": "Pi இல் நீங்கள் நிர்வகிக்கும் ஒரே தளம்/சேவைக்கு சொந்தமான அனைத்தையும் ஒன்றிணைத்த தொகுப்பு: அதன் Docker கொள்கலன்(கள்), அதன் உண்மையான தரவைக் கொண்ட கோப்புறைகள் (புகைப்படங்கள், பதிவேற்றங்கள், கட்டமைப்பு கோப்புகள் — « bind mounts » என்று அழைக்கப்படுகின்றன), மற்றும் விருப்பமாக அதன் தரவுத்தளம். இந்த தொகுப்பு இல்லாமல், ஒவ்வொரு கோப்புறை மற்றும் தரவுத்தளத்தையும் தனித்தனியாக காப்புப்பிரதி எடுத்து எவை ஒன்றாக செல்கின்றன என்பதை நினைவில் வைத்திருக்க வேண்டும்."
    },
    "fullVsPartial": {
      "title": "முழு காப்புப்பிரதி vs பகுதி காப்புப்பிரதி",
      "fullLabel": "முழுமையான",
      "fullText": " : அந்த நேரத்தில் கோப்புறைகளின் முழு நிலையையும் ஒரு தன்னிச்சையான காப்புப்புள்ளியாக பிடிக்கிறது.",
      "partialLabel": "பகுதி",
      "partialText": " : கடைசி காப்புப்பிரதியிலிருந்து (முழுமையான அல்லது பகுதி) புதிய அல்லது மாற்றப்பட்ட கோப்புகளை மட்டுமே இயற்பியல் ரீதியாக நகலெடுக்கிறது. மாறாத கோப்புகள் நகலெடுக்கப்படுவதில்லை — அவை முந்தைய காப்புப்பிரதியுடன் இணைக்கப்பட்டுள்ளன, எனவே ஒவ்வொரு பகுதி காப்புப்பிரதியும் மாறாதவற்றுக்கு கூடுதல் வட்டு இடத்தை பயன்படுத்தாமல் முழுமையான ஸ்னாப்ஷாட்டாக பார்வையிடக்கூடியதாக இருக்கும்.",
      "dbNote": "தரவுத்தளம் மறுபுறம், ஒவ்வொரு காப்புப்பிரதியிலும் (முழுமையான அல்லது பகுதி) எப்போதும் முழுமையாக காப்புப்பிரதி எடுக்கப்படுகிறது — தரவுத்தள dump கள் வேகமானவை, « பகுதி » பதிப்பு தேவையில்லை."
    },
    "scheduling": {
      "title": "தானியங்கி திட்டமிடல்",
      "text": "பொதுவான நல்ல நடைமுறை: தினமும் பகுதி காப்புப்பிரதி (வேகமானது, சமீபத்திய மாற்றங்களைப் பிடிக்கிறது) மற்றும் வாரத்திற்கு ஒரு முறை முழுமையான காப்புப்பிரதி (உறுதியான, சுயாதீன குறிப்புப் புள்ளி). இரண்டு அட்டவணைகளும் சுயாதீனமானவை மற்றும் விருப்பமானவை — ஒவ்வொரு பயன்பாட்டிலும் « முழு காப்புப்பிரதி » / « பகுதி காப்புப்பிரதி » பொத்தான்களுடன் நீங்கள் அனைத்தையும் கைமுறையாகவும் தொடங்கலாம்."
    },
    "restore": {
      "title": "மீட்டமை",
      "text": "ஒரு பயன்பாட்டின் காப்புப்பிரதி வரலாற்றைப் பார்க்க அதை விரிவாக்கவும், பின்னர் மீட்டமைக்க ஒரு நேரப் புள்ளியைத் தேர்ந்தெடுக்கவும். மீட்டமைத்தல் தற்போதைய கோப்புகளை தேர்ந்தெடுக்கப்பட்ட காப்புப்பிரதியின் கோப்புகளால் மேலெழுதுகிறது — எந்த செயலுக்கும் முன் வெளிப்படையான உறுதிப்படுத்தல் (« RESTORE » என தட்டச்சு செய்தல்) கேட்கப்படுகிறது, மற்றும் தற்போதைய நிலையின் பாதுகாப்பு காப்புப்பிரதி தானாகவே அதற்கு முன் எடுக்கப்படுகிறது, ஏதேனும் ஏற்பட்டால்."
    },
    "storage": {
      "title": "உள்ளூர் சேமிப்பு மற்றும் Google Drive",
      "text": "காப்புப்பிரதிகள் எப்போதும் Pi இல் உள்ளூரில் எழுதப்படுகின்றன. Google Drive க்கு ஒரு நகல் தானாக அனுப்பப்பட « gdrive » ஐ கூடுதலாக தேர்வு செய்யலாம் (Backups திரையிலிருந்து இணைக்கப்பட்டிருக்க வேண்டும்) — இது Pi இன் சொந்த செயலிழப்பிலிருந்து மீள பயனுள்ளதாக இருக்கும், வெறும் பயன்பாட்டு பிழையிலிருந்து மட்டுமல்ல."
    }
  },
  "sectionTitle": "பயன்பாடுகள்",
  "cancel": "ரத்துசெய்",
  "newApp": "புதிய பயன்பாடு",
  "loading": "ஏற்றுகிறது…",
  "empty": "பயன்பாடு எதுவும் கட்டமைக்கப்படவில்லை.",
  "paths_one": "{{count}} பாதை",
  "paths_other": "{{count}} பாதைகள்",
  "volumes_one": "{{count}} தொகுதி",
  "volumes_other": "{{count}} தொகுதிகள்",
  "targetsLabel": "இலக்குகள்: {{targets}}",
  "fullBackup": "முழு காப்புப்பிரதி",
  "partialBackup": "பகுதி காப்புப்பிரதி",
  "deleteConfirm": {
    "title": "{{name}} பயன்பாட்டை நீக்கவா?",
    "confirmLabel": "நீக்கு"
  },
  "viewInRestore": "Restore இல் காண்க",
  "imageHistoryTitle": "காப்புப்பிரதி எடுக்கப்பட்ட கொள்கலன் படங்கள்",
  "driveUpload": {
    "pending": "Google Drive க்கு அனுப்ப காத்திருக்கிறது…",
    "compressing": "அனுப்பும் முன் காப்பகத்தை தயார்படுத்துகிறது… (பெரிய கோப்புறைகளுக்கு பல நிமிடங்கள் ஆகலாம்)",
    "uploading": "Google Drive க்கு அனுப்புகிறது… {{pct}}%",
    "success_one": "Google Drive க்கு அனுப்பப்பட்டது ({{count}} கோப்பு)",
    "success_other": "Google Drive க்கு அனுப்பப்பட்டது ({{count}} கோப்புகள்)",
    "failed": "Google Drive க்கு அனுப்புவதில் தோல்வி{{suffix}}",
    "failedSuffix": ": {{error}}"
  },
  "runHistory": {
    "title": "Run வரலாறு",
    "loading": "ஏற்றுகிறது…",
    "empty": "இந்த பயன்பாட்டிற்கு run எதுவும் இல்லை.",
    "durationSuffix": " · {{duration}}s",
    "filesChanged_one": "{{count}} கோப்பு மாற்றப்பட்டது",
    "filesChanged_other": "{{count}} கோப்புகள் மாற்றப்பட்டன"
  }
}
```

- [ ] **Step 2: Traduire les composants ciblés dans `Applications.tsx` (lignes 1-593)**

Remplacer les lignes 1 à 593 du fichier `apps/web/src/routes/Applications.tsx` (tout ce qui précède `function NewAppForm`) par :
```tsx
import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import type {
  Application,
  AppBackupRun,
  AppBackupRunKind,
  BackupTarget,
  BackupHistoryEntry,
  DetectedDatabase,
  DetectedBindMount,
  DetectedVolumeMount,
  ContainerSummary,
  UsbStatus,
} from "@pwa-admin/shared";
import { useTranslation } from "react-i18next";
import { apiJson } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatBytes } from "./Docker";
import {
  Boxes,
  Trash2,
  Database,
  Cloud,
  HardDrive,
  Info,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2,
  XCircle,
  Usb,
  ArrowRight,
} from "lucide-react";

interface CronPreset {
  labelKey: string;
  value: string;
  hintKey: string;
}

const CRON_PRESETS: CronPreset[] = [
  { labelKey: "cronPresets.hourly.label", value: "0 * * * *", hintKey: "cronPresets.hourly.hint" },
  { labelKey: "cronPresets.every6h.label", value: "0 */6 * * *", hintKey: "cronPresets.every6h.hint" },
  { labelKey: "cronPresets.daily2am.label", value: "0 2 * * *", hintKey: "cronPresets.daily2am.hint" },
  { labelKey: "cronPresets.daily3am.label", value: "0 3 * * *", hintKey: "cronPresets.daily3am.hint" },
  { labelKey: "cronPresets.every12h.label", value: "0 */12 * * *", hintKey: "cronPresets.every12h.hint" },
  { labelKey: "cronPresets.weeklySun3am.label", value: "0 3 * * 0", hintKey: "cronPresets.weeklySun3am.hint" },
  { labelKey: "cronPresets.weeklyMon3am.label", value: "0 3 * * 1", hintKey: "cronPresets.weeklyMon3am.hint" },
  { labelKey: "cronPresets.monthly3am.label", value: "0 3 1 * *", hintKey: "cronPresets.monthly3am.hint" },
];

/** Cron frequency picker: dropdown of common presets + a "Personnalisé" mode
 * that reveals a raw cron expression input, so admins who know cron syntax
 * aren't limited to the presets. */
function CronPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const { t } = useTranslation("applications");
  const matchedPreset = CRON_PRESETS.find((p) => p.value === value);
  const [mode, setMode] = useState<"none" | "preset" | "custom">(
    value ? (matchedPreset ? "preset" : "custom") : "none"
  );

  function handleModeChange(newMode: "none" | "preset" | "custom") {
    setMode(newMode);
    if (newMode === "none") onChange("");
    else if (newMode === "preset") onChange(CRON_PRESETS[0].value);
    else if (newMode === "custom" && !value) onChange("");
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <select
        value={mode}
        onChange={(e) => handleModeChange(e.target.value as "none" | "preset" | "custom")}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
      >
        <option value="none">{t("cronPicker.disabled")}</option>
        <option value="preset">{t("cronPicker.presetMode")}</option>
        <option value="custom">{t("cronPicker.customMode")}</option>
      </select>

      {mode === "preset" && (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
        >
          {CRON_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {t(p.labelKey)}
            </option>
          ))}
        </select>
      )}

      {mode === "custom" && (
        <>
          <input
            type="text"
            placeholder={t("cronPicker.customPlaceholder")}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <p className="text-xs text-muted-foreground">
            {t("cronPicker.formatHelp", {
              example: "",
            })}
            <code className="rounded bg-muted px-1">0 3 * * *</code>
          </p>
        </>
      )}

      {mode === "preset" && matchedPreset && (
        <p className="text-xs text-muted-foreground">{t(matchedPreset.hintKey)}</p>
      )}
    </div>
  );
}

function HelpPanel() {
  const { t } = useTranslation("applications");
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Info className="h-4 w-4 shrink-0 text-primary" />
          {t("help.question")}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3 text-sm">
          <div>
            <p className="font-medium">{t("help.whatIsApp.title")}</p>
            <p className="mt-1 text-muted-foreground">{t("help.whatIsApp.text")}</p>
          </div>

          <div>
            <p className="font-medium">{t("help.fullVsPartial.title")}</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">{t("help.fullVsPartial.fullLabel")}</span>
                {t("help.fullVsPartial.fullText")}
              </li>
              <li>
                <span className="font-medium text-foreground">{t("help.fullVsPartial.partialLabel")}</span>
                {t("help.fullVsPartial.partialText")}
              </li>
            </ul>
            <p className="mt-1 text-muted-foreground">{t("help.fullVsPartial.dbNote")}</p>
          </div>

          <div>
            <p className="font-medium">{t("help.scheduling.title")}</p>
            <p className="mt-1 text-muted-foreground">{t("help.scheduling.text")}</p>
          </div>

          <div>
            <p className="font-medium">{t("help.restore.title")}</p>
            <p className="mt-1 text-muted-foreground">{t("help.restore.text")}</p>
          </div>

          <div>
            <p className="font-medium">{t("help.storage.title")}</p>
            <p className="mt-1 text-muted-foreground">{t("help.storage.text")}</p>
          </div>
        </div>
      )}
    </Card>
  );
}

export function Applications() {
  const { t } = useTranslation("applications");
  const [searchParams, setSearchParams] = useSearchParams();
  const prefillContainer = searchParams.get("container");
  const [apps, setApps] = useState<Application[] | null>(null);
  const [showNewApp, setShowNewApp] = useState(!!prefillContainer);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [lastRunStatusById, setLastRunStatusById] = useState<Record<number, AppBackupRun["status"] | undefined>>({});

  async function loadApps() {
    const data = await apiJson<Application[]>("/applications");
    setApps(data);
    const entries = await Promise.all(
      data.map((app) =>
        apiJson<AppBackupRun[]>(`/applications/${app.id}/runs`)
          .then((runs) => [app.id, runs[0]?.status] as const)
          .catch(() => [app.id, undefined] as const)
      )
    );
    setLastRunStatusById(Object.fromEntries(entries));
  }

  useEffect(() => {
    loadApps().catch((err) => setError((err as Error).message));
  }, []);

  async function runBackup(id: number, kind: AppBackupRunKind) {
    setError(null);
    try {
      await apiJson(`/applications/${id}/backup`, {
        method: "POST",
        body: JSON.stringify({ kind }),
      });
      if (expandedId === id) {
        // trigger a refresh of the run list by toggling
        setExpandedId(null);
        setTimeout(() => setExpandedId(id), 0);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function deleteApp(id: number) {
    await apiJson(`/applications/${id}`, { method: "DELETE" });
    await loadApps();
  }

  return (
    <div className="flex flex-col gap-4">
      <HelpPanel />

      {error && <Card className="text-sm text-destructive">{error}</Card>}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">{t("sectionTitle")}</h2>
          <Button size="sm" variant="outline" onClick={() => setShowNewApp((v) => !v)}>
            {showNewApp ? t("cancel") : t("newApp")}
          </Button>
        </div>

        {showNewApp && (
          <NewAppForm
            prefillContainer={prefillContainer}
            onCreated={() => {
              setShowNewApp(false);
              setSearchParams({});
              loadApps();
            }}
          />
        )}

        <div className="flex flex-col gap-3">
          {!apps && <Card className="text-sm text-muted-foreground">{t("loading")}</Card>}
          {apps?.length === 0 && (
            <Card className="text-sm text-muted-foreground">{t("empty")}</Card>
          )}
          {apps?.map((app) => (
            <AppCard
              key={app.id}
              app={app}
              lastRunStatus={lastRunStatusById[app.id]}
              expanded={expandedId === app.id}
              onToggleExpand={() => setExpandedId((prev) => (prev === app.id ? null : app.id))}
              onBackup={(kind) => runBackup(app.id, kind)}
              onDelete={() => deleteApp(app.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function appCardClass(status: AppBackupRun["status"] | undefined): string | undefined {
  if (status === "success") return "border-primary/40 bg-primary/5";
  if (status === "failed") return "border-destructive/50 bg-destructive/5";
  return undefined; // pending/running/no runs yet — no verdict to color by
}

function AppCard({
  app,
  lastRunStatus,
  expanded,
  onToggleExpand,
  onBackup,
  onDelete,
}: {
  app: Application;
  lastRunStatus: AppBackupRun["status"] | undefined;
  expanded: boolean;
  onToggleExpand: () => void;
  onBackup: (kind: AppBackupRunKind) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("applications");
  return (
    <Card className={appCardClass(lastRunStatus)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 cursor-pointer" onClick={onToggleExpand}>
          <p className="flex items-center gap-1 truncate font-medium">
            <Boxes className="h-4 w-4 shrink-0" /> {app.name}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {app.containerNames.map((c) => (
              <span key={c} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {c}
              </span>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("paths", { count: app.paths.length })}
            {app.volumeNames.length > 0 && <> · {t("volumes", { count: app.volumeNames.length })}</>}
            {app.dbRef && (
              <>
                {" · "}
                <span className="inline-flex items-center gap-0.5">
                  <Database className="h-3 w-3" /> {app.dbRef}
                </span>
              </>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("targetsLabel", { targets: app.targets.join(", ") })}
            {app.scheduleFullCron ? ` · full: ${app.scheduleFullCron}` : ""}
            {app.schedulePartialCron ? ` · partial: ${app.schedulePartialCron}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => onBackup("full")}>
              {t("fullBackup")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => onBackup("partial")}>
              {t("partialBackup")}
            </Button>
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              }
              title={t("deleteConfirm.title", { name: app.name })}
              confirmLabel={t("deleteConfirm.confirmLabel")}
              onConfirm={onDelete}
            />
          </div>
        </div>
      </div>

      {expanded && (
        <>
          <AppRunHistory appId={app.id} />
          <AppImageHistory containerNames={app.containerNames} />
          <Link
            to="/restore"
            className="mt-3 flex items-center justify-center gap-1 border-t border-border pt-3 text-xs text-primary underline"
          >
            {t("viewInRestore")} <ArrowRight className="h-3 w-3" />
          </Link>
        </>
      )}
    </Card>
  );
}

/**
 * Read-only list of saved container image archives (docker save) per
 * container. Restoring is done from the Restore page, not here — see
 * AppRunHistory's comment for the rationale (keep create/backup pages free
 * of destructive restore actions).
 */
function AppImageHistory({ containerNames }: { containerNames: string[] }) {
  const { t } = useTranslation("applications");
  const [historyByContainer, setHistoryByContainer] = useState<Record<string, BackupHistoryEntry[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all(
      containerNames.map((name) =>
        apiJson<BackupHistoryEntry[]>(`/backups/images/${encodeURIComponent(name)}/history`).then(
          (rows) => [name, rows] as const
        )
      )
    )
      .then((entries) => setHistoryByContainer(Object.fromEntries(entries)))
      .catch((err) => setError((err as Error).message));
  }, [containerNames.join(",")]);

  const hasAny = Object.values(historyByContainer).some((rows) => rows.length > 0);
  if (!hasAny && !error) return null;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-2 text-xs font-semibold text-muted-foreground">{t("imageHistoryTitle")}</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {containerNames.map((name) => {
        const rows = historyByContainer[name] ?? [];
        if (rows.length === 0) return null;
        return (
          <div key={name} className="mb-2">
            <p className="text-xs font-medium">{name}</p>
            <div className="mt-1 flex flex-col gap-1">
              {rows.map((run) => (
                <div key={run.runId} className="rounded-md border border-border p-2 text-xs">
                  <div className="min-w-0">
                    <p>
                      {new Date(run.startedAt).toLocaleString()}
                      {run.sizeBytes != null ? ` · ${formatBytes(run.sizeBytes)}` : ""}
                    </p>
                    <p className="text-muted-foreground">
                      {run.status}
                      {run.driveFileId ? " + gdrive" : ""}
                      {run.usbPath ? " + usb" : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Shows real Drive upload progress for a run's file snapshot (separate from
 * the DB dump's own dbDriveFileId, which uploads synchronously since dumps are
 * small — this tracks the potentially multi-GB, asynchronous file upload). */
function DriveUploadIndicator({ run }: { run: AppBackupRun }) {
  const { t } = useTranslation("applications");
  switch (run.driveUploadStatus) {
    case "none":
      return null;
    case "pending":
      return (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Cloud className="h-3.5 w-3.5" /> {t("driveUpload.pending")}
        </p>
      );
    case "compressing":
      return (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("driveUpload.compressing")}
        </p>
      );
    case "uploading":
      return (
        <div className="mt-1 flex flex-col gap-1">
          <p className="flex items-center gap-1 text-xs text-warning">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("driveUpload.uploading", { pct: run.driveUploadProgressPct ?? 0 })}
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-warning transition-all"
              style={{ width: `${run.driveUploadProgressPct ?? 0}%` }}
            />
          </div>
        </div>
      );
    case "success":
      return (
        <p className="mt-1 flex items-center gap-1 text-xs text-primary">
          <CheckCircle2 className="h-3.5 w-3.5" /> {t("driveUpload.success", { count: run.driveFileIds?.length ?? 0 })}
        </p>
      );
    case "failed":
      return (
        <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
          <XCircle className="h-3.5 w-3.5" />{" "}
          {t("driveUpload.failed", {
            suffix: run.driveUploadError ? t("driveUpload.failedSuffix", { error: run.driveUploadError }) : "",
          })}
        </p>
      );
    default:
      return null;
  }
}

/** Read-only history — restoring a run is done from the Restore page, not
 * here, so this page stays purely about creating/managing backups and can't
 * accidentally overwrite live data with a misclick. */
function AppRunHistory({ appId }: { appId: number }) {
  const { t } = useTranslation("applications");
  const [runs, setRuns] = useState<AppBackupRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadRuns() {
    return apiJson<AppBackupRun[]>(`/applications/${appId}/runs`)
      .then(setRuns)
      .catch((err) => setError((err as Error).message));
  }

  useEffect(() => {
    loadRuns();
  }, [appId]);

  // Poll while any run has an upload still in flight, so the progress bar
  // actually advances instead of requiring a manual refresh to see updates.
  useEffect(() => {
    const hasActiveUpload = runs?.some(
      (r) => r.driveUploadStatus === "uploading" || r.driveUploadStatus === "pending"
    );
    if (!hasActiveUpload) return;
    const interval = setInterval(loadRuns, 2000);
    return () => clearInterval(interval);
  }, [runs, appId]);

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-2 text-xs font-semibold text-muted-foreground">{t("runHistory.title")}</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!runs && !error && <p className="text-xs text-muted-foreground">{t("runHistory.loading")}</p>}
      {runs?.length === 0 && <p className="text-xs text-muted-foreground">{t("runHistory.empty")}</p>}
      <div className="flex flex-col gap-2">
        {runs?.map((run) => (
          <div key={run.runId} className="rounded-md border border-border p-2 text-sm">
            <div className="flex items-center justify-between">
              <span
                className={
                  "rounded-full px-2 py-0.5 text-xs font-medium " +
                  (run.kind === "full" ? "bg-primary/15 text-primary" : "bg-warning/15 text-warning")
                }
              >
                {run.kind === "full" ? t("fullBackup") : t("partialBackup")}
              </span>
              <span
                className={
                  "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium " +
                  (run.status === "success"
                    ? "bg-primary/15 text-primary"
                    : run.status === "failed"
                      ? "bg-destructive/15 text-destructive"
                      : "bg-warning/15 text-warning")
                }
              >
                {run.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {new Date(run.startedAt).toLocaleString()}
              {run.finishedAt && run.startedAt
                ? t("runHistory.durationSuffix", {
                    duration: ((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1),
                  })
                : ""}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {run.filesChanged != null ? t("runHistory.filesChanged", { count: run.filesChanged }) : ""}
              {run.sizeBytes != null ? ` · ${formatBytes(run.sizeBytes)}` : ""}
            </p>
            <DriveUploadIndicator run={run} />
            {run.error && <p className="mt-1 text-xs text-destructive">{run.error}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

```

Notes importantes :
1. `CRON_PRESETS` est déplacé au niveau module comme dans l'original (il ne contient que des clés/valeurs, pas d'appel `t()` direct) — seul `CronPicker` (un composant, qui peut utiliser `t()`) résout `labelKey`/`hintKey` au rendu. C'est différent du piège `navItems.ts`/`TABS` : ici le tableau reste top-level car il ne fait que stocker des chaînes de clés, la résolution se fait bien à l'intérieur du composant.
2. Le texte d'aide format cron (`cronPicker.formatHelp`) contenait à l'origine un `<code>` inline au milieu de la phrase (`Ex : <code>0 3 * * *</code> = tous les jours à 3h00.`). La clé JSON `formatHelp` se termine par `"... Ex : {{example}}"` avec `example` interpolé à une chaîne vide (le code source affiche ensuite le `<code>0 3 * * *</code>` séparément juste après dans le JSX, avec la traduction `" = tous les jours à 3h00."` malheureusement absorbée dans la même clé que le "Ex :"). **Correction à appliquer en implémentant ce step** : simplifier en gardant `formatHelp` comme une seule clé complète sans interpolation vide inutile, et laisser le `<code>0 3 * * *</code>` s'insérer visuellement entre le texte et sa suite via le HTML existant — c'est-à-dire, remplacer le bloc JSX pour ce cas précis par :
```tsx
          <p className="text-xs text-muted-foreground">
            {t("cronPicker.formatHelp")} <code className="rounded bg-muted px-1">0 3 * * *</code>
          </p>
```
et retirer `{{example}}` de la clé JSON dans les 3 fichiers (`formatHelp` devient simplement la phrase complète se terminant par "Ex :" sans le `= tous les jours à 3h00.` à la fin, ce texte de fermeture n'existant qu'en français dans l'original juste après le `<code>` — reformuler pour que la phrase se termine naturellement après le code, ex: `"Format : minute (0-59) heure (0-23) jour-du-mois (1-31) mois (1-12) jour-semaine (0-6, 0=dimanche). Ex :"` en français, `"Format: minute (0-59) hour (0-23) day-of-month (1-31) month (1-12) day-of-week (0-6, 0=Sunday). E.g.:"` en anglais, équivalent en tamoul — sans le `= tous les jours à 3h00.` de fin, cette information étant déjà portée par le preset correspondant ailleurs). Ajuster les 3 fichiers JSON en conséquence lors de l'implémentation de ce step.

- [ ] **Step 3: Lire l'état actuel de `lib/i18n.ts` et ajouter le namespace `applications`**

Lire `apps/web/src/lib/i18n.ts` pour connaître l'état exact de `ns: [...]` avant de modifier. Ajouter `"applications"` à la fin du tableau existant.

- [ ] **Step 4: Vérifier le typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: aucune erreur (hors bruit préexistant `ImaNote.tsx`).

- [ ] **Step 5: Vérifier que `NewAppForm` (lignes 594+) est bien intacte et inchangée**

Run: `grep -c "function NewAppForm" apps/web/src/routes/Applications.tsx`
Expected: `1` — confirme que cette fonction existe toujours, non touchée par cette tâche (Task 2 la traduira séparément).

- [ ] **Step 6: Commit**

```bash
git add apps/web/public/locales/fr/applications.json apps/web/public/locales/en/applications.json apps/web/public/locales/ta/applications.json apps/web/src/routes/Applications.tsx apps/web/src/lib/i18n.ts
git commit -m "feat(web): traduire l'écran Applications (liste, historique) via i18next"
```

---

## Task 2: Traduire `NewAppForm`

**Files:**
- Modify: `apps/web/public/locales/fr/applications.json` (ajout de clés, ne pas toucher aux clés existantes de Task 1)
- Modify: `apps/web/public/locales/en/applications.json` (idem)
- Modify: `apps/web/public/locales/ta/applications.json` (idem)
- Modify: `apps/web/src/routes/Applications.tsx` (lignes 595+ de l'original : `NewAppForm`)

**Interfaces:**
- Consumes: `useTranslation("applications")` (namespace déjà enregistré dans `ns` par Task 1).
- Produces: rien de consommé par d'autres tâches (fin de l'écran Applications).

Avant de commencer, lire l'état réel des 3 fichiers `applications.json` créés/ajustés par Task 1.

État du composant concerné (contenu original, lignes 595-896) : voir le contenu lu en entier plus haut. Chaînes à extraire : messages d'erreur de chargement (l.626, 629, 632 — "Impossible de charger la liste des conteneurs"/"...des dossiers montés"/"...des volumes Docker"), message de validation "Nom, au moins une cible, et au moins un chemin, volume ou une base de données sont requis" (l.687), messages d'erreur backend traduits côté client (l.712-719 : `paths_not_detected_bind_mounts` → "Un ou plusieurs chemins sélectionnés ne correspondent plus à un dossier monté détecté. Rafraîchissez la liste et réessayez." ; `application_name_already_exists` → "Une application avec ce nom existe déjà. Choisissez un autre nom ou modifiez l'application existante."), placeholder "Nom de l'application" (l.731), labels "Conteneurs" (l.738), "Chargement…"/"Aucun conteneur détecté." (l.740-741), "Chemins (dossiers montés)" avec suffixe filtre optionnel (l.757-759), "Chargement…" (l.762), message "Aucun dossier monté détecté pour cette sélection..." (l.764-767), "Volumes Docker (nommés)" avec suffixe filtre optionnel (l.785-787), "Chargement…" (l.790), "Aucun volume Docker nommé détecté pour cette sélection." (l.792), "Base de données (optionnel)" (l.813), option "Aucune" (l.819), labels de checkbox "local"/"gdrive"/"(non connecté)"/"usb"/"(aucun disque configuré — voir Backups)" (l.831, 840-841, 850-852), texte explicatif backup complet/partiel (l.857-860), labels de `CronPicker` "Planification backup complet"/"Planification backup partiel" (l.862-867), placeholders "Rétention (jours, optionnel)"/"Copies minimum à conserver (optionnel)" (l.874, 882), bouton "Création…"/"Créer" (l.891).

- [ ] **Step 1: Lire l'état actuel des 3 fichiers `applications.json` et y ajouter les clés du formulaire**

Ajouter dans `apps/web/public/locales/fr/applications.json`, après la dernière clé de haut niveau déjà présente (`"runHistory"`, en ajoutant une virgule après cette clé) :
```json
  "newAppForm": {
    "loadContainersError": "Impossible de charger la liste des conteneurs",
    "loadMountsError": "Impossible de charger la liste des dossiers montés",
    "loadVolumesError": "Impossible de charger la liste des volumes Docker",
    "validationError": "Nom, au moins une cible, et au moins un chemin, volume ou une base de données sont requis",
    "errorPathsNotDetected": "Un ou plusieurs chemins sélectionnés ne correspondent plus à un dossier monté détecté. Rafraîchissez la liste et réessayez.",
    "errorNameExists": "Une application avec ce nom existe déjà. Choisissez un autre nom ou modifiez l'application existante.",
    "namePlaceholder": "Nom de l'application",
    "containersLabel": "Conteneurs",
    "loading": "Chargement…",
    "noContainersDetected": "Aucun conteneur détecté.",
    "pathsLabel": "Chemins (dossiers montés)",
    "filteredSuffix": " · filtrés par conteneur(s) sélectionné(s)",
    "noMountsDetected": "Aucun dossier monté détecté pour cette sélection (conteneur sans données persistées sur disque — ok si un volume Docker ou une base de données est sélectionné ci-dessous).",
    "volumesLabel": "Volumes Docker (nommés)",
    "noVolumesDetected": "Aucun volume Docker nommé détecté pour cette sélection.",
    "dbLabel": "Base de données (optionnel)",
    "dbNone": "Aucune",
    "targetLocal": "local",
    "targetGdrive": "gdrive",
    "targetGdriveNotConnected": "(non connecté)",
    "targetUsb": "usb",
    "targetUsbNotConfigured": "(aucun disque configuré — voir Backups)",
    "backupExplanation": "Le backup complet prend un instantané complet ; le backup partiel ne copie que les fichiers modifiés depuis le dernier instantané (liens durs pour le reste). Exemple : partiel quotidien, complet hebdomadaire.",
    "fullScheduleLabel": "Planification backup complet",
    "partialScheduleLabel": "Planification backup partiel",
    "retentionDaysPlaceholder": "Rétention (jours, optionnel)",
    "retentionCopiesPlaceholder": "Copies minimum à conserver (optionnel)",
    "creating": "Création…",
    "create": "Créer"
  }
```

Ajouter dans `apps/web/public/locales/en/applications.json`, même position :
```json
  "newAppForm": {
    "loadContainersError": "Unable to load the container list",
    "loadMountsError": "Unable to load the mounted folder list",
    "loadVolumesError": "Unable to load the Docker volume list",
    "validationError": "Name, at least one target, and at least one path, volume, or database are required",
    "errorPathsNotDetected": "One or more selected paths no longer match a detected mounted folder. Refresh the list and try again.",
    "errorNameExists": "An application with this name already exists. Choose another name or edit the existing application.",
    "namePlaceholder": "Application name",
    "containersLabel": "Containers",
    "loading": "Loading…",
    "noContainersDetected": "No container detected.",
    "pathsLabel": "Paths (mounted folders)",
    "filteredSuffix": " · filtered by selected container(s)",
    "noMountsDetected": "No mounted folder detected for this selection (container with no data persisted on disk — fine if a Docker volume or database is selected below).",
    "volumesLabel": "Docker volumes (named)",
    "noVolumesDetected": "No named Docker volume detected for this selection.",
    "dbLabel": "Database (optional)",
    "dbNone": "None",
    "targetLocal": "local",
    "targetGdrive": "gdrive",
    "targetGdriveNotConnected": "(not connected)",
    "targetUsb": "usb",
    "targetUsbNotConfigured": "(no drive configured — see Backups)",
    "backupExplanation": "A full backup takes a complete snapshot; a partial backup only copies files modified since the last snapshot (hard links for the rest). Example: daily partial, weekly full.",
    "fullScheduleLabel": "Full backup schedule",
    "partialScheduleLabel": "Partial backup schedule",
    "retentionDaysPlaceholder": "Retention (days, optional)",
    "retentionCopiesPlaceholder": "Minimum copies to keep (optional)",
    "creating": "Creating…",
    "create": "Create"
  }
```

Ajouter dans `apps/web/public/locales/ta/applications.json`, même position :
```json
  "newAppForm": {
    "loadContainersError": "கொள்கலன் பட்டியலை ஏற்ற முடியவில்லை",
    "loadMountsError": "ஏற்றப்பட்ட கோப்புறை பட்டியலை ஏற்ற முடியவில்லை",
    "loadVolumesError": "Docker தொகுதி பட்டியலை ஏற்ற முடியவில்லை",
    "validationError": "பெயர், குறைந்தது ஒரு இலக்கு, மற்றும் குறைந்தது ஒரு பாதை, தொகுதி அல்லது தரவுத்தளம் தேவை",
    "errorPathsNotDetected": "தேர்ந்தெடுக்கப்பட்ட ஒன்று அல்லது அதற்கு மேற்பட்ட பாதைகள் இனி கண்டறியப்பட்ட ஏற்றப்பட்ட கோப்புறையுடன் பொருந்தவில்லை. பட்டியலைப் புதுப்பித்து மீண்டும் முயற்சிக்கவும்.",
    "errorNameExists": "இந்த பெயருடன் ஒரு பயன்பாடு ஏற்கனவே உள்ளது. வேறு பெயரைத் தேர்ந்தெடுக்கவும் அல்லது ஏற்கனவே உள்ள பயன்பாட்டைத் திருத்தவும்.",
    "namePlaceholder": "பயன்பாட்டு பெயர்",
    "containersLabel": "கொள்கலன்கள்",
    "loading": "ஏற்றுகிறது…",
    "noContainersDetected": "கொள்கலன் எதுவும் கண்டறியப்படவில்லை.",
    "pathsLabel": "பாதைகள் (ஏற்றப்பட்ட கோப்புறைகள்)",
    "filteredSuffix": " · தேர்ந்தெடுக்கப்பட்ட கொள்கலன்(கள்) மூலம் வடிகட்டப்பட்டது",
    "noMountsDetected": "இந்த தேர்வுக்கு ஏற்றப்பட்ட கோப்புறை எதுவும் கண்டறியப்படவில்லை (வட்டில் தரவு சேமிக்கப்படாத கொள்கலன் — கீழே Docker தொகுதி அல்லது தரவுத்தளம் தேர்ந்தெடுக்கப்பட்டிருந்தால் பரவாயில்லை).",
    "volumesLabel": "Docker தொகுதிகள் (பெயரிடப்பட்டவை)",
    "noVolumesDetected": "இந்த தேர்வுக்கு பெயரிடப்பட்ட Docker தொகுதி எதுவும் கண்டறியப்படவில்லை.",
    "dbLabel": "தரவுத்தளம் (விருப்பத்தேர்வு)",
    "dbNone": "எதுவுமில்லை",
    "targetLocal": "local",
    "targetGdrive": "gdrive",
    "targetGdriveNotConnected": "(இணைக்கப்படவில்லை)",
    "targetUsb": "usb",
    "targetUsbNotConfigured": "(வட்டு எதுவும் கட்டமைக்கப்படவில்லை — Backups ஐப் பார்க்கவும்)",
    "backupExplanation": "முழு காப்புப்பிரதி ஒரு முழுமையான ஸ்னாப்ஷாட்டை எடுக்கும்; பகுதி காப்புப்பிரதி கடைசி ஸ்னாப்ஷாட்டிலிருந்து மாற்றப்பட்ட கோப்புகளை மட்டுமே நகலெடுக்கும் (மற்றவற்றுக்கு hard links). எடுத்துக்காட்டு: தினமும் பகுதி, வாரம் ஒருமுறை முழுமையான.",
    "fullScheduleLabel": "முழு காப்புப்பிரதி திட்டமிடல்",
    "partialScheduleLabel": "பகுதி காப்புப்பிரதி திட்டமிடல்",
    "retentionDaysPlaceholder": "வைத்திருத்தல் (நாட்கள், விருப்பத்தேர்வு)",
    "retentionCopiesPlaceholder": "வைத்திருக்க வேண்டிய குறைந்தபட்ச நகல்கள் (விருப்பத்தேர்வு)",
    "creating": "உருவாக்குகிறது…",
    "create": "உருவாக்கு"
  }
```

- [ ] **Step 2: Traduire `NewAppForm`**

Remplacer les lignes 595 à la fin du fichier (`function NewAppForm` jusqu'à la fermeture finale) par :
```tsx
function NewAppForm({
  onCreated,
  prefillContainer,
}: {
  onCreated: () => void;
  prefillContainer?: string | null;
}) {
  const { t } = useTranslation("applications");
  const [name, setName] = useState(prefillContainer ?? "");
  const [containers, setContainers] = useState<ContainerSummary[] | null>(null);
  const [selectedContainers, setSelectedContainers] = useState<string[]>(
    prefillContainer ? [prefillContainer] : []
  );
  const [bindMounts, setBindMounts] = useState<DetectedBindMount[] | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [volumeMounts, setVolumeMounts] = useState<DetectedVolumeMount[] | null>(null);
  const [selectedVolumes, setSelectedVolumes] = useState<string[]>([]);
  const [detectedDbs, setDetectedDbs] = useState<DetectedDatabase[] | null>(null);
  const [dbValue, setDbValue] = useState("");
  const [targets, setTargets] = useState<BackupTarget[]>(["local"]);
  const [gdriveAuthorized, setGdriveAuthorized] = useState(false);
  const [usbAvailable, setUsbAvailable] = useState(false);
  const [scheduleFullCron, setScheduleFullCron] = useState("");
  const [schedulePartialCron, setSchedulePartialCron] = useState("");
  const [retentionDays, setRetentionDays] = useState("");
  const [retentionMinCopies, setRetentionMinCopies] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiJson<ContainerSummary[]>("/docker/containers")
      .then(setContainers)
      .catch(() => setError(t("newAppForm.loadContainersError")));
    apiJson<DetectedBindMount[]>("/backups/bind-mounts")
      .then(setBindMounts)
      .catch(() => setError(t("newAppForm.loadMountsError")));
    apiJson<DetectedVolumeMount[]>("/backups/volume-mounts")
      .then(setVolumeMounts)
      .catch(() => setError(t("newAppForm.loadVolumesError")));
    apiJson<DetectedDatabase[]>("/dbbackup/detect")
      .then(setDetectedDbs)
      .catch(() => setDetectedDbs([]));
    apiJson<{ authorized: boolean }>("/backups/gdrive/status")
      .then((s) => setGdriveAuthorized(s.authorized))
      .catch(() => setGdriveAuthorized(false));
    apiJson<UsbStatus>("/backups/usb/status")
      .then((s) => setUsbAvailable(s.drives.some((d) => d.isBackupConfigured)))
      .catch(() => setUsbAvailable(false));
  }, []);

  function toggleContainer(name: string) {
    setSelectedContainers((prev) => (prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]));
  }

  function togglePath(path: string) {
    setSelectedPaths((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
  }

  function toggleVolume(volumeName: string) {
    setSelectedVolumes((prev) => (prev.includes(volumeName) ? prev.filter((v) => v !== volumeName) : [...prev, volumeName]));
  }

  function toggleTarget(tgt: BackupTarget) {
    setTargets((prev) => (prev.includes(tgt) ? prev.filter((x) => x !== tgt) : [...prev, tgt]));
  }

  const visibleMounts = useMemo(() => {
    if (!bindMounts) return [];
    if (selectedContainers.length === 0) return bindMounts;
    return bindMounts.filter((m) => selectedContainers.includes(m.containerName));
  }, [bindMounts, selectedContainers]);

  const visibleVolumeMounts = useMemo(() => {
    if (!volumeMounts) return [];
    if (selectedContainers.length === 0) return volumeMounts;
    return volumeMounts.filter((m) => selectedContainers.includes(m.containerName));
  }, [volumeMounts, selectedContainers]);

  // Drop path selections that fall out of scope when the container selection changes.
  useEffect(() => {
    if (selectedContainers.length === 0) return;
    setSelectedPaths((prev) => prev.filter((p) => visibleMounts.some((m) => m.hostPath === p)));
  }, [visibleMounts, selectedContainers.length]);

  useEffect(() => {
    if (selectedContainers.length === 0) return;
    setSelectedVolumes((prev) => prev.filter((v) => visibleVolumeMounts.some((m) => m.volumeName === v)));
  }, [visibleVolumeMounts, selectedContainers.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || (selectedPaths.length === 0 && selectedVolumes.length === 0 && !dbValue) || targets.length === 0) {
      setError(t("newAppForm.validationError"));
      return;
    }
    setSubmitting(true);
    try {
      const [dbLocation, dbRef] = dbValue ? dbValue.split(":") : [undefined, undefined];
      await apiJson("/applications", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          containerNames: selectedContainers,
          paths: selectedPaths,
          volumeNames: selectedVolumes,
          dbLocation: dbLocation || undefined,
          dbRef: dbRef || undefined,
          targets,
          scheduleFullCron: scheduleFullCron.trim() || undefined,
          schedulePartialCron: schedulePartialCron.trim() || undefined,
          retentionDays: retentionDays.trim() ? Number(retentionDays) : undefined,
          retentionMinCopies: retentionMinCopies.trim() ? Number(retentionMinCopies) : undefined,
        }),
      });
      onCreated();
    } catch (err) {
      const message = (err as Error).message;
      if (message === "paths_not_detected_bind_mounts") {
        setError(t("newAppForm.errorPathsNotDetected"));
      } else if (message === "application_name_already_exists") {
        setError(t("newAppForm.errorNameExists"));
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mb-3">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="text"
          placeholder={t("newAppForm.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">{t("newAppForm.containersLabel")}</p>
          <div className="flex flex-col gap-1 rounded-md border border-border p-2">
            {!containers && <p className="text-xs text-muted-foreground">{t("newAppForm.loading")}</p>}
            {containers?.length === 0 && <p className="text-xs text-muted-foreground">{t("newAppForm.noContainersDetected")}</p>}
            {containers?.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedContainers.includes(c.name)}
                  onChange={() => toggleContainer(c.name)}
                />
                {c.name}
                <span className="text-xs text-muted-foreground">({c.state})</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {t("newAppForm.pathsLabel")}
            {selectedContainers.length > 0 ? t("newAppForm.filteredSuffix") : ""}
          </p>
          <div className="flex flex-col gap-1 rounded-md border border-border p-2">
            {!bindMounts && <p className="text-xs text-muted-foreground">{t("newAppForm.loading")}</p>}
            {bindMounts && visibleMounts.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("newAppForm.noMountsDetected")}</p>
            )}
            {visibleMounts.map((m) => (
              <label key={`${m.containerName}:${m.hostPath}`} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedPaths.includes(m.hostPath)}
                  onChange={() => togglePath(m.hostPath)}
                />
                <span className="truncate">
                  {m.hostPath} <span className="text-xs text-muted-foreground">({m.containerName})</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {t("newAppForm.volumesLabel")}
            {selectedContainers.length > 0 ? t("newAppForm.filteredSuffix") : ""}
          </p>
          <div className="flex flex-col gap-1 rounded-md border border-border p-2">
            {!volumeMounts && <p className="text-xs text-muted-foreground">{t("newAppForm.loading")}</p>}
            {volumeMounts && visibleVolumeMounts.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("newAppForm.noVolumesDetected")}</p>
            )}
            {visibleVolumeMounts.map((m) => (
              <label key={`${m.containerName}:${m.volumeName}`} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedVolumes.includes(m.volumeName)}
                  onChange={() => toggleVolume(m.volumeName)}
                />
                <span className="truncate">
                  {m.volumeName}{" "}
                  <span className="text-xs text-muted-foreground">
                    ({m.containerName} → {m.containerPath})
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">{t("newAppForm.dbLabel")}</p>
          <select
            value={dbValue}
            onChange={(e) => setDbValue(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
          >
            <option value="">{t("newAppForm.dbNone")}</option>
            {detectedDbs?.map((d) => (
              <option key={`${d.location}:${d.ref}`} value={`${d.location}:${d.ref}`}>
                {d.displayName} ({d.engine})
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={targets.includes("local")} onChange={() => toggleTarget("local")} />
            <HardDrive className="h-3.5 w-3.5" /> {t("newAppForm.targetLocal")}
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={targets.includes("gdrive")}
              onChange={() => toggleTarget("gdrive")}
              disabled={!gdriveAuthorized}
            />
            <Cloud className="h-3.5 w-3.5" /> {t("newAppForm.targetGdrive")}
            {!gdriveAuthorized && <span className="text-xs text-muted-foreground">{t("newAppForm.targetGdriveNotConnected")}</span>}
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={targets.includes("usb")}
              onChange={() => toggleTarget("usb")}
              disabled={!usbAvailable}
            />
            <Usb className="h-3.5 w-3.5" /> {t("newAppForm.targetUsb")}
            {!usbAvailable && (
              <span className="text-xs text-muted-foreground">{t("newAppForm.targetUsbNotConfigured")}</span>
            )}
          </label>
        </div>

        <p className="text-xs text-muted-foreground">{t("newAppForm.backupExplanation")}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CronPicker label={t("newAppForm.fullScheduleLabel")} value={scheduleFullCron} onChange={setScheduleFullCron} />
          <CronPicker
            label={t("newAppForm.partialScheduleLabel")}
            value={schedulePartialCron}
            onChange={setSchedulePartialCron}
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            type="number"
            min={0}
            placeholder={t("newAppForm.retentionDaysPlaceholder")}
            value={retentionDays}
            onChange={(e) => setRetentionDays(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            type="number"
            min={0}
            placeholder={t("newAppForm.retentionCopiesPlaceholder")}
            value={retentionMinCopies}
            onChange={(e) => setRetentionMinCopies(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? t("newAppForm.creating") : t("newAppForm.create")}
        </Button>
      </form>
    </Card>
  );
}
```

Note : la fonction interne `toggleTarget(t: BackupTarget)` de l'original (l.656) utilisait `t` comme nom de paramètre, en collision avec la fonction de traduction `t` du hook. Renommé en `tgt` — même correction que celle déjà appliquée dans `BackupWizardFlow.tsx` lors du plan Wizard.

- [ ] **Step 3: Vérifier le typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: aucune erreur (hors bruit préexistant `ImaNote.tsx`).

- [ ] **Step 4: Vérifier la parité des clés des 3 fichiers `applications.json` complets**

Run:
```bash
node -e "
const fs = require('fs');
function flatten(obj, prefix = '') {
  let keys = [];
  for (const k in obj) {
    const path = prefix ? prefix + '.' + k : k;
    if (typeof obj[k] === 'object' && obj[k] !== null) {
      keys = keys.concat(flatten(obj[k], path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}
const langs = ['fr', 'en', 'ta'];
const keysets = {};
for (const lang of langs) {
  const content = JSON.parse(fs.readFileSync(\`apps/web/public/locales/\${lang}/applications.json\`, 'utf-8'));
  keysets[lang] = flatten(content).join(',');
}
console.log(keysets.fr === keysets.en && keysets.en === keysets.ta ? 'OK: key sets match' : 'MISMATCH');
"
```
Expected: `OK: key sets match`.

- [ ] **Step 5: Build de production et vérification**

Run (depuis la racine du repo, avec le contournement `ImaNote.tsx` si nécessaire) :
```bash
npm run build --workspace=packages/shared
npm run build:api
npm run build:web
```
Expected : les 3 builds réussissent. Vérifier que `apps/web/dist/locales/{fr,en,ta}/applications.json` existent et contiennent `newAppForm`.

- [ ] **Step 6: Test manuel de régression**

Run: `npm run dev:web`, naviguer sur `/applications`, ouvrir "Nouvelle application" en français puis en anglais et tamoul. Vérifier qu'aucune clé de traduction brute n'apparaît, que le formulaire complet (conteneurs, chemins, volumes, base de données, cibles, planification cron, rétention) est traduit. Si un serveur dev est lancé, vérifier qu'il est bien arrêté avant de terminer.

- [ ] **Step 7: Commit**

```bash
git add apps/web/public/locales/fr/applications.json apps/web/public/locales/en/applications.json apps/web/public/locales/ta/applications.json apps/web/src/routes/Applications.tsx
git commit -m "feat(web): traduire le formulaire de création d'application via i18next"
```

---

## Fin de ce plan

Écran Applications entièrement traduit. Restent dans le lot "ops" : Backups, Restore, UsbExplorer, System, Services.
