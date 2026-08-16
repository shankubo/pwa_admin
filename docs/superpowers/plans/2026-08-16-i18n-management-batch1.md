# Multi-langue — Écrans management lot 1 (Pm2, Security, OsSystem, NetworkSecurity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Traduire en FR/EN/TA les 4 plus petits écrans du lot "management" du spec i18n (`Pm2.tsx`, `Security.tsx`, `OsSystem.tsx`, `NetworkSecurity.tsx`), en suivant exactement le pattern déjà validé et déployé en production lors de la Phase 1 (infra i18n + layout partagé + Login).

**Architecture:** Chaque écran migre vers `useTranslation("<namespace>")` (un namespace par écran, cohérent avec le spec), avec extraction de toutes les chaînes visibles (titres, labels, statuts, messages d'erreur, textes interpolés) vers `apps/web/public/locales/{fr,en,ta}/<namespace>.json`. Les 3 écrans restants du lot "management" (Sites, Docker, Nginx — nettement plus gros) seront couverts par des plans séparés une fois celui-ci exécuté et déployé.

**Tech Stack:** react-i18next (déjà installé et opérationnel depuis la Phase 1), TypeScript, Vite.

**Spec:** [docs/superpowers/specs/2026-08-15-i18n-frontend-design.md](../specs/2026-08-15-i18n-frontend-design.md)

## Global Constraints

- Langues supportées : `fr` (défaut/fallback), `en`, `ta`. Un namespace JSON par écran sous `apps/web/public/locales/<lng>/<namespace>.json`, cohérent avec la Phase 1 déjà déployée.
- Namespaces de ce plan : `pm2`, `security`, `os`, `network` (noms courts, alignés sur le nom de route plutôt que le nom de fichier — `OsSystem.tsx` → namespace `os`, `NetworkSecurity.tsx` → namespace `network`, cohérent avec la liste de namespaces déjà énumérée dans le spec).
- Chaque nouveau namespace doit être ajouté à la liste `ns` de `apps/web/src/lib/i18n.ts` (actuellement `["common", "nav", "settings", "login"]`).
- Les chaînes interpolées (nombres, dates, noms dynamiques) utilisent l'interpolation i18next (`t("clé", { valeur })`), jamais de concaténation de template string pour du texte traduit.
- Les valeurs strictement techniques (noms de paquets, adresses IP, ports, noms de conteneurs Docker, versions, timestamps ISO déjà formatés par `toLocaleString()`) ne sont PAS traduites — seul le texte d'interface autour l'est.
- Après chaque tâche : `npx tsc --noEmit -p apps/web/tsconfig.json` (depuis la racine du repo) doit passer sans erreur.
- Aucun changement backend (`apps/api`) — hors périmètre.
- Identifiants de code, noms de fichiers, commentaires restent en anglais.

---

## Task 1: Traduire `Pm2.tsx`

**Files:**
- Create: `apps/web/public/locales/fr/pm2.json`
- Create: `apps/web/public/locales/en/pm2.json`
- Create: `apps/web/public/locales/ta/pm2.json`
- Modify: `apps/web/src/routes/Pm2.tsx`
- Modify: `apps/web/src/lib/i18n.ts`

**Interfaces:**
- Consumes: `useTranslation` de `react-i18next` (déjà installé).
- Produces: rien de consommé par d'autres tâches de ce plan (écran indépendant).

État actuel complet de `apps/web/src/routes/Pm2.tsx` (219 lignes) — chaînes françaises à extraire : les 3 `Record<Pm2Status, string>` de labels de statut (ligne 21-28, valeurs uniquement — les clés `online`/`stopped`/etc. restent en anglais car ce sont des valeurs techniques de l'API), le titre de carte "Processus Node.js (PM2)" (l.92), le texte d'aide (l.95-96), le message d'erreur `pm2_not_installed` (l.63), "Chargement…" (l.102), "Aucun processus PM2 détecté." (l.104), le suffixe "redémarrage(s)" interpolé (l.130), les `title` des boutons "Redémarrer"/"Arrêter"/"Démarrer"/"Logs" (l.144, 150, 166, 175), le titre et la description de `ConfirmDialog` (l.154-156), le label "Arrêter" du bouton de confirmation (l.156), et "Logs en direct" (l.213).

- [ ] **Step 1: Créer les fichiers `pm2.json`**

`apps/web/public/locales/fr/pm2.json`:
```json
{
  "title": "Processus Node.js (PM2)",
  "description": "Applications Node.js gérées par PM2 directement sur l'hôte (hors Docker). Les applications qui tournent dans des conteneurs Docker sont gérées depuis l'écran Docker.",
  "notInstalled": "PM2 n'est pas installé sur ce serveur.",
  "loading": "Chargement…",
  "empty": "Aucun processus PM2 détecté.",
  "status": {
    "online": "en ligne",
    "stopped": "arrêté",
    "stopping": "arrêt en cours",
    "launching": "démarrage",
    "errored": "en erreur",
    "one-launch-status": "unique"
  },
  "restarts_one": "{{count}} redémarrage",
  "restarts_other": "{{count}} redémarrages",
  "actions": {
    "restart": "Redémarrer",
    "stop": "Arrêter",
    "start": "Démarrer",
    "logs": "Logs"
  },
  "stopConfirm": {
    "title": "Arrêter {{name}} ?",
    "description": "Le processus ne répondra plus tant qu'il n'est pas redémarré."
  },
  "liveLogs": "Logs en direct"
}
```

`apps/web/public/locales/en/pm2.json`:
```json
{
  "title": "Node.js processes (PM2)",
  "description": "Node.js applications managed by PM2 directly on the host (outside Docker). Applications running in Docker containers are managed from the Docker screen.",
  "notInstalled": "PM2 is not installed on this server.",
  "loading": "Loading…",
  "empty": "No PM2 process detected.",
  "status": {
    "online": "online",
    "stopped": "stopped",
    "stopping": "stopping",
    "launching": "starting",
    "errored": "errored",
    "one-launch-status": "one-off"
  },
  "restarts_one": "{{count}} restart",
  "restarts_other": "{{count}} restarts",
  "actions": {
    "restart": "Restart",
    "stop": "Stop",
    "start": "Start",
    "logs": "Logs"
  },
  "stopConfirm": {
    "title": "Stop {{name}}?",
    "description": "The process will stop responding until it is restarted."
  },
  "liveLogs": "Live logs"
}
```

`apps/web/public/locales/ta/pm2.json`:
```json
{
  "title": "Node.js செயல்முறைகள் (PM2)",
  "description": "PM2 மூலம் நேரடியாக ஹோஸ்டில் நிர்வகிக்கப்படும் Node.js பயன்பாடுகள் (Docker இல் அல்ல). Docker கொள்கலன்களில் இயங்கும் பயன்பாடுகள் Docker திரையில் இருந்து நிர்வகிக்கப்படுகின்றன.",
  "notInstalled": "இந்த சேவையகத்தில் PM2 நிறுவப்படவில்லை.",
  "loading": "ஏற்றுகிறது…",
  "empty": "PM2 செயல்முறை எதுவும் கண்டறியப்படவில்லை.",
  "status": {
    "online": "இயங்குகிறது",
    "stopped": "நிறுத்தப்பட்டது",
    "stopping": "நிறுத்தப்படுகிறது",
    "launching": "தொடங்குகிறது",
    "errored": "பிழையில்",
    "one-launch-status": "ஒருமுறை"
  },
  "restarts_one": "{{count}} மறுதொடக்கம்",
  "restarts_other": "{{count}} மறுதொடக்கங்கள்",
  "actions": {
    "restart": "மறுதொடக்கு",
    "stop": "நிறுத்து",
    "start": "தொடங்கு",
    "logs": "பதிவுகள்"
  },
  "stopConfirm": {
    "title": "{{name}} ஐ நிறுத்தவா?",
    "description": "மறுதொடக்கம் செய்யும் வரை செயல்முறை பதிலளிக்காது."
  },
  "liveLogs": "நேரடி பதிவுகள்"
}
```

Note sur `restarts_one`/`restarts_other` : c'est la convention de pluralisation d'i18next (`count` déclenche automatiquement le suffixe `_one`/`_other` selon la valeur, `t("restarts", { count: p.restarts })`).

- [ ] **Step 2: Traduire `Pm2.tsx`**

Remplacer le contenu complet de `apps/web/src/routes/Pm2.tsx` par :
```tsx
import { useEffect, useState } from "react";
import type { Pm2Process, Pm2Status } from "@pwa-admin/shared";
import { useTranslation } from "react-i18next";
import { apiJson, apiFetch } from "@/lib/api";
import { useWsChannel } from "@/lib/ws";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LiveLogPanel } from "@/components/LiveLogPanel";
import { formatBytes } from "./Docker";
import { Hexagon, Play, Square, RotateCw, RefreshCw, FileText } from "lucide-react";

const STATUS_STYLES: Record<Pm2Status, string> = {
  online: "bg-primary/15 text-primary",
  stopped: "bg-muted text-muted-foreground",
  stopping: "bg-warning/15 text-warning",
  launching: "bg-warning/15 text-warning",
  errored: "bg-destructive/15 text-destructive",
  "one-launch-status": "bg-muted text-muted-foreground",
};

const CARD_STYLES: Record<Pm2Status, string> = {
  online: "border-primary/40 bg-primary/5",
  stopped: "border-muted-foreground/30 bg-muted/30",
  stopping: "border-warning/50 bg-warning/5",
  launching: "border-warning/50 bg-warning/5",
  errored: "border-destructive/50 bg-destructive/5",
  "one-launch-status": "border-muted-foreground/30 bg-muted/30",
};

function formatUptime(ms: number | null): string {
  if (ms == null) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}j ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function Pm2() {
  const { t } = useTranslation("pm2");
  const [processes, setProcesses] = useState<Pm2Process[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [expandedName, setExpandedName] = useState<string | null>(null);

  function loadProcesses() {
    return apiJson<Pm2Process[]>("/pm2/processes")
      .then(setProcesses)
      .catch((err) => {
        const message = (err as Error).message;
        setError(message === "pm2_not_installed" ? t("notInstalled") : message);
      });
  }

  useEffect(() => {
    loadProcesses();
    const interval = setInterval(loadProcesses, 5000);
    return () => clearInterval(interval);
  }, []);

  async function runAction(name: string, action: "start" | "stop" | "restart" | "reload") {
    setBusyName(name);
    setError(null);
    try {
      await apiJson(`/pm2/processes/${encodeURIComponent(name)}/${action}`, { method: "POST" });
      await loadProcesses();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyName(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitle className="flex items-center gap-1">
          <Hexagon className="h-4 w-4" /> {t("title")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </Card>

      {error && <Card className="text-sm text-destructive">{error}</Card>}

      {!processes && !error && <Card className="text-sm text-muted-foreground">{t("loading")}</Card>}
      {processes?.length === 0 && <Card className="text-sm text-muted-foreground">{t("empty")}</Card>}

      <div className="flex flex-col gap-3">
        {processes?.map((p) => (
          <Card key={p.pmId} className={CARD_STYLES[p.status]}>
            <div className="flex items-start justify-between gap-2">
              <div
                className="min-w-0 cursor-pointer"
                onClick={() => setExpandedName((prev) => (prev === p.name ? null : p.name))}
              >
                <p className="flex items-center gap-2 truncate font-medium">
                  {p.name}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status]}`}>
                    {t(`status.${p.status}`)}
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.status === "online" ? (
                    <>
                      CPU {p.cpuPercent.toFixed(0)}% · RAM {formatBytes(p.memoryBytes)} · uptime{" "}
                      {formatUptime(p.uptimeMs)}
                    </>
                  ) : (
                    "—"
                  )}
                  {p.restarts > 0 ? ` · ${t("restarts", { count: p.restarts })}` : ""}
                </p>
                {p.scriptPath && (
                  <p className="mt-1 truncate text-xs text-muted-foreground">{p.scriptPath}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                {p.status === "online" ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyName === p.name}
                      onClick={() => runAction(p.name, "restart")}
                      title={t("actions.restart")}
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button size="sm" variant="destructive" disabled={busyName === p.name} title={t("actions.stop")}>
                          <Square className="h-3.5 w-3.5" />
                        </Button>
                      }
                      title={t("stopConfirm.title", { name: p.name })}
                      description={t("stopConfirm.description")}
                      confirmLabel={t("actions.stop")}
                      onConfirm={() => runAction(p.name, "stop")}
                    />
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyName === p.name}
                    onClick={() => runAction(p.name, "start")}
                    title={t("actions.start")}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setExpandedName((prev) => (prev === p.name ? null : p.name))}
                  title={t("actions.logs")}
                >
                  <FileText className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {expandedName === p.name && <Pm2ProcessDetail name={p.name} />}
          </Card>
        ))}
      </div>
    </div>
  );
}

function Pm2ProcessDetail({ name }: { name: string }) {
  const { t } = useTranslation("pm2");
  const [initialLogs, setInitialLogs] = useState<string>("");
  const [liveChunk, setLiveChunk] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(`/pm2/processes/${encodeURIComponent(name)}/logs?lines=200`)
      .then((res) => res.text())
      .then(setInitialLogs)
      .catch(() => {});
  }, [name]);

  useWsChannel(
    "pm2.logs",
    (frame) => {
      setLiveChunk(frame.data as string);
    },
    { name }
  );

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
      <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        <RefreshCw className="h-3.5 w-3.5" /> {t("liveLogs")}
      </p>
      <LiveLogPanel initialText={initialLogs} chunk={liveChunk} />
    </div>
  );
}
```

Note : `STATUS_LABELS` (l'ancien `Record<Pm2Status, string>` en dur) est supprimé — remplacé par `t(\`status.${p.status}\`)`.

- [ ] **Step 3: Ajouter le namespace `pm2` à `lib/i18n.ts`**

Modifier `apps/web/src/lib/i18n.ts`, ligne `ns: [...]` — état actuel `["common", "nav", "settings", "login"]`, remplacer par :
```ts
    ns: ["common", "nav", "settings", "login", "pm2"],
```

- [ ] **Step 4: Vérifier le typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: aucune erreur.

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/locales/fr/pm2.json apps/web/public/locales/en/pm2.json apps/web/public/locales/ta/pm2.json apps/web/src/routes/Pm2.tsx apps/web/src/lib/i18n.ts
git commit -m "feat(web): traduire l'écran Pm2 via i18next"
```

---

## Task 2: Traduire `Security.tsx`

**Files:**
- Create: `apps/web/public/locales/fr/security.json`
- Create: `apps/web/public/locales/en/security.json`
- Create: `apps/web/public/locales/ta/security.json`
- Modify: `apps/web/src/routes/Security.tsx`
- Modify: `apps/web/src/lib/i18n.ts`

**Interfaces:**
- Consumes: `useTranslation` de `react-i18next`.
- Produces: rien de consommé par d'autres tâches.

État actuel : `apps/web/src/routes/Security.tsx` (289 lignes, 9 cartes : UFW, fail2ban, SSH, Tailscale, unattended-upgrades, TLS, auth app). Chaînes à extraire incluent des textes longs avec interpolation de nombres/dates (ex: "Expire dans {{days}} jours", "{{banned}} banni(s) actuellement").

- [ ] **Step 1: Créer les fichiers `security.json`**

`apps/web/public/locales/fr/security.json`:
```json
{
  "title": "Sécurité du serveur",
  "description": "État en direct des mécanismes de protection du Raspberry Pi et de l'application.",
  "refresh": "Actualiser",
  "loading": "Chargement…",
  "statusUnknown": "inconnu",
  "statusActive": "actif",
  "statusInactive": "inactif",
  "ufw": {
    "title": "Pare-feu (UFW)",
    "defaults": "Par défaut : entrant {{incoming}}, sortant {{outgoing}}",
    "noRules": "Aucune règle explicite.",
    "notInstalled": "UFW non installé — le serveur n'a pas de pare-feu applicatif."
  },
  "fail2ban": {
    "title": "fail2ban",
    "jailStats": "{{banned}} banni(s) actuellement · {{total}} au total",
    "noJails": "Aucune jail configurée.",
    "notInstalled": "fail2ban non installé — pas de protection anti brute-force."
  },
  "ssh": {
    "title": "SSH",
    "port": "Port",
    "rootLogin": "Connexion root",
    "rootLoginDisabled": "désactivée",
    "rootLoginEnabled": "autorisée",
    "passwordAuth": "Authentification par mot de passe",
    "passwordAuthDisabled": "désactivée (clé)",
    "passwordAuthEnabled": "activée",
    "maxAuthTries": "Tentatives max"
  },
  "tailscale": {
    "title": "Tailscale",
    "connected": "connecté",
    "disconnected": "déconnecté",
    "host": "Hôte : {{hostname}}",
    "tailnet": "Tailnet : {{name}}",
    "notInstalled": "Tailscale non installé — vérifier que l'accès n'est pas exposé publiquement."
  },
  "unattendedUpgrades": {
    "title": "Mises à jour automatiques",
    "lastRun": "Dernière exécution : {{date}}",
    "lastRunPackages": "Paquets mis à jour : {{packages}}",
    "pendingSecurity": "Mises à jour de sécurité en attente"
  },
  "tls": {
    "title": "TLS (app)",
    "present": "présent",
    "absent": "absent",
    "expiresIn": "Expire dans {{days}} jours",
    "notConfigured": "Pas de certificat TLS configuré — l'app tourne peut-être en HTTP non chiffré."
  },
  "appAuth": {
    "title": "Authentification de l'app (JWT + 2FA)",
    "twoFactorAccounts": "Comptes avec 2FA activée",
    "twoFactorWarning": "Au moins un compte n'a pas activé la 2FA — recommandé pour tous les administrateurs (voir Settings).",
    "jwtTtl": "Durée de vie du token d'accès",
    "rateLimit": "Rate limiting sur la connexion",
    "rateLimitEnabled": "activé",
    "rateLimitDisabled": "désactivé"
  }
}
```

`apps/web/public/locales/en/security.json`:
```json
{
  "title": "Server security",
  "description": "Live status of the Raspberry Pi's and the app's protection mechanisms.",
  "refresh": "Refresh",
  "loading": "Loading…",
  "statusUnknown": "unknown",
  "statusActive": "active",
  "statusInactive": "inactive",
  "ufw": {
    "title": "Firewall (UFW)",
    "defaults": "Default: incoming {{incoming}}, outgoing {{outgoing}}",
    "noRules": "No explicit rules.",
    "notInstalled": "UFW not installed — the server has no application firewall."
  },
  "fail2ban": {
    "title": "fail2ban",
    "jailStats": "{{banned}} currently banned · {{total}} total",
    "noJails": "No jail configured.",
    "notInstalled": "fail2ban not installed — no brute-force protection."
  },
  "ssh": {
    "title": "SSH",
    "port": "Port",
    "rootLogin": "Root login",
    "rootLoginDisabled": "disabled",
    "rootLoginEnabled": "allowed",
    "passwordAuth": "Password authentication",
    "passwordAuthDisabled": "disabled (key)",
    "passwordAuthEnabled": "enabled",
    "maxAuthTries": "Max attempts"
  },
  "tailscale": {
    "title": "Tailscale",
    "connected": "connected",
    "disconnected": "disconnected",
    "host": "Host: {{hostname}}",
    "tailnet": "Tailnet: {{name}}",
    "notInstalled": "Tailscale not installed — verify access isn't publicly exposed."
  },
  "unattendedUpgrades": {
    "title": "Automatic updates",
    "lastRun": "Last run: {{date}}",
    "lastRunPackages": "Packages updated: {{packages}}",
    "pendingSecurity": "Pending security updates"
  },
  "tls": {
    "title": "TLS (app)",
    "present": "present",
    "absent": "absent",
    "expiresIn": "Expires in {{days}} days",
    "notConfigured": "No TLS certificate configured — the app might be running over unencrypted HTTP."
  },
  "appAuth": {
    "title": "App authentication (JWT + 2FA)",
    "twoFactorAccounts": "Accounts with 2FA enabled",
    "twoFactorWarning": "At least one account hasn't enabled 2FA — recommended for every administrator (see Settings).",
    "jwtTtl": "Access token lifetime",
    "rateLimit": "Login rate limiting",
    "rateLimitEnabled": "enabled",
    "rateLimitDisabled": "disabled"
  }
}
```

`apps/web/public/locales/ta/security.json`:
```json
{
  "title": "சேவையக பாதுகாப்பு",
  "description": "Raspberry Pi மற்றும் பயன்பாட்டின் பாதுகாப்பு வழிமுறைகளின் நேரடி நிலை.",
  "refresh": "புதுப்பி",
  "loading": "ஏற்றுகிறது…",
  "statusUnknown": "தெரியவில்லை",
  "statusActive": "செயலில்",
  "statusInactive": "செயலற்றது",
  "ufw": {
    "title": "தீவைரவு (UFW)",
    "defaults": "இயல்புநிலை: உள்வரும் {{incoming}}, வெளிச்செல்லும் {{outgoing}}",
    "noRules": "வெளிப்படையான விதிகள் இல்லை.",
    "notInstalled": "UFW நிறுவப்படவில்லை — சேவையகத்திற்கு பயன்பாட்டு தீவைரவு இல்லை."
  },
  "fail2ban": {
    "title": "fail2ban",
    "jailStats": "தற்போது {{banned}} தடைசெய்யப்பட்டது · மொத்தம் {{total}}",
    "noJails": "எந்த jail ஐயும் கட்டமைக்கப்படவில்லை.",
    "notInstalled": "fail2ban நிறுவப்படவில்லை — brute-force தடுப்பு இல்லை."
  },
  "ssh": {
    "title": "SSH",
    "port": "போர்ட்",
    "rootLogin": "Root உள்நுழைவு",
    "rootLoginDisabled": "முடக்கப்பட்டது",
    "rootLoginEnabled": "அனுமதிக்கப்பட்டது",
    "passwordAuth": "கடவுச்சொல் அங்கீகாரம்",
    "passwordAuthDisabled": "முடக்கப்பட்டது (சாவி)",
    "passwordAuthEnabled": "இயக்கப்பட்டது",
    "maxAuthTries": "அதிகபட்ச முயற்சிகள்"
  },
  "tailscale": {
    "title": "Tailscale",
    "connected": "இணைக்கப்பட்டது",
    "disconnected": "துண்டிக்கப்பட்டது",
    "host": "ஹோஸ்ட்: {{hostname}}",
    "tailnet": "Tailnet: {{name}}",
    "notInstalled": "Tailscale நிறுவப்படவில்லை — அணுகல் பொதுவில் திறக்கப்படவில்லை என்பதை சரிபார்க்கவும்."
  },
  "unattendedUpgrades": {
    "title": "தானியங்கி புதுப்பிப்புகள்",
    "lastRun": "கடைசி இயக்கம்: {{date}}",
    "lastRunPackages": "புதுப்பிக்கப்பட்ட தொகுப்புகள்: {{packages}}",
    "pendingSecurity": "நிலுவையிலுள்ள பாதுகாப்பு புதுப்பிப்புகள்"
  },
  "tls": {
    "title": "TLS (பயன்பாடு)",
    "present": "உள்ளது",
    "absent": "இல்லை",
    "expiresIn": "{{days}} நாட்களில் காலாவதியாகும்",
    "notConfigured": "TLS சான்றிதழ் கட்டமைக்கப்படவில்லை — பயன்பாடு குறியாக்கம் செய்யப்படாத HTTP இல் இயங்கக்கூடும்."
  },
  "appAuth": {
    "title": "பயன்பாட்டு அங்கீகாரம் (JWT + 2FA)",
    "twoFactorAccounts": "2FA இயக்கப்பட்ட கணக்குகள்",
    "twoFactorWarning": "குறைந்தது ஒரு கணக்கு 2FA ஐ இயக்கவில்லை — அனைத்து நிர்வாகிகளுக்கும் பரிந்துரைக்கப்படுகிறது (அமைப்புகளைப் பார்க்கவும்).",
    "jwtTtl": "அணுகல் டோக்கன் காலம்",
    "rateLimit": "உள்நுழைவு வீத வரம்பு",
    "rateLimitEnabled": "இயக்கப்பட்டது",
    "rateLimitDisabled": "முடக்கப்பட்டது"
  }
}
```

- [ ] **Step 2: Traduire `Security.tsx`**

Remplacer le contenu complet de `apps/web/src/routes/Security.tsx` par :
```tsx
import { useEffect, useState } from "react";
import type { SecurityOverview } from "@pwa-admin/shared";
import { useTranslation } from "react-i18next";
import { apiJson } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldBan,
  KeyRound,
  RefreshCw,
  Lock,
  Radio,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

function StatusBadge({ ok, okLabel, badLabel }: { ok: boolean | null; okLabel: string; badLabel: string }) {
  const { t } = useTranslation("security");
  if (ok === null) {
    return <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{t("statusUnknown")}</span>;
  }
  return (
    <span
      className={
        "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium " +
        (ok ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive")
      }
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {ok ? okLabel : badLabel}
    </span>
  );
}

export function Security() {
  const { t } = useTranslation("security");
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    return apiJson<SecurityOverview>("/security/overview")
      .then(setOverview)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-center justify-between">
          <CardTitle className="mb-0 flex items-center gap-1">
            <ShieldCheck className="h-4 w-4" /> {t("title")}
          </CardTitle>
          <button
            onClick={load}
            disabled={loading}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
            title={t("refresh")}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </Card>

      {error && <Card className="text-sm text-destructive">{error}</Card>}
      {!overview && !error && <Card className="text-sm text-muted-foreground">{t("loading")}</Card>}

      {overview && (
        <>
          {/* UFW */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0">{t("ufw.title")}</CardTitle>
              <StatusBadge ok={overview.ufw.active} okLabel={t("statusActive")} badLabel={t("statusInactive")} />
            </div>
            {overview.ufw.installed ? (
              <>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("ufw.defaults", {
                    incoming: overview.ufw.defaultIncoming ?? "?",
                    outgoing: overview.ufw.defaultOutgoing ?? "?",
                  })}
                </p>
                <div className="mt-2 flex flex-col gap-1">
                  {overview.ufw.rules.map((r, i) => (
                    <div key={i} className="flex items-center justify-between border-b border-border/50 py-1 text-xs last:border-0">
                      <span className="font-mono">
                        {r.to} ← {r.from}
                      </span>
                      <span className="flex items-center gap-2">
                        {r.comment && <span className="text-muted-foreground">{r.comment}</span>}
                        <span
                          className={
                            "rounded-full px-2 py-0.5 text-[10px] font-medium " +
                            (r.action === "ALLOW"
                              ? "bg-primary/15 text-primary"
                              : "bg-destructive/15 text-destructive")
                          }
                        >
                          {r.action}
                        </span>
                      </span>
                    </div>
                  ))}
                  {overview.ufw.rules.length === 0 && (
                    <p className="text-xs text-muted-foreground">{t("ufw.noRules")}</p>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-1 text-xs text-destructive">{t("ufw.notInstalled")}</p>
            )}
          </Card>

          {/* fail2ban */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0 flex items-center gap-1">
                <ShieldBan className="h-4 w-4" /> {t("fail2ban.title")}
              </CardTitle>
              <StatusBadge
                ok={overview.fail2ban.installed && overview.fail2ban.active}
                okLabel={t("statusActive")}
                badLabel={t("statusInactive")}
              />
            </div>
            {overview.fail2ban.installed ? (
              <div className="mt-2 flex flex-col gap-1">
                {overview.fail2ban.jails.map((j) => (
                  <div key={j.name} className="flex items-center justify-between border-b border-border/50 py-1 text-xs last:border-0">
                    <span className="font-mono">{j.name}</span>
                    <span className="text-muted-foreground">
                      {t("fail2ban.jailStats", { banned: j.currentlyBanned, total: j.totalBanned })}
                    </span>
                  </div>
                ))}
                {overview.fail2ban.jails.length === 0 && (
                  <p className="text-xs text-muted-foreground">{t("fail2ban.noJails")}</p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs text-destructive">{t("fail2ban.notInstalled")}</p>
            )}
          </Card>

          {/* SSH */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0 flex items-center gap-1">
                <KeyRound className="h-4 w-4" /> {t("ssh.title")}
              </CardTitle>
              <StatusBadge ok={overview.ssh.active} okLabel={t("statusActive")} badLabel={t("statusInactive")} />
            </div>
            <div className="mt-2 flex flex-col gap-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("ssh.port")}</span>
                <span className="font-mono">{overview.ssh.port ?? 22}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("ssh.rootLogin")}</span>
                <StatusBadge
                  ok={overview.ssh.rootLoginPermitted === null ? null : !overview.ssh.rootLoginPermitted}
                  okLabel={t("ssh.rootLoginDisabled")}
                  badLabel={t("ssh.rootLoginEnabled")}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("ssh.passwordAuth")}</span>
                <StatusBadge
                  ok={overview.ssh.passwordAuthEnabled === null ? null : !overview.ssh.passwordAuthEnabled}
                  okLabel={t("ssh.passwordAuthDisabled")}
                  badLabel={t("ssh.passwordAuthEnabled")}
                />
              </div>
              {overview.ssh.maxAuthTries != null && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("ssh.maxAuthTries")}</span>
                  <span className="font-mono">{overview.ssh.maxAuthTries}</span>
                </div>
              )}
            </div>
          </Card>

          {/* Tailscale */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0 flex items-center gap-1">
                <Radio className="h-4 w-4" /> {t("tailscale.title")}
              </CardTitle>
              <StatusBadge ok={overview.tailscale.running} okLabel={t("tailscale.connected")} badLabel={t("tailscale.disconnected")} />
            </div>
            {overview.tailscale.installed ? (
              <div className="mt-2 flex flex-col gap-1 text-xs">
                {overview.tailscale.hostname && (
                  <p className="text-muted-foreground">{t("tailscale.host", { hostname: overview.tailscale.hostname })}</p>
                )}
                {overview.tailscale.tailnetName && (
                  <p className="text-muted-foreground">{t("tailscale.tailnet", { name: overview.tailscale.tailnetName })}</p>
                )}
                {overview.tailscale.tailscaleIps.map((ip) => (
                  <p key={ip} className="font-mono text-muted-foreground">{ip}</p>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-destructive">{t("tailscale.notInstalled")}</p>
            )}
          </Card>

          {/* unattended-upgrades */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0">{t("unattendedUpgrades.title")}</CardTitle>
              <StatusBadge
                ok={overview.unattendedUpgrades.installed && overview.unattendedUpgrades.timerActive}
                okLabel={t("statusActive")}
                badLabel={t("statusInactive")}
              />
            </div>
            <div className="mt-2 flex flex-col gap-1 text-xs">
              {overview.unattendedUpgrades.lastRunAt && (
                <p className="text-muted-foreground">
                  {t("unattendedUpgrades.lastRun", { date: new Date(overview.unattendedUpgrades.lastRunAt).toLocaleString() })}
                </p>
              )}
              {overview.unattendedUpgrades.lastRunPackages.length > 0 && (
                <p className="text-muted-foreground">
                  {t("unattendedUpgrades.lastRunPackages", { packages: overview.unattendedUpgrades.lastRunPackages.join(", ") })}
                </p>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("unattendedUpgrades.pendingSecurity")}</span>
                <span className={overview.unattendedUpgrades.pendingSecurityUpdates > 0 ? "font-medium text-warning" : "font-mono"}>
                  {overview.unattendedUpgrades.pendingSecurityUpdates}
                </span>
              </div>
            </div>
          </Card>

          {/* TLS */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0 flex items-center gap-1">
                <Lock className="h-4 w-4" /> {t("tls.title")}
              </CardTitle>
              <StatusBadge ok={overview.appTls.found} okLabel={t("tls.present")} badLabel={t("tls.absent")} />
            </div>
            {overview.appTls.found ? (
              <div className="mt-2 flex flex-col gap-1 text-xs">
                {overview.appTls.subject && <p className="text-muted-foreground">{overview.appTls.subject}</p>}
                {overview.appTls.daysRemaining != null && (
                  <p className={overview.appTls.daysRemaining < 30 ? "font-medium text-warning" : "text-muted-foreground"}>
                    {t("tls.expiresIn", { days: overview.appTls.daysRemaining })}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs text-destructive">{t("tls.notConfigured")}</p>
            )}
          </Card>

          {/* App auth: JWT + 2FA */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0 flex items-center gap-1">
                <ShieldAlert className="h-4 w-4" /> {t("appAuth.title")}
              </CardTitle>
            </div>
            <div className="mt-2 flex flex-col gap-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("appAuth.twoFactorAccounts")}</span>
                <span className="font-mono">
                  {overview.appAuth.usersWithTwoFactor} / {overview.appAuth.totalUsers}
                </span>
              </div>
              {overview.appAuth.usersWithTwoFactor < overview.appAuth.totalUsers && (
                <p className="flex items-center gap-1 text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" /> {t("appAuth.twoFactorWarning")}
                </p>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("appAuth.jwtTtl")}</span>
                <span className="font-mono">{overview.appAuth.jwtAccessTtl ?? "?"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("appAuth.rateLimit")}</span>
                <StatusBadge ok={overview.appAuth.rateLimitEnabled} okLabel={t("appAuth.rateLimitEnabled")} badLabel={t("appAuth.rateLimitDisabled")} />
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Ajouter le namespace `security` à `lib/i18n.ts`**

Modifier `apps/web/src/lib/i18n.ts` — état après Task 1 : `ns: ["common", "nav", "settings", "login", "pm2"]`, remplacer par :
```ts
    ns: ["common", "nav", "settings", "login", "pm2", "security"],
```

- [ ] **Step 4: Vérifier le typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: aucune erreur.

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/locales/fr/security.json apps/web/public/locales/en/security.json apps/web/public/locales/ta/security.json apps/web/src/routes/Security.tsx apps/web/src/lib/i18n.ts
git commit -m "feat(web): traduire l'écran Security via i18next"
```

---

## Task 3: Traduire `OsSystem.tsx`

**Files:**
- Create: `apps/web/public/locales/fr/os.json`
- Create: `apps/web/public/locales/en/os.json`
- Create: `apps/web/public/locales/ta/os.json`
- Modify: `apps/web/src/routes/OsSystem.tsx`
- Modify: `apps/web/src/lib/i18n.ts`

**Interfaces:**
- Consumes: `useTranslation` de `react-i18next`.
- Produces: rien de consommé par d'autres tâches.

État actuel : `apps/web/src/routes/OsSystem.tsx` (315 lignes, 3 composants : `OsSystem`, `OsUpgradeJobPanel`, `InstalledPackagesCard`).

- [ ] **Step 1: Créer les fichiers `os.json`**

`apps/web/public/locales/fr/os.json`:
```json
{
  "system": {
    "title": "Système",
    "loading": "Chargement…",
    "uptime": "Uptime : {{uptime}}",
    "kernel": "Noyau {{kernel}} · {{arch}} · {{hostname}}"
  },
  "rebootRequired": {
    "title": "Redémarrage requis"
  },
  "upgrades": {
    "title": "Mises à jour",
    "loading": "Chargement…",
    "count": "{{count}} paquet(s) à mettre à jour",
    "check": "Vérifier les mises à jour",
    "upgrade": "Mettre à jour",
    "confirmTitle": "Lancer la mise à jour ?",
    "modeStandard": "upgrade (standard)",
    "modeFull": "full-upgrade (peut supprimer des paquets)",
    "fullAck": "Je comprends que cela peut supprimer des paquets",
    "confirmLaunch": "Lancer"
  },
  "job": {
    "titlePrefix": "Job en cours : {{jobId}}",
    "finished": "Terminé : {{status}} (code {{exitCode}})"
  },
  "held": {
    "title": "Paquets figés (hold)",
    "empty": "Aucun paquet figé.",
    "release": "Libérer"
  },
  "jobHistory": {
    "title": "Historique des jobs",
    "empty": "Aucun job."
  },
  "installedPackages": {
    "title": "Paquets installés ({{count}})",
    "filterPlaceholder": "Filtrer par nom…",
    "more": "…{{count}} de plus, affinez le filtre",
    "empty": "Aucun résultat."
  }
}
```

`apps/web/public/locales/en/os.json`:
```json
{
  "system": {
    "title": "System",
    "loading": "Loading…",
    "uptime": "Uptime: {{uptime}}",
    "kernel": "Kernel {{kernel}} · {{arch}} · {{hostname}}"
  },
  "rebootRequired": {
    "title": "Reboot required"
  },
  "upgrades": {
    "title": "Updates",
    "loading": "Loading…",
    "count": "{{count}} package(s) to update",
    "check": "Check for updates",
    "upgrade": "Upgrade",
    "confirmTitle": "Start the upgrade?",
    "modeStandard": "upgrade (standard)",
    "modeFull": "full-upgrade (may remove packages)",
    "fullAck": "I understand this may remove packages",
    "confirmLaunch": "Start"
  },
  "job": {
    "titlePrefix": "Job in progress: {{jobId}}",
    "finished": "Finished: {{status}} (code {{exitCode}})"
  },
  "held": {
    "title": "Held packages",
    "empty": "No held packages.",
    "release": "Release"
  },
  "jobHistory": {
    "title": "Job history",
    "empty": "No jobs."
  },
  "installedPackages": {
    "title": "Installed packages ({{count}})",
    "filterPlaceholder": "Filter by name…",
    "more": "…{{count}} more, refine the filter",
    "empty": "No results."
  }
}
```

`apps/web/public/locales/ta/os.json`:
```json
{
  "system": {
    "title": "System",
    "loading": "ஏற்றுகிறது…",
    "uptime": "இயங்கிய நேரம்: {{uptime}}",
    "kernel": "கர்னல் {{kernel}} · {{arch}} · {{hostname}}"
  },
  "rebootRequired": {
    "title": "மறுதொடக்கம் தேவை"
  },
  "upgrades": {
    "title": "புதுப்பிப்புகள்",
    "loading": "ஏற்றுகிறது…",
    "count": "{{count}} தொகுப்பு(கள்) புதுப்பிக்க வேண்டும்",
    "check": "புதுப்பிப்புகளைச் சரிபார்க்கவும்",
    "upgrade": "புதுப்பி",
    "confirmTitle": "புதுப்பிப்பைத் தொடங்கவா?",
    "modeStandard": "upgrade (நிலையான)",
    "modeFull": "full-upgrade (தொகுப்புகளை அகற்றக்கூடும்)",
    "fullAck": "இது தொகுப்புகளை அகற்றக்கூடும் என்பதை புரிந்துகொள்கிறேன்",
    "confirmLaunch": "தொடங்கு"
  },
  "job": {
    "titlePrefix": "நடப்பில் உள்ள பணி: {{jobId}}",
    "finished": "முடிந்தது: {{status}} (குறியீடு {{exitCode}})"
  },
  "held": {
    "title": "முடக்கப்பட்ட தொகுப்புகள்",
    "empty": "முடக்கப்பட்ட தொகுப்புகள் இல்லை.",
    "release": "விடுவி"
  },
  "jobHistory": {
    "title": "பணி வரலாறு",
    "empty": "பணிகள் இல்லை."
  },
  "installedPackages": {
    "title": "நிறுவப்பட்ட தொகுப்புகள் ({{count}})",
    "filterPlaceholder": "பெயரால் வடிகட்டு…",
    "more": "…மேலும் {{count}}, வடிகட்டியை மேம்படுத்தவும்",
    "empty": "முடிவுகள் இல்லை."
  }
}
```

- [ ] **Step 2: Traduire `OsSystem.tsx`**

Remplacer le contenu complet de `apps/web/src/routes/OsSystem.tsx` par :
```tsx
import { useEffect, useMemo, useState } from "react";
import type { OsInfo, InstalledPackage, UpgradablePackage, OsJob } from "@pwa-admin/shared";
import { useTranslation } from "react-i18next";
import { apiJson } from "@/lib/api";
import { useWsChannel } from "@/lib/ws";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LiveLogPanel } from "@/components/LiveLogPanel";
import { AlertTriangle, PackageCheck, Lock, Unlock, RefreshCw } from "lucide-react";

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}j ${hours}h ${minutes}m`;
}

export function OsSystem() {
  const { t } = useTranslation("os");
  const [info, setInfo] = useState<OsInfo | null>(null);
  const [upgradable, setUpgradable] = useState<UpgradablePackage[] | null>(null);
  const [held, setHeld] = useState<string[] | null>(null);
  const [jobs, setJobs] = useState<OsJob[] | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [fullUpgradeAck, setFullUpgradeAck] = useState(false);
  const [upgradeMode, setUpgradeMode] = useState<"upgrade" | "full-upgrade">("upgrade");
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    try {
      const [i, u, h, j] = await Promise.all([
        apiJson<OsInfo>("/os/info"),
        apiJson<UpgradablePackage[]>("/os/packages/upgradable"),
        apiJson<string[]>("/os/packages/held"),
        apiJson<OsJob[]>("/os/jobs"),
      ]);
      setInfo(i);
      setUpgradable(u);
      setHeld(h);
      setJobs(j);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function checkUpdates() {
    setChecking(true);
    try {
      await apiJson("/os/update-check", { method: "POST" });
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }

  async function startUpgrade() {
    try {
      const { jobId } = await apiJson<{ jobId: string }>("/os/upgrade", {
        method: "POST",
        body: JSON.stringify({ mode: upgradeMode }),
      });
      setActiveJobId(jobId);
      setFullUpgradeAck(false);
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function unhold(name: string) {
    await apiJson(`/os/packages/${name}/unhold`, { method: "POST" });
    await loadAll();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Card className="text-sm text-destructive">{error}</Card>}

      <Card>
        <CardTitle>{t("system.title")}</CardTitle>
        {info ? (
          <div className="text-sm">
            <p>{info.distro} {info.release}</p>
            <p className="text-xs text-muted-foreground">
              {t("system.kernel", { kernel: info.kernel, arch: info.arch, hostname: info.hostname })}
            </p>
            <p className="text-xs text-muted-foreground">{t("system.uptime", { uptime: formatUptime(info.uptimeSeconds) })}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("system.loading")}</p>
        )}
      </Card>

      {info?.rebootRequired && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">{t("rebootRequired.title")}</p>
            {info.rebootRequiredPackages.length > 0 && (
              <p className="text-xs">{info.rebootRequiredPackages.join(", ")}</p>
            )}
          </div>
        </div>
      )}

      <Card>
        <CardTitle>{t("upgrades.title")}</CardTitle>
        <p className="text-sm">{upgradable ? t("upgrades.count", { count: upgradable.length }) : t("upgrades.loading")}</p>
        {upgradable && upgradable.length > 0 && (
          <div className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
            {upgradable.map((p) => (
              <div key={p.name} className="flex items-center justify-between text-xs">
                <span className="truncate font-mono">{p.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {p.currentVersion} → {p.availableVersion}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={checking} onClick={checkUpdates}>
            <RefreshCw className="h-3.5 w-3.5" /> {t("upgrades.check")}
          </Button>
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="destructive" disabled={!upgradable || upgradable.length === 0}>
                <PackageCheck className="h-3.5 w-3.5" /> {t("upgrades.upgrade")}
              </Button>
            }
            title={t("upgrades.confirmTitle")}
            description={
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    checked={upgradeMode === "upgrade"}
                    onChange={() => setUpgradeMode("upgrade")}
                  />
                  {t("upgrades.modeStandard")}
                </label>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    checked={upgradeMode === "full-upgrade"}
                    onChange={() => setUpgradeMode("full-upgrade")}
                  />
                  {t("upgrades.modeFull")}
                </label>
                {upgradeMode === "full-upgrade" && (
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={fullUpgradeAck}
                      onChange={(e) => setFullUpgradeAck(e.target.checked)}
                    />
                    {t("upgrades.fullAck")}
                  </label>
                )}
              </div>
            }
            confirmLabel={t("upgrades.confirmLaunch")}
            onConfirm={() => {
              if (upgradeMode === "full-upgrade" && !fullUpgradeAck) return;
              return startUpgrade();
            }}
          />
        </div>
      </Card>

      {activeJobId && (
        <Card>
          <CardTitle>{t("job.titlePrefix", { jobId: activeJobId })}</CardTitle>
          <OsUpgradeJobPanel jobId={activeJobId} onFinished={loadAll} />
        </Card>
      )}

      <Card>
        <CardTitle>{t("held.title")}</CardTitle>
        {held && held.length > 0 ? (
          <div className="flex flex-col gap-1">
            {held.map((name) => (
              <div key={name} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1 font-mono text-xs">
                  <Lock className="h-3.5 w-3.5" /> {name}
                </span>
                <Button size="sm" variant="outline" onClick={() => unhold(name)}>
                  <Unlock className="h-3.5 w-3.5" /> {t("held.release")}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("held.empty")}</p>
        )}
      </Card>

      <Card>
        <CardTitle>{t("jobHistory.title")}</CardTitle>
        {jobs && jobs.length > 0 ? (
          <div className="flex flex-col gap-1">
            {jobs.map((j) => (
              <button
                key={j.jobId}
                onClick={() => setActiveJobId(j.jobId)}
                className="flex items-center justify-between rounded-md border border-border p-2 text-left text-xs hover:bg-muted"
              >
                <span>
                  {j.kind} · {new Date(j.startedAt).toLocaleString()}
                </span>
                <span
                  className={
                    "rounded-full px-2 py-0.5 font-medium " +
                    (j.status === "succeeded"
                      ? "bg-primary/15 text-primary"
                      : j.status === "failed"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-warning/15 text-warning")
                  }
                >
                  {j.status}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("jobHistory.empty")}</p>
        )}
      </Card>

      <InstalledPackagesCard />
    </div>
  );
}

function OsUpgradeJobPanel({ jobId, onFinished }: { jobId: string; onFinished: () => void }) {
  const { t } = useTranslation("os");
  const [chunk, setChunk] = useState<string | null>(null);
  const [result, setResult] = useState<{ exitCode: number; status: string } | null>(null);

  useWsChannel(
    "os.upgrade",
    (frame) => {
      if (typeof frame.data === "string") {
        setChunk(frame.data);
      } else if (frame.data && typeof frame.data === "object" && (frame.data as any).done) {
        const d = frame.data as { exitCode: number; status: string };
        setResult(d);
        onFinished();
      }
    },
    { jobId }
  );

  return (
    <div className="flex flex-col gap-2">
      <LiveLogPanel chunk={chunk} />
      {result && (
        <p className={`text-xs font-medium ${result.status === "succeeded" ? "text-primary" : "text-destructive"}`}>
          {t("job.finished", { status: result.status, exitCode: result.exitCode })}
        </p>
      )}
    </div>
  );
}

function InstalledPackagesCard() {
  const { t } = useTranslation("os");
  const [packages, setPackages] = useState<InstalledPackage[] | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    apiJson<InstalledPackage[]>("/os/packages")
      .then(setPackages)
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    if (!packages) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return packages;
    return packages.filter((p) => p.name.toLowerCase().includes(f));
  }, [packages, filter]);

  return (
    <Card>
      <CardTitle>{t("installedPackages.title", { count: packages?.length ?? "…" })}</CardTitle>
      <input
        type="text"
        placeholder={t("installedPackages.filterPlaceholder")}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
      />
      <div className="max-h-72 overflow-y-auto">
        {filtered.slice(0, 300).map((p) => (
          <div key={p.name} className="flex items-center justify-between border-b border-border/50 py-1 text-xs last:border-0">
            <span className="truncate font-mono">{p.name}</span>
            <span className="shrink-0 text-muted-foreground">{p.version}</span>
          </div>
        ))}
        {filtered.length > 300 && (
          <p className="pt-1 text-xs text-muted-foreground">{t("installedPackages.more", { count: filtered.length - 300 })}</p>
        )}
        {packages && filtered.length === 0 && <p className="py-2 text-xs text-muted-foreground">{t("installedPackages.empty")}</p>}
      </div>
    </Card>
  );
}
```

- [ ] **Step 3: Ajouter le namespace `os` à `lib/i18n.ts`**

Modifier `apps/web/src/lib/i18n.ts` — état après Task 2 : `ns: ["common", "nav", "settings", "login", "pm2", "security"]`, remplacer par :
```ts
    ns: ["common", "nav", "settings", "login", "pm2", "security", "os"],
```

- [ ] **Step 4: Vérifier le typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: aucune erreur.

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/locales/fr/os.json apps/web/public/locales/en/os.json apps/web/public/locales/ta/os.json apps/web/src/routes/OsSystem.tsx apps/web/src/lib/i18n.ts
git commit -m "feat(web): traduire l'écran OsSystem via i18next"
```

---

## Task 4: Traduire `NetworkSecurity.tsx`

**Files:**
- Create: `apps/web/public/locales/fr/network.json`
- Create: `apps/web/public/locales/en/network.json`
- Create: `apps/web/public/locales/ta/network.json`
- Modify: `apps/web/src/routes/NetworkSecurity.tsx`
- Modify: `apps/web/src/lib/i18n.ts`

**Interfaces:**
- Consumes: `useTranslation` de `react-i18next`.
- Produces: rien de consommé par d'autres tâches.

État actuel : `apps/web/src/routes/NetworkSecurity.tsx` (432 lignes, 3 composants : `OpenPortsSection`, `AnalyticsSection`, `BlockedIpsSection`). C'est l'écran le plus dense de ce lot en texte de confirmation/description (dialogues avec explications de sécurité longues).

- [ ] **Step 1: Créer les fichiers `network.json`**

`apps/web/public/locales/fr/network.json`:
```json
{
  "ports": {
    "title": "Ports ouverts",
    "loading": "Chargement…",
    "empty": "Aucun port ouvert détecté.",
    "blocked": "bloqué",
    "protected": "protégé",
    "protectedNote": "Port protégé — ni blocage ni arrêt possibles depuis cet écran.",
    "unblock": "Débloquer",
    "block": "Bloquer",
    "blockConfirmTitle": "Bloquer le port {{port}}/{{protocol}} ?",
    "blockConfirmDescription": "Ferme l'accès à ce port depuis l'extérieur via le pare-feu (ufw deny). Le processus continue de tourner — seule sa joignabilité réseau change. Réversible.",
    "stop": "Arrêter",
    "stopConfirmTitle": "Arrêter le processus « {{process}} » (PID {{pid}}) ?",
    "stopConfirmDescription": "Envoie un signal d'arrêt (SIGTERM) au processus qui écoute sur ce port. Contrairement à « Bloquer », le processus lui-même s'arrête — tout ce qu'il servait devient indisponible, pas seulement injoignable depuis l'extérieur. Action irréversible (il faudra le relancer manuellement).",
    "containerNote": "Conteneur — utilisez Docker pour l'arrêter."
  },
  "analytics": {
    "title": "Trafic par site",
    "empty": "Aucun site.",
    "uniqueVisitors": "Visiteurs uniques",
    "totalRequests": "Requêtes totales",
    "topPages": "Pages les plus visitées",
    "days": "{{count}}j"
  },
  "blockedIps": {
    "title": "IPs bloquées",
    "empty": "Aucune IP bloquée.",
    "unblock": "Débloquer",
    "unblockConfirmTitle": "Débloquer {{ip}} ?",
    "formTitle": "Bloquer une IP",
    "ipPlaceholder": "192.168.1.10",
    "jailPlaceholder": "jail (optionnel)",
    "invalidIp": "Adresse IP invalide",
    "block": "Bloquer"
  }
}
```

`apps/web/public/locales/en/network.json`:
```json
{
  "ports": {
    "title": "Open ports",
    "loading": "Loading…",
    "empty": "No open port detected.",
    "blocked": "blocked",
    "protected": "protected",
    "protectedNote": "Protected port — neither blocking nor stopping is possible from this screen.",
    "unblock": "Unblock",
    "block": "Block",
    "blockConfirmTitle": "Block port {{port}}/{{protocol}}?",
    "blockConfirmDescription": "Closes access to this port from the outside via the firewall (ufw deny). The process keeps running — only its network reachability changes. Reversible.",
    "stop": "Stop",
    "stopConfirmTitle": "Stop process \"{{process}}\" (PID {{pid}})?",
    "stopConfirmDescription": "Sends a stop signal (SIGTERM) to the process listening on this port. Unlike \"Block\", the process itself stops — whatever it was serving becomes unavailable, not just unreachable from the outside. Irreversible action (it will need to be restarted manually).",
    "containerNote": "Container — use Docker to stop it."
  },
  "analytics": {
    "title": "Traffic by site",
    "empty": "No site.",
    "uniqueVisitors": "Unique visitors",
    "totalRequests": "Total requests",
    "topPages": "Most visited pages",
    "days": "{{count}}d"
  },
  "blockedIps": {
    "title": "Blocked IPs",
    "empty": "No blocked IP.",
    "unblock": "Unblock",
    "unblockConfirmTitle": "Unblock {{ip}}?",
    "formTitle": "Block an IP",
    "ipPlaceholder": "192.168.1.10",
    "jailPlaceholder": "jail (optional)",
    "invalidIp": "Invalid IP address",
    "block": "Block"
  }
}
```

`apps/web/public/locales/ta/network.json`:
```json
{
  "ports": {
    "title": "திறந்த போர்ட்கள்",
    "loading": "ஏற்றுகிறது…",
    "empty": "திறந்த போர்ட் எதுவும் கண்டறியப்படவில்லை.",
    "blocked": "தடுக்கப்பட்டது",
    "protected": "பாதுகாக்கப்பட்டது",
    "protectedNote": "பாதுகாக்கப்பட்ட போர்ட் — இந்த திரையிலிருந்து தடுக்கவோ நிறுத்தவோ முடியாது.",
    "unblock": "தடையை நீக்கு",
    "block": "தடு",
    "blockConfirmTitle": "போர்ட் {{port}}/{{protocol}} ஐ தடுக்கவா?",
    "blockConfirmDescription": "தீவைரவு (ufw deny) மூலம் வெளியிலிருந்து இந்த போர்ட்டிற்கான அணுகலை மூடுகிறது. செயல்முறை இயங்கிக்கொண்டே இருக்கும் — அதன் நெட்வொர்க் அணுகல் மட்டும் மாறும். மீட்டமைக்கக்கூடியது.",
    "stop": "நிறுத்து",
    "stopConfirmTitle": "செயல்முறை « {{process}} » (PID {{pid}}) ஐ நிறுத்தவா?",
    "stopConfirmDescription": "இந்த போர்ட்டில் கேட்கும் செயல்முறைக்கு நிறுத்த சமிக்ஞையை (SIGTERM) அனுப்புகிறது. « தடு »விலிருந்து வேறுபட்டு, செயல்முறையே நிறுத்தப்படும் — அது வழங்கிய அனைத்தும் கிடைக்காமல் போகும், வெளியிலிருந்து அணுக முடியாததோடு நிற்காமல். மீளமுடியாத செயல் (கைமுறையாக மீண்டும் தொடங்க வேண்டும்).",
    "containerNote": "கொள்கலன் — நிறுத்த Docker ஐப் பயன்படுத்தவும்."
  },
  "analytics": {
    "title": "தளத்தின்படி போக்குவரத்து",
    "empty": "தளம் இல்லை.",
    "uniqueVisitors": "தனித்துவமான பார்வையாளர்கள்",
    "totalRequests": "மொத்த கோரிக்கைகள்",
    "topPages": "அதிகம் பார்வையிடப்பட்ட பக்கங்கள்",
    "days": "{{count}} நாட்கள்"
  },
  "blockedIps": {
    "title": "தடுக்கப்பட்ட IP கள்",
    "empty": "தடுக்கப்பட்ட IP இல்லை.",
    "unblock": "தடையை நீக்கு",
    "unblockConfirmTitle": "{{ip}} தடையை நீக்கவா?",
    "formTitle": "ஒரு IP ஐ தடு",
    "ipPlaceholder": "192.168.1.10",
    "jailPlaceholder": "jail (விருப்பத்தேர்வு)",
    "invalidIp": "தவறான IP முகவரி",
    "block": "தடு"
  }
}
```

- [ ] **Step 2: Traduire `NetworkSecurity.tsx`**

Remplacer le contenu complet de `apps/web/src/routes/NetworkSecurity.tsx` par :
```tsx
import { useEffect, useState } from "react";
import type {
  ListeningPort,
  TopPageEntry,
  VisitorStats,
  BlockedIpEntry,
  VhostSummary,
  HardwareOverview,
} from "@pwa-admin/shared";
import { useTranslation } from "react-i18next";
import { apiJson } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ShieldBan, Network as NetworkIcon, Ban, Square, Loader2 } from "lucide-react";

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+:[0-9a-fA-F:]*$/;

function isValidIp(ip: string): boolean {
  if (IPV4_RE.test(ip)) return ip.split(".").every((part) => Number(part) <= 255);
  return IPV6_RE.test(ip) && ip.includes(":");
}

// Same protected-name set as NetworkService.PROTECTED_PROCESS_NAMES
// (apps/api/src/modules/network/network.service.ts) — mirrored here purely
// as a client-side UX safety net (disable the button before the admin
// clicks through a confirm dialog just to be refused), NOT the actual
// security boundary — the backend re-checks all of this independently and
// is what actually matters if this list ever drifts out of sync.
const PROTECTED_PROCESS_NAMES = new Set(["node", "sshd", "systemd", "systemd-resolve", "systemd-network"]);

export function NetworkSecurity() {
  return (
    <div className="flex flex-col gap-4">
      <OpenPortsSection />
      <AnalyticsSection />
      <BlockedIpsSection />
    </div>
  );
}

function OpenPortsSection() {
  const { t } = useTranslation("network");
  const [ports, setPorts] = useState<ListeningPort[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [blockedKeys, setBlockedKeys] = useState<Set<string>>(new Set());
  const [sshPort, setSshPort] = useState<number | null>(null);

  function load() {
    apiJson<ListeningPort[]>("/network/ports")
      .then(setPorts)
      .catch((err) => setError((err as Error).message));
  }

  useEffect(() => {
    load();
    apiJson<HardwareOverview>("/hardware/overview")
      .then((o) => setSshPort(o.ssh.port))
      .catch(() => setSshPort(null));
  }, []);

  const portKey = (p: ListeningPort) => `${p.protocol}/${p.port}`;

  const ownPort = Number(window.location.port) || 443;

  function isProtectedRow(p: ListeningPort): boolean {
    return p.port === ownPort || p.port === sshPort || (!!p.processName && PROTECTED_PROCESS_NAMES.has(p.processName));
  }

  async function blockPort(p: ListeningPort) {
    const key = portKey(p);
    setBusyKey(key);
    setRowError(null);
    try {
      await apiJson("/network/ports/block", {
        method: "POST",
        body: JSON.stringify({ port: p.port, protocol: p.protocol }),
      });
      setBlockedKeys((prev) => new Set(prev).add(key));
    } catch (err) {
      setRowError((err as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  async function unblockPort(p: ListeningPort) {
    const key = portKey(p);
    setBusyKey(key);
    setRowError(null);
    try {
      await apiJson("/network/ports/unblock", {
        method: "POST",
        body: JSON.stringify({ port: p.port, protocol: p.protocol }),
      });
      setBlockedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    } catch (err) {
      setRowError((err as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  async function killPort(p: ListeningPort) {
    if (p.pid == null) return;
    const key = `kill:${portKey(p)}`;
    setBusyKey(key);
    setRowError(null);
    try {
      await apiJson("/network/ports/kill", {
        method: "POST",
        body: JSON.stringify({ port: p.port, pid: p.pid }),
      });
      load();
    } catch (err) {
      setRowError((err as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Card>
      <CardTitle className="flex items-center gap-1">
        <NetworkIcon className="h-4 w-4" /> {t("ports.title")}
      </CardTitle>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {rowError && <p className="text-sm text-destructive">{rowError}</p>}
      {!ports && !error && <p className="text-sm text-muted-foreground">{t("ports.loading")}</p>}
      {ports && ports.length === 0 && <p className="text-sm text-muted-foreground">{t("ports.empty")}</p>}
      {ports && ports.length > 0 && (
        <div className="flex flex-col gap-1">
          {ports.map((p, i) => {
            const key = portKey(p);
            const isBlocked = blockedKeys.has(key);
            const protectedRow = isProtectedRow(p);
            return (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 py-1.5 text-xs last:border-0"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono">
                    {p.protocol}/{p.localAddress}:{p.port}
                  </span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    {p.processName ?? "—"}
                    {p.ownedByContainer && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">
                        {p.ownedByContainer}
                      </span>
                    )}
                    {isBlocked && (
                      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">
                        {t("ports.blocked")}
                      </span>
                    )}
                    {protectedRow && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {t("ports.protected")}
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {protectedRow ? (
                    <span className="text-[10px] text-muted-foreground">{t("ports.protectedNote")}</span>
                  ) : (
                    <>
                      {isBlocked ? (
                        <Button size="sm" variant="outline" disabled={busyKey === key} onClick={() => unblockPort(p)}>
                          {busyKey === key ? <Loader2 className="h-3 w-3 animate-spin" /> : t("ports.unblock")}
                        </Button>
                      ) : (
                        <ConfirmDialog
                          trigger={
                            <Button size="sm" variant="outline" disabled={busyKey === key}>
                              {busyKey === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                              {t("ports.block")}
                            </Button>
                          }
                          title={t("ports.blockConfirmTitle", { port: p.port, protocol: p.protocol })}
                          description={t("ports.blockConfirmDescription")}
                          confirmLabel={t("ports.block")}
                          onConfirm={() => blockPort(p)}
                        />
                      )}
                      {p.pid != null && !p.ownedByContainer && (
                        <ConfirmDialog
                          trigger={
                            <Button size="sm" variant="destructive" disabled={busyKey === `kill:${key}`}>
                              {busyKey === `kill:${key}` ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Square className="h-3 w-3" />
                              )}
                              {t("ports.stop")}
                            </Button>
                          }
                          title={t("ports.stopConfirmTitle", { process: p.processName ?? "?", pid: p.pid })}
                          description={t("ports.stopConfirmDescription")}
                          requireTypedConfirmation="STOP"
                          confirmLabel={t("ports.stop")}
                          onConfirm={() => killPort(p)}
                        />
                      )}
                      {p.pid != null && p.ownedByContainer && (
                        <span className="text-[10px] text-muted-foreground">{t("ports.containerNote")}</span>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function AnalyticsSection() {
  const { t } = useTranslation("network");
  const [sites, setSites] = useState<VhostSummary[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [windowDays, setWindowDays] = useState(7);
  const [topPages, setTopPages] = useState<TopPageEntry[] | null>(null);
  const [visitors, setVisitors] = useState<VisitorStats | null>(null);

  useEffect(() => {
    apiJson<VhostSummary[]>("/nginx/vhosts")
      .then((v) => {
        setSites(v);
        if (v.length > 0) setSelected(v[0].name);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) return;
    apiJson<TopPageEntry[]>(`/analytics/sites/${selected}/top-pages?window=${windowDays}`)
      .then(setTopPages)
      .catch(() => setTopPages(null));
    apiJson<VisitorStats>(`/analytics/sites/${selected}/visitors?window=${windowDays}`)
      .then(setVisitors)
      .catch(() => setVisitors(null));
  }, [selected, windowDays]);

  return (
    <Card>
      <CardTitle>{t("analytics.title")}</CardTitle>
      {sites && sites.length > 0 ? (
        <>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          >
            {sites.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>

          <div className="mb-3 flex gap-1">
            {[1, 7, 30].map((w) => (
              <button
                key={w}
                onClick={() => setWindowDays(w)}
                className={
                  "rounded-md px-2 py-1 text-xs font-medium " +
                  (windowDays === w ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")
                }
              >
                {t("analytics.days", { count: w })}
              </button>
            ))}
          </div>

          {visitors && (
            <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">{t("analytics.uniqueVisitors")}</p>
                <p className="font-medium">{visitors.uniqueIps}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("analytics.totalRequests")}</p>
                <p className="font-medium">{visitors.totalRequests}</p>
              </div>
            </div>
          )}

          {topPages && topPages.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{t("analytics.topPages")}</p>
              <div className="flex flex-col gap-1">
                {topPages.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="truncate font-mono">{p.path}</span>
                    <span className="shrink-0 text-muted-foreground">{p.hits}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("analytics.empty")}</p>
      )}
    </Card>
  );
}

function BlockedIpsSection() {
  const { t } = useTranslation("network");
  const [blocked, setBlocked] = useState<BlockedIpEntry[] | null>(null);
  const [newIp, setNewIp] = useState("");
  const [newJail, setNewJail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      setBlocked(await apiJson<BlockedIpEntry[]>("/security/blocked-ips"));
    } catch {
      setBlocked([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function unban(ip: string) {
    await apiJson(`/security/blocked-ips/${ip}`, { method: "DELETE" });
    await load();
  }

  async function ban(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!isValidIp(newIp.trim())) {
      setFormError(t("blockedIps.invalidIp"));
      return;
    }
    setSubmitting(true);
    try {
      await apiJson("/security/blocked-ips", {
        method: "POST",
        body: JSON.stringify({ ip: newIp.trim(), jail: newJail.trim() || undefined }),
      });
      setNewIp("");
      setNewJail("");
      await load();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardTitle className="flex items-center gap-1">
        <ShieldBan className="h-4 w-4" /> {t("blockedIps.title")}
      </CardTitle>

      {blocked && blocked.length > 0 ? (
        <div className="mb-3 flex flex-col gap-1">
          {blocked.map((b) => (
            <div key={b.ip} className="flex items-center justify-between border-b border-border/50 py-1 text-xs last:border-0">
              <span className="font-mono">{b.ip}</span>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{b.jail}</span>
                <ConfirmDialog
                  trigger={
                    <Button size="sm" variant="outline">
                      {t("blockedIps.unblock")}
                    </Button>
                  }
                  title={t("blockedIps.unblockConfirmTitle", { ip: b.ip })}
                  confirmLabel={t("blockedIps.unblock")}
                  onConfirm={() => unban(b.ip)}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-3 text-sm text-muted-foreground">{t("blockedIps.empty")}</p>
      )}

      <form onSubmit={ban} className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">{t("blockedIps.formTitle")}</p>
        <input
          type="text"
          placeholder={t("blockedIps.ipPlaceholder")}
          value={newIp}
          onChange={(e) => setNewIp(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        <input
          type="text"
          placeholder={t("blockedIps.jailPlaceholder")}
          value={newJail}
          onChange={(e) => setNewJail(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        {formError && <p className="text-xs text-destructive">{formError}</p>}
        <Button type="submit" size="sm" variant="destructive" disabled={submitting}>
          {t("blockedIps.block")}
        </Button>
      </form>
    </Card>
  );
}
```

- [ ] **Step 3: Ajouter le namespace `network` à `lib/i18n.ts`**

Modifier `apps/web/src/lib/i18n.ts` — état après Task 3 : `ns: ["common", "nav", "settings", "login", "pm2", "security", "os"]`, remplacer par :
```ts
    ns: ["common", "nav", "settings", "login", "pm2", "security", "os", "network"],
```

- [ ] **Step 4: Vérifier le typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: aucune erreur.

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/locales/fr/network.json apps/web/public/locales/en/network.json apps/web/public/locales/ta/network.json apps/web/src/routes/NetworkSecurity.tsx apps/web/src/lib/i18n.ts
git commit -m "feat(web): traduire l'écran NetworkSecurity via i18next"
```

---

## Task 5: Build de production et vérification finale

**Files:**
- Aucun fichier modifié — vérification uniquement.

**Interfaces:**
- Consumes: tous les namespaces créés dans ce plan.

- [ ] **Step 1: Build complet**

Run (depuis la racine du repo) :
```bash
npm run build --workspace=packages/shared
npm run build:api
npm run build:web
```
Expected : les 3 builds réussissent sans erreur. Vérifier que `apps/web/dist/locales/{fr,en,ta}/{pm2,security,os,network}.json` existent (12 nouveaux fichiers, en plus des 12 déjà présents de la Phase 1).

- [ ] **Step 2: Test manuel de régression**

Run: `npm run dev:web`, se connecter, naviguer successivement sur `/pm2`, `/security`, `/os`, `/network` en français (comportement par défaut inchangé), puis basculer en anglais et tamoul depuis Settings et revérifier chaque écran — aucune clé de traduction brute visible (`pm2:title` au lieu de "Processus Node.js"), aucun texte non traduit inattendu dans les zones de titres/labels/boutons (les données techniques — noms de paquets, IPs, ports — restent non traduites, c'est attendu).

- [ ] **Step 3: Commit final si des ajustements ont été faits pendant le test manuel**

Si le test manuel ne révèle aucun problème, aucun commit supplémentaire n'est nécessaire pour cette tâche.

---

## Fin de ce plan

Lot 1 des écrans "management" traduit : Pm2, Security, OsSystem, NetworkSecurity. Restent dans le lot "management" : Sites, Docker, Nginx (plus gros, chacun dans un plan séparé). Puis les lots "ops" et "bottom" du spec.
