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
import { useTranslation } from "react-i18next";
import { apiJson } from "@/lib/api";
import { Card } from "@/components/ui/Card";
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
  const { t } = useTranslation("wizard");
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

  function toggleTarget(tgt: BackupTarget) {
    setTargets((prev) => (prev.includes(tgt) ? prev.filter((x) => x !== tgt) : [...prev, tgt]));
  }

  function sourceSummary(): { label: string; sourceType: BackupSourceType; sourceRef: string } | null {
    if (sourceMode === "site" && selectedSite) {
      if (selectedSite.linkedContainer) {
        return {
          label: t("backupFlow.siteSourceLabel", { name: selectedSite.name }),
          sourceType: "volume",
          sourceRef: selectedSite.name,
        };
      }
      if (selectedSite.root) {
        return {
          label: t("backupFlow.siteSourceLabel", { name: selectedSite.name }),
          sourceType: "path",
          sourceRef: selectedSite.root,
        };
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
        <WizardShell title={t("actions.backup.label")} stepLabel={t("backupFlow.step1Title")} onBack={onExit}>
          <div className="grid grid-cols-2 gap-3">
            <ActionTile
              icon={Globe}
              label={t("backupFlow.siteSource.label")}
              description={t("backupFlow.siteSource.description")}
              enabled
              onClick={() => setSourceMode("site")}
            />
            <ActionTile
              icon={Boxes}
              label={t("backupFlow.genericSource.label")}
              description={t("backupFlow.genericSource.description")}
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
        <WizardShell title={t("actions.backup.label")} stepLabel={t("backupFlow.step2SiteTitle")} onBack={() => setSourceMode(null)}>
          {sites === null && <p className="text-sm text-muted-foreground">{t("backupFlow.loading")}</p>}
          {sites !== null && sites.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("backupFlow.noSiteFound")}</p>
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
                {t("backupFlow.disabledSites", { count: inactiveSites.length })}
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
      <WizardShell title={t("actions.backup.label")} stepLabel={t("backupFlow.step2GenericTitle")} onBack={() => setSourceMode(null)}>
        <select
          value={genericType}
          onChange={(e) => setGenericType(e.target.value as BackupSourceType)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
        >
          <option value="volume">{t("backupFlow.sourceTypeVolume")}</option>
          <option value="path">{t("backupFlow.sourceTypePath")}</option>
          <option value="db">{t("backupFlow.sourceTypeDb")}</option>
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
          <option value="">{t("backupFlow.selectPrompt")}</option>
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
      <WizardShell title={t("actions.backup.label")} stepLabel={t("backupFlow.step3Title")} onBack={() => setStage("source")}>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={targets.includes("local")} onChange={() => toggleTarget("local")} />
            {t("backupFlow.targetLocal")}
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={targets.includes("gdrive")}
              onChange={() => toggleTarget("gdrive")}
              disabled={!gdriveAuthorized}
            />
            {t("backupFlow.targetGdrive")}
            {!gdriveAuthorized && <span className="text-xs text-muted-foreground">{t("backupFlow.targetGdriveNotConnected")}</span>}
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={targets.includes("usb")}
              onChange={() => toggleTarget("usb")}
              disabled={!usbAvailable}
            />
            {t("backupFlow.targetUsb")}
            {!usbAvailable && <span className="text-xs text-muted-foreground">{t("backupFlow.targetUsbNotConfigured")}</span>}
          </label>
        </div>
        <Button size="sm" disabled={targets.length === 0} onClick={() => setStage("confirmation")}>
          {t("backupFlow.next")}
        </Button>
      </WizardShell>
    );
  }

  if (stage === "confirmation") {
    const summary = sourceSummary();
    return (
      <WizardShell title={t("actions.backup.label")} stepLabel={t("backupFlow.step4Title")} onBack={() => setStage("destination")}>
        <Card className="flex flex-col gap-1 text-sm">
          <p><span className="text-muted-foreground">{t("backupFlow.sourceLabel")}</span>{summary?.label ?? "—"}</p>
          <p><span className="text-muted-foreground">{t("backupFlow.destinationsLabel")}</span>{targets.join(", ")}</p>
        </Card>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={launch}>{t("backupFlow.launch")}</Button>
      </WizardShell>
    );
  }

  if (stage === "execution") {
    return (
      <WizardShell title={t("actions.backup.label")} stepLabel={t("backupFlow.step5Title")}>
        <Card className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("backupFlow.running")}
        </Card>
      </WizardShell>
    );
  }

  // result
  return (
    <WizardShell title={t("actions.backup.label")} stepLabel={t("backupFlow.step6Title")}>
      {error && (
        <Card className="flex items-center gap-2 text-sm text-destructive">
          <XCircle className="h-4 w-4" /> {error}
        </Card>
      )}
      {!error && result && (
        <Card className="flex items-center gap-2 text-sm">
          {result.status === "success" ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-primary" /> {t("backupFlow.success")}
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 text-destructive" />{" "}
              {t("backupFlow.failed", {
                suffix: result.error ? t("backupFlow.failedSuffix", { error: result.error }) : "",
              })}
            </>
          )}
        </Card>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => navigate("/backups")}>
          {t("backupFlow.viewInBackups")}
        </Button>
        <Button variant="ghost" onClick={onExit}>
          {t("backupFlow.newOperation")}
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
