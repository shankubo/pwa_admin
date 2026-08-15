import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  SiteSummary,
  VolumeSummary,
  DetectedDatabase,
  DetectedBindMount,
  BackupSourceType,
  BackupTarget,
  BackupHistoryEntry,
} from "@pwa-admin/shared";
import { apiJson } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { WizardShell } from "@/components/wizard/WizardShell";
import { ActionTile } from "@/components/wizard/ActionTile";
import { pollBackupRun } from "@/lib/pollBackupRun";
import { Globe, Boxes, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react";

type WizardStage = "source" | "destination" | "confirmation" | "execution" | "result";
type SourceMode = "site" | "generic" | null;

interface GenericSource {
  sourceType: BackupSourceType;
  sourceRef: string;
  label: string;
}

export function BackupWizardFlow({ onExit }: { onExit: () => void }) {
  const navigate = useNavigate();
  const [stage, setStage] = useState<WizardStage>("source");
  const [sourceMode, setSourceMode] = useState<SourceMode>(null);

  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  const [selectedSite, setSelectedSite] = useState<SiteSummary | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const [genericType, setGenericType] = useState<BackupSourceType>("volume");
  const [volumes, setVolumes] = useState<VolumeSummary[] | null>(null);
  const [detectedDbs, setDetectedDbs] = useState<DetectedDatabase[] | null>(null);
  const [bindMounts, setBindMounts] = useState<DetectedBindMount[] | null>(null);
  const [genericSource, setGenericSource] = useState<GenericSource | null>(null);

  const [targets, setTargets] = useState<BackupTarget[]>(["local"]);
  const [gdriveAuthorized, setGdriveAuthorized] = useState(false);
  const [usbAvailable, setUsbAvailable] = useState(false);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BackupHistoryEntry | null>(null);

  useEffect(() => {
    apiJson<{ authorized: boolean }>("/backups/gdrive/status")
      .then((s) => setGdriveAuthorized(s.authorized))
      .catch(() => setGdriveAuthorized(false));
    apiJson<{ drives: { isBackupConfigured: boolean }[] }>("/backups/usb/status")
      .then((s) => setUsbAvailable(s.drives.some((d) => d.isBackupConfigured)))
      .catch(() => setUsbAvailable(false));
  }, []);

  useEffect(() => {
    if (sourceMode !== "site" || sites) return;
    apiJson<SiteSummary[]>("/sites").then(setSites).catch(() => setSites([]));
  }, [sourceMode, sites]);

  useEffect(() => {
    if (sourceMode !== "generic") return;
    if (genericType === "volume" && !volumes) {
      apiJson<VolumeSummary[]>("/docker/volumes").then(setVolumes).catch(() => setVolumes([]));
    } else if (genericType === "db" && !detectedDbs) {
      apiJson<DetectedDatabase[]>("/dbbackup/detect").then(setDetectedDbs).catch(() => setDetectedDbs([]));
    } else if (genericType === "path" && !bindMounts) {
      apiJson<DetectedBindMount[]>("/backups/bind-mounts").then(setBindMounts).catch(() => setBindMounts([]));
    }
  }, [sourceMode, genericType, volumes, detectedDbs, bindMounts]);

  function toggleTarget(t: BackupTarget) {
    setTargets((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function sourceSummary(): { label: string; sourceType: BackupSourceType; sourceRef: string } | null {
    if (sourceMode === "site" && selectedSite) {
      if (selectedSite.linkedContainer) {
        return { label: `Site : ${selectedSite.name}`, sourceType: "volume", sourceRef: selectedSite.name };
      }
      if (selectedSite.root) {
        return { label: `Site : ${selectedSite.name}`, sourceType: "path", sourceRef: selectedSite.root };
      }
      return null;
    }
    if (sourceMode === "generic" && genericSource) {
      return { label: genericSource.label, sourceType: genericSource.sourceType, sourceRef: genericSource.sourceRef };
    }
    return null;
  }

  async function launch() {
    const summary = sourceSummary();
    if (!summary) return;
    setRunning(true);
    setError(null);
    setStage("execution");
    try {
      const job = await apiJson<{ id: number }>("/backups/jobs", {
        method: "POST",
        body: JSON.stringify({
          name: `Assistant — ${summary.label}`,
          sourceType: summary.sourceType,
          sourceRef: summary.sourceRef,
          targets,
        }),
      });
      const { runId } = await apiJson<{ runId: string }>(`/backups/jobs/${job.id}/run`, { method: "POST" });
      const entry = await pollBackupRun(runId, false);
      setResult(entry);
      setStage("result");
    } catch (err) {
      setError((err as Error).message);
      setStage("result");
    } finally {
      setRunning(false);
    }
  }

  if (stage === "source") {
    if (!sourceMode) {
      return (
        <WizardShell title="Sauvegarde" stepLabel="Étape 2 — Que voulez-vous sauvegarder ?" onBack={onExit}>
          <div className="grid grid-cols-2 gap-3">
            <ActionTile
              icon={Globe}
              label="Un site"
              description="Choisir un site Nginx/Apache existant."
              enabled
              onClick={() => setSourceMode("site")}
            />
            <ActionTile
              icon={Boxes}
              label="Volume / dossier / base de données"
              description="Choisir directement une source technique."
              enabled
              onClick={() => setSourceMode("generic")}
            />
          </div>
        </WizardShell>
      );
    }

    if (sourceMode === "site") {
      const activeSites = (sites ?? []).filter((s) => s.enabled);
      const inactiveSites = (sites ?? []).filter((s) => !s.enabled);
      return (
        <WizardShell title="Sauvegarde" stepLabel="Étape 2 — Choisissez un site" onBack={() => setSourceMode(null)}>
          {sites === null && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {sites !== null && sites.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun site trouvé.</p>
          )}
          <div className="flex flex-col gap-1">
            {activeSites.map((s) => (
              <SiteRow key={s.name} site={s} onClick={() => { setSelectedSite(s); setStage("destination"); }} />
            ))}
          </div>
          {inactiveSites.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowInactive((v) => !v)}
                className="flex items-center gap-1 text-sm text-muted-foreground"
              >
                {showInactive ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                Sites désactivés ({inactiveSites.length})
              </button>
              {showInactive && (
                <div className="mt-1 flex flex-col gap-1">
                  {inactiveSites.map((s) => (
                    <SiteRow key={s.name} site={s} onClick={() => { setSelectedSite(s); setStage("destination"); }} />
                  ))}
                </div>
              )}
            </div>
          )}
        </WizardShell>
      );
    }

    // generic
    const refOptions =
      genericType === "volume"
        ? (volumes ?? []).map((v) => ({ value: v.name, label: v.name }))
        : genericType === "db"
          ? (detectedDbs ?? []).map((d) => ({ value: `${d.location}:${d.ref}`, label: `${d.displayName} (${d.engine})` }))
          : (bindMounts ?? []).map((m) => ({ value: m.hostPath, label: `${m.hostPath} (${m.containerName})` }));

    return (
      <WizardShell title="Sauvegarde" stepLabel="Étape 2 — Choisissez une source" onBack={() => setSourceMode(null)}>
        <select
          value={genericType}
          onChange={(e) => setGenericType(e.target.value as BackupSourceType)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
        >
          <option value="volume">Volume Docker</option>
          <option value="path">Dossier (bind mount)</option>
          <option value="db">Base de données</option>
        </select>
        <select
          value={genericSource?.sourceRef ?? ""}
          onChange={(e) => {
            const opt = refOptions.find((o) => o.value === e.target.value);
            if (opt) {
              setGenericSource({ sourceType: genericType, sourceRef: opt.value, label: opt.label });
              setStage("destination");
            }
          }}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
        >
          <option value="">Sélectionner…</option>
          {refOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </WizardShell>
    );
  }

  if (stage === "destination") {
    return (
      <WizardShell title="Sauvegarde" stepLabel="Étape 3 — Destination" onBack={() => setStage("source")}>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={targets.includes("local")} onChange={() => toggleTarget("local")} />
            Local
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={targets.includes("gdrive")}
              onChange={() => toggleTarget("gdrive")}
              disabled={!gdriveAuthorized}
            />
            Google Drive
            {!gdriveAuthorized && <span className="text-xs text-muted-foreground">(non connecté)</span>}
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={targets.includes("usb")}
              onChange={() => toggleTarget("usb")}
              disabled={!usbAvailable}
            />
            USB
            {!usbAvailable && <span className="text-xs text-muted-foreground">(non configuré)</span>}
          </label>
        </div>
        <Button size="sm" disabled={targets.length === 0} onClick={() => setStage("confirmation")}>
          Suivant
        </Button>
      </WizardShell>
    );
  }

  if (stage === "confirmation") {
    const summary = sourceSummary();
    return (
      <WizardShell title="Sauvegarde" stepLabel="Étape 4 — Confirmation" onBack={() => setStage("destination")}>
        <Card className="flex flex-col gap-1 text-sm">
          <p><span className="text-muted-foreground">Source : </span>{summary?.label ?? "—"}</p>
          <p><span className="text-muted-foreground">Destinations : </span>{targets.join(", ")}</p>
        </Card>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={launch}>Lancer la sauvegarde</Button>
      </WizardShell>
    );
  }

  if (stage === "execution") {
    return (
      <WizardShell title="Sauvegarde" stepLabel="Étape 5 — Exécution">
        <Card className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Sauvegarde en cours…
        </Card>
      </WizardShell>
    );
  }

  // result
  return (
    <WizardShell title="Sauvegarde" stepLabel="Étape 6 — Résultat">
      {error && (
        <Card className="flex items-center gap-2 text-sm text-destructive">
          <XCircle className="h-4 w-4" /> {error}
        </Card>
      )}
      {!error && result && (
        <Card className="flex items-center gap-2 text-sm">
          {result.status === "success" ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-primary" /> Sauvegarde terminée avec succès.
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 text-destructive" /> Échec de la sauvegarde{result.error ? ` : ${result.error}` : ""}.
            </>
          )}
        </Card>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => navigate("/backups")}>
          Voir dans Backups
        </Button>
        <Button variant="ghost" onClick={onExit}>
          Nouvelle opération
        </Button>
      </div>
    </WizardShell>
  );
}

function SiteRow({ site, onClick }: { site: SiteSummary; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left text-sm hover:border-primary hover:bg-primary/5"
    >
      <span>{site.name}</span>
      <span className="text-xs text-muted-foreground">{site.serverNames.join(", ")}</span>
    </button>
  );
}
