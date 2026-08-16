import { useEffect, useMemo, useState } from "react";
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
            {t("cronPicker.formatHelp")} <code className="rounded bg-muted px-1">0 3 * * *</code>
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

function NewAppForm({
  onCreated,
  prefillContainer,
}: {
  onCreated: () => void;
  prefillContainer?: string | null;
}) {
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
      .catch(() => setError("Impossible de charger la liste des conteneurs"));
    apiJson<DetectedBindMount[]>("/backups/bind-mounts")
      .then(setBindMounts)
      .catch(() => setError("Impossible de charger la liste des dossiers montés"));
    apiJson<DetectedVolumeMount[]>("/backups/volume-mounts")
      .then(setVolumeMounts)
      .catch(() => setError("Impossible de charger la liste des volumes Docker"));
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

  function toggleTarget(t: BackupTarget) {
    setTargets((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
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
      setError("Nom, au moins une cible, et au moins un chemin, volume ou une base de données sont requis");
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
        setError(
          "Un ou plusieurs chemins sélectionnés ne correspondent plus à un dossier monté détecté. Rafraîchissez la liste et réessayez."
        );
      } else if (message === "application_name_already_exists") {
        setError("Une application avec ce nom existe déjà. Choisissez un autre nom ou modifiez l'application existante.");
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
          placeholder="Nom de l'application"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Conteneurs</p>
          <div className="flex flex-col gap-1 rounded-md border border-border p-2">
            {!containers && <p className="text-xs text-muted-foreground">Chargement…</p>}
            {containers?.length === 0 && <p className="text-xs text-muted-foreground">Aucun conteneur détecté.</p>}
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
            Chemins (dossiers montés)
            {selectedContainers.length > 0 ? " · filtrés par conteneur(s) sélectionné(s)" : ""}
          </p>
          <div className="flex flex-col gap-1 rounded-md border border-border p-2">
            {!bindMounts && <p className="text-xs text-muted-foreground">Chargement…</p>}
            {bindMounts && visibleMounts.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Aucun dossier monté détecté pour cette sélection (conteneur sans données persistées sur disque — ok
                si un volume Docker ou une base de données est sélectionné ci-dessous).
              </p>
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
            Volumes Docker (nommés)
            {selectedContainers.length > 0 ? " · filtrés par conteneur(s) sélectionné(s)" : ""}
          </p>
          <div className="flex flex-col gap-1 rounded-md border border-border p-2">
            {!volumeMounts && <p className="text-xs text-muted-foreground">Chargement…</p>}
            {volumeMounts && visibleVolumeMounts.length === 0 && (
              <p className="text-xs text-muted-foreground">Aucun volume Docker nommé détecté pour cette sélection.</p>
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
          <p className="mb-1 text-xs font-medium text-muted-foreground">Base de données (optionnel)</p>
          <select
            value={dbValue}
            onChange={(e) => setDbValue(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
          >
            <option value="">Aucune</option>
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
            <HardDrive className="h-3.5 w-3.5" /> local
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={targets.includes("gdrive")}
              onChange={() => toggleTarget("gdrive")}
              disabled={!gdriveAuthorized}
            />
            <Cloud className="h-3.5 w-3.5" /> gdrive
            {!gdriveAuthorized && <span className="text-xs text-muted-foreground">(non connecté)</span>}
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={targets.includes("usb")}
              onChange={() => toggleTarget("usb")}
              disabled={!usbAvailable}
            />
            <Usb className="h-3.5 w-3.5" /> usb
            {!usbAvailable && (
              <span className="text-xs text-muted-foreground">(aucun disque configuré — voir Backups)</span>
            )}
          </label>
        </div>

        <p className="text-xs text-muted-foreground">
          Le backup complet prend un instantané complet ; le backup partiel ne copie que les fichiers modifiés depuis
          le dernier instantané (liens durs pour le reste). Exemple : partiel quotidien, complet hebdomadaire.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CronPicker label="Planification backup complet" value={scheduleFullCron} onChange={setScheduleFullCron} />
          <CronPicker
            label="Planification backup partiel"
            value={schedulePartialCron}
            onChange={setSchedulePartialCron}
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            type="number"
            min={0}
            placeholder="Rétention (jours, optionnel)"
            value={retentionDays}
            onChange={(e) => setRetentionDays(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            type="number"
            min={0}
            placeholder="Copies minimum à conserver (optionnel)"
            value={retentionMinCopies}
            onChange={(e) => setRetentionMinCopies(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Création…" : "Créer"}
        </Button>
      </form>
    </Card>
  );
}
