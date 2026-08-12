import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  BackupJob,
  BackupHistoryEntry,
  BackupRunStatus,
  BackupSourceType,
  BackupTarget,
  DetectedDatabase,
  DetectedBindMount,
  VolumeSummary,
  GDriveComparisonResult,
  UsbStatus,
  UsbBackupArchive,
  MigrationSnapshotRun,
} from "@pwa-admin/shared";
import { apiJson } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatBytes } from "./Docker";
import {
  Play,
  Trash2,
  Database,
  HardDrive,
  Cloud,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Search,
  Loader2,
  Usb,
  Download,
  ArrowRight,
  HardDriveUpload,
} from "lucide-react";

const STATUS_FILTERS: { key: "all" | BackupRunStatus; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "success", label: "Succès" },
  { key: "failed", label: "Échec" },
  { key: "running", label: "En cours" },
];

function historyCardClass(status: BackupRunStatus): string | undefined {
  if (status === "success") return "border-primary/40 bg-primary/5";
  if (status === "failed") return "border-destructive/50 bg-destructive/5";
  return undefined; // pending/running — no verdict yet
}

async function triggerDownload(runId: string) {
  const { token } = await apiJson<{ token: string }>(`/backups/history/${runId}/download-token`, {
    method: "POST",
  });
  window.location.href = `/api/backups/history/${runId}/download?token=${encodeURIComponent(token)}`;
}

/** Polls a run until it leaves running/pending, then optionally triggers a
 * browser download — shared by the generic Backups flow. */
async function pollThenMaybeDownload(runId: string, download: boolean) {
  for (;;) {
    const entry = await apiJson<BackupHistoryEntry>(`/backups/history/${runId}`);
    if (entry.status !== "running") {
      if (download && entry.status === "success") await triggerDownload(runId);
      return entry;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export function Backups() {
  const [jobs, setJobs] = useState<BackupJob[] | null>(null);
  const [history, setHistory] = useState<BackupHistoryEntry[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | BackupRunStatus>("all");
  const [storage, setStorage] = useState<{ localUsedBytes: number } | null>(null);
  const [detected, setDetected] = useState<DetectedDatabase[] | null>(null);
  const [showNewJob, setShowNewJob] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gdriveAuthorized, setGdriveAuthorized] = useState(false);
  const [comparison, setComparison] = useState<GDriveComparisonResult | null>(null);
  const [comparing, setComparing] = useState(false);
  const [usbAvailable, setUsbAvailable] = useState(false);
  const [dumpingRef, setDumpingRef] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);

  async function runComparison() {
    setComparing(true);
    setError(null);
    try {
      setComparison(await apiJson<GDriveComparisonResult>("/backups/gdrive/compare"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setComparing(false);
    }
  }

  const driveStatusByRunId = useMemo(() => {
    const map = new Map<string, GDriveComparisonResult["verifications"][number]["status"]>();
    comparison?.verifications.forEach((v) => map.set(v.runId, v.status));
    return map;
  }, [comparison]);

  async function loadJobs() {
    setJobs(await apiJson<BackupJob[]>("/backups/jobs"));
  }
  async function loadHistory() {
    setHistory(await apiJson<BackupHistoryEntry[]>("/backups/history?limit=100&offset=0"));
  }

  useEffect(() => {
    loadJobs().catch((err) => setError((err as Error).message));
    loadHistory().catch((err) => setError((err as Error).message));
    apiJson<{ localUsedBytes: number }>("/backups/storage")
      .then(setStorage)
      .catch(() => {});
    apiJson<DetectedDatabase[]>("/dbbackup/detect")
      .then(setDetected)
      .catch(() => setDetected([]));
    apiJson<{ authorized: boolean }>("/backups/gdrive/status")
      .then((s) => setGdriveAuthorized(s.authorized))
      .catch(() => setGdriveAuthorized(false));
    apiJson<UsbStatus>("/backups/usb/status")
      .then((s) => setUsbAvailable(s.drives.some((d) => d.isBackupConfigured)))
      .catch(() => setUsbAvailable(false));
  }, []);

  async function runJob(id: number) {
    await apiJson(`/backups/jobs/${id}/run`, { method: "POST" });
    await loadHistory();
  }

  async function deleteJob(id: number) {
    await apiJson(`/backups/jobs/${id}`, { method: "DELETE" });
    await loadJobs();
  }

  async function dumpDb(location: "docker" | "native", ref: string, download: boolean) {
    setDumpingRef(ref);
    setError(null);
    try {
      const targets: BackupTarget[] = ["local"];
      if (gdriveAuthorized) targets.push("gdrive");
      if (usbAvailable) targets.push("usb");
      const { runId } = await apiJson<{ runId: string }>(
        `/dbbackup/${location}/${encodeURIComponent(ref)}/dump`,
        { method: "POST", body: JSON.stringify({ targets }) }
      );
      await loadHistory();
      await pollThenMaybeDownload(runId, download);
      await loadHistory();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDumpingRef(null);
    }
  }

  async function deleteRun(runId: string) {
    setDeletingRunId(runId);
    try {
      await apiJson(`/backups/history/${runId}`, { method: "DELETE" });
      await loadHistory();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingRunId(null);
    }
  }

  const filteredHistory = useMemo(() => {
    if (!history) return [];
    if (statusFilter === "all") return history;
    return history.filter((h) => h.status === statusFilter);
  }, [history, statusFilter]);

  return (
    <div className="flex flex-col gap-4">
      {error && <Card className="text-sm text-destructive">{error}</Card>}

      <Card>
        <CardTitle className="flex items-center gap-1">
          <HardDrive className="h-4 w-4" /> Stockage local
        </CardTitle>
        <p className="text-lg font-medium">{storage ? formatBytes(storage.localUsedBytes) : "…"}</p>
      </Card>

      <GDriveCompareCard
        comparison={comparison}
        comparing={comparing}
        onCompare={runComparison}
        onDeletedFile={runComparison}
      />

      <UsbConnection />

      <MigrationSnapshotCard />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Nouvelle sauvegarde</h2>
          <Button size="sm" variant="outline" onClick={() => setShowNewJob((v) => !v)}>
            {showNewJob ? "Annuler" : "Nouveau job"}
          </Button>
        </div>

        {showNewJob && (
          <NewJobForm
            onCreated={() => {
              setShowNewJob(false);
              loadJobs();
            }}
          />
        )}

        <div className="flex flex-col gap-3">
          {!jobs && <Card className="text-sm text-muted-foreground">Chargement…</Card>}
          {jobs?.length === 0 && <Card className="text-sm text-muted-foreground">Aucun job configuré.</Card>}
          {jobs?.map((job) => (
            <Card key={job.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{job.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.sourceType} · {job.sourceRef}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    cibles : {job.targets.join(", ")}
                    {job.scheduleCron ? ` · cron: ${job.scheduleCron}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="outline" onClick={() => runJob(job.id)}>
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button size="sm" variant="destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    }
                    title={`Supprimer le job ${job.name} ?`}
                    confirmLabel="Supprimer"
                    onConfirm={() => deleteJob(job.id)}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <Card>
        <CardTitle className="flex items-center gap-1">
          <Database className="h-4 w-4" /> Sauvegarde partielle — bases de données détectées
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Un dump de base de données est rapide et se comporte comme une sauvegarde « partielle » — à la
          différence d'un instantané complet de volume/dossier.
        </p>
        {detected && detected.length > 0 ? (
          <div className="mt-2 flex flex-col gap-3">
            {detected.map((d) => (
              <div key={`${d.location}:${d.ref}`} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span>
                    {d.displayName}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({d.engine} · {d.location === "docker" ? "conteneur" : "hôte"})
                    </span>
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={dumpingRef === d.ref}
                      onClick={() => dumpDb(d.location, d.ref, false)}
                    >
                      {dumpingRef === d.ref ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Dump"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={dumpingRef === d.ref}
                      onClick={() => dumpDb(d.location, d.ref, true)}
                      title="Dump puis télécharger"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {d.databases && d.databases.length > 0 && (
                  <p className="text-xs text-muted-foreground">Bases : {d.databases.join(", ")}</p>
                )}
                {d.databases && d.databases.length === 0 && (
                  <p className="text-xs text-muted-foreground">Aucune base applicative (hors bases système)</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Aucune base détectée.</p>
        )}
      </Card>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Historique</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | BackupRunStatus)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <p className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
          Pour restaurer une sauvegarde, rendez-vous sur{" "}
          <Link to="/restore" className="inline-flex items-center gap-0.5 text-primary underline">
            Restore <ArrowRight className="h-3 w-3" />
          </Link>
        </p>

        <div className="flex flex-col gap-2">
          {filteredHistory.length === 0 && (
            <Card className="text-sm text-muted-foreground">Aucun historique.</Card>
          )}
          {filteredHistory.map((h) => {
            const driveStatus = driveStatusByRunId.get(h.runId);
            return (
              <Card key={h.runId} className={historyCardClass(h.status)}>
                <div className="flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {h.type} · {h.sourceType}:{h.sourceRef}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {h.target}
                      {h.driveFileId ? " + gdrive" : ""}
                      {h.usbPath ? " + usb" : ""} · {new Date(h.startedAt).toLocaleString()}
                      {h.durationMs != null ? ` · ${(h.durationMs / 1000).toFixed(1)}s` : ""}
                    </p>
                  </div>
                  <span
                    className={
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium " +
                      (h.status === "success"
                        ? "bg-primary/15 text-primary"
                        : h.status === "failed"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-warning/15 text-warning")
                    }
                  >
                    {h.status}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {h.sizeBytes != null && (
                      <p className="text-xs text-muted-foreground">{formatBytes(h.sizeBytes)}</p>
                    )}
                    {driveStatus && <DriveStatusBadge status={driveStatus} />}
                  </div>
                  <div className="flex gap-1">
                    {h.status === "success" && h.target === "local" && (
                      <Button size="sm" variant="outline" onClick={() => triggerDownload(h.runId)} title="Télécharger">
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <ConfirmDialog
                      trigger={
                        <Button size="sm" variant="destructive" disabled={deletingRunId === h.runId}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      }
                      title="Supprimer cette sauvegarde ?"
                      description="Le fichier local sera supprimé (les copies USB/Drive existantes ne sont pas touchées). Action irréversible."
                      confirmLabel="Supprimer"
                      onConfirm={() => deleteRun(h.runId)}
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function NewJobForm({ onCreated }: { onCreated: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [kind, setKind] = useState<"complet" | "partiel">("complet");
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<BackupSourceType>("volume");
  const [sourceRef, setSourceRef] = useState("");
  const [targets, setTargets] = useState<BackupTarget[]>(["local"]);
  const [downloadAfter, setDownloadAfter] = useState(false);
  const [cron, setCron] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [volumes, setVolumes] = useState<VolumeSummary[] | null>(null);
  const [detectedDbs, setDetectedDbs] = useState<DetectedDatabase[] | null>(null);
  const [bindMounts, setBindMounts] = useState<DetectedBindMount[] | null>(null);
  const [gdriveAuthorized, setGdriveAuthorized] = useState(false);
  const [usbAvailable, setUsbAvailable] = useState(false);
  const [refsLoading, setRefsLoading] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);

  useEffect(() => {
    apiJson<{ authorized: boolean }>("/backups/gdrive/status")
      .then((s) => setGdriveAuthorized(s.authorized))
      .catch(() => setGdriveAuthorized(false));
    apiJson<UsbStatus>("/backups/usb/status")
      .then((s) => setUsbAvailable(s.drives.some((d) => d.isBackupConfigured)))
      .catch(() => setUsbAvailable(false));
  }, []);

  useEffect(() => {
    if (kind === "partiel") {
      setSourceType("db");
      return;
    }
    setSourceType((prev) => (prev === "db" ? "volume" : prev));
  }, [kind]);

  useEffect(() => {
    setSourceRef("");
    setManualEntry(false);
    setRefsLoading(true);

    if (sourceType === "volume") {
      apiJson<VolumeSummary[]>("/docker/volumes")
        .then(setVolumes)
        .catch(() => setError("Impossible de charger la liste des volumes"))
        .finally(() => setRefsLoading(false));
    } else if (sourceType === "db") {
      apiJson<DetectedDatabase[]>("/dbbackup/detect")
        .then(setDetectedDbs)
        .catch(() => setError("Impossible de charger la liste des bases de données"))
        .finally(() => setRefsLoading(false));
    } else if (sourceType === "path") {
      apiJson<DetectedBindMount[]>("/backups/bind-mounts")
        .then(setBindMounts)
        .catch(() => setError("Impossible de charger la liste des dossiers montés"))
        .finally(() => setRefsLoading(false));
    }
  }, [sourceType]);

  const refOptions: { value: string; label: string }[] =
    sourceType === "volume"
      ? (volumes ?? []).map((v) => ({ value: v.name, label: v.name }))
      : sourceType === "db"
        ? (detectedDbs ?? []).map((d) => ({
            value: `${d.location}:${d.ref}`,
            label: `${d.displayName} (${d.engine})`,
          }))
        : sourceType === "path"
          ? (bindMounts ?? []).map((m) => ({
              value: m.hostPath,
              label: `${m.hostPath} (${m.containerName})`,
            }))
          : [];

  function toggleTarget(t: BackupTarget) {
    setTargets((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !sourceRef.trim() || targets.length === 0) {
      setError("Nom, référence et au moins une cible sont requis");
      return;
    }
    setSubmitting(true);
    try {
      const job = await apiJson<{ id: number }>("/backups/jobs", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          sourceType,
          sourceRef: sourceRef.trim(),
          targets,
          scheduleCron: cron.trim() || undefined,
        }),
      });
      if (downloadAfter) {
        const { runId } = await apiJson<{ runId: string }>(`/backups/jobs/${job.id}/run`, { method: "POST" });
        pollThenMaybeDownload(runId, true).catch(() => {});
      }
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mb-3">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Étape 1 — Type</p>
          <div className="flex overflow-hidden rounded-md border border-border text-sm">
            <button
              type="button"
              onClick={() => {
                setKind("complet");
                setStep(1);
              }}
              className={`flex-1 px-3 py-2 ${kind === "complet" ? "bg-primary text-primary-foreground" : "bg-background"}`}
            >
              Complet
            </button>
            <button
              type="button"
              onClick={() => {
                setKind("partiel");
                setStep(1);
              }}
              className={`flex-1 px-3 py-2 ${kind === "partiel" ? "bg-primary text-primary-foreground" : "bg-background"}`}
            >
              Partiel (base de données)
            </button>
          </div>
        </div>

        {kind === "complet" ? (
          <>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as BackupSourceType)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
            >
              <option value="volume">volume Docker</option>
              <option value="path">dossier (bind mount)</option>
            </select>
            <input
              type="text"
              placeholder="Nom du job"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            {manualEntry || refOptions.length === 0 ? (
              <div className="flex flex-col gap-1">
                <input
                  type="text"
                  placeholder={
                    refsLoading
                      ? "Chargement…"
                      : sourceType === "volume"
                        ? "Référence source (nom du volume)"
                        : "Chemin absolu (ex: /opt/docker-data/mon-app)"
                  }
                  value={sourceRef}
                  onChange={(e) => setSourceRef(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                />
                {refOptions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setManualEntry(false)}
                    className="self-start text-xs text-primary underline"
                  >
                    Choisir dans la liste
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <select
                  value={sourceRef}
                  onChange={(e) => setSourceRef(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
                >
                  <option value="">
                    {sourceType === "volume" ? "Sélectionner un volume…" : "Sélectionner un dossier monté…"}
                  </option>
                  {refOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setManualEntry(true)}
                  className="self-start text-xs text-primary underline"
                >
                  Saisir manuellement
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Pour un dump ponctuel, utilisez le bouton « Dump » dans la carte « Bases de données détectées »
            ci-dessous. Ce formulaire crée un job planifiable — la source est une base de données détectée.
          </p>
        )}

        {kind === "partiel" && (
          <>
            <input
              type="text"
              placeholder="Nom du job"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            {manualEntry || refOptions.length === 0 ? (
              <div className="flex flex-col gap-1">
                <input
                  type="text"
                  placeholder={refsLoading ? "Chargement…" : "Référence source (location:ref, ex: native:mariadb)"}
                  value={sourceRef}
                  onChange={(e) => setSourceRef(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                />
                {refOptions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setManualEntry(false)}
                    className="self-start text-xs text-primary underline"
                  >
                    Choisir dans la liste
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <select
                  value={sourceRef}
                  onChange={(e) => setSourceRef(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
                >
                  <option value="">Sélectionner une base de données…</option>
                  {refOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setManualEntry(true)}
                  className="self-start text-xs text-primary underline"
                >
                  Saisir manuellement
                </button>
              </div>
            )}
          </>
        )}

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Étape 2 — Destination</p>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={targets.includes("local")} onChange={() => toggleTarget("local")} />
              local
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={targets.includes("gdrive")}
                onChange={() => toggleTarget("gdrive")}
                disabled={!gdriveAuthorized}
              />
              gdrive
              {!gdriveAuthorized && <span className="text-xs text-muted-foreground">(non connecté)</span>}
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={targets.includes("usb")}
                onChange={() => toggleTarget("usb")}
                disabled={!usbAvailable}
              />
              usb
              {!usbAvailable && <span className="text-xs text-muted-foreground">(non configuré — voir plus bas)</span>}
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={downloadAfter} onChange={() => setDownloadAfter((v) => !v)} />
              télécharger après la sauvegarde
            </label>
          </div>
        </div>

        <input
          type="text"
          placeholder="Expression cron (optionnel)"
          value={cron}
          onChange={(e) => setCron(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Création…" : "Créer"}
        </Button>
      </form>
    </Card>
  );
}

function DriveStatusBadge({ status }: { status: "verified" | "missing" | "size-mismatch" | "not-uploaded" }) {
  const config = {
    verified: { label: "vérifié sur Drive", cls: "bg-primary/15 text-primary", icon: CheckCircle2 },
    "size-mismatch": { label: "taille différente sur Drive", cls: "bg-warning/15 text-warning", icon: AlertTriangle },
    missing: { label: "absent de Drive", cls: "bg-destructive/15 text-destructive", icon: XCircle },
    "not-uploaded": { label: "jamais envoyé sur Drive", cls: "bg-destructive/15 text-destructive", icon: XCircle },
  }[status];
  const Icon = config.icon;
  return (
    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${config.cls}`}>
      <Icon className="h-3 w-3" /> {config.label}
    </span>
  );
}

/**
 * Backup-context slice of what used to be GDriveConnection — connexion/
 * déconnexion du compte a déménagé vers Settings (réglages de compte), ce
 * qui reste ici est propre au contexte "sauvegardes" : comparer ce qui est
 * en local à ce qui est réellement sur Drive. Vérifie elle-même le statut
 * de connexion pour rester utilisable indépendamment de Settings — un
 * admin non connecté à Drive voit juste un message plutôt qu'un bouton
 * qui échouerait.
 */
function GDriveCompareCard({
  comparison,
  comparing,
  onCompare,
  onDeletedFile,
}: {
  comparison: GDriveComparisonResult | null;
  comparing: boolean;
  onCompare: () => void;
  onDeletedFile: () => void;
}) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    apiJson<{ authorized: boolean }>("/backups/gdrive/status")
      .then((s) => setAuthorized(s.authorized))
      .catch(() => setAuthorized(false));
  }, []);

  return (
    <Card>
      <CardTitle className="flex items-center gap-1">
        <Cloud className="h-4 w-4" /> Google Drive
      </CardTitle>
      {authorized === false && (
        <p className="text-sm text-muted-foreground">
          Non connecté — configurez la connexion dans <Link to="/settings" className="text-primary underline-offset-2 hover:underline">Settings</Link>.
        </p>
      )}
      {authorized && <GDriveCompareSummary comparison={comparison} comparing={comparing} onCompare={onCompare} onDeletedFile={onDeletedFile} />}
    </Card>
  );
}

function GDriveCompareSummary({
  comparison,
  comparing,
  onCompare,
  onDeletedFile,
}: {
  comparison: GDriveComparisonResult | null;
  comparing: boolean;
  onCompare: () => void;
  onDeletedFile: () => void;
}) {
  return (
    <div className="border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Comparaison local ↔ Google Drive</p>
        <Button size="sm" variant="outline" onClick={onCompare} disabled={comparing}>
          {comparing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          {comparing ? "Vérification…" : "Vérifier Google Drive"}
        </Button>
      </div>

      {comparison && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md border border-border p-2">
              <p className="text-muted-foreground">Vérifiées sur Drive</p>
              <p className="text-sm font-medium text-primary">{comparison.totalVerified}</p>
            </div>
            <div className="rounded-md border border-border p-2">
              <p className="text-muted-foreground">Manquantes sur Drive</p>
              <p className={`text-sm font-medium ${comparison.totalMissing > 0 ? "text-destructive" : ""}`}>
                {comparison.totalMissing}
              </p>
            </div>
            <div className="rounded-md border border-border p-2">
              <p className="text-muted-foreground">Fichiers Drive orphelins</p>
              <p className={`text-sm font-medium ${comparison.totalOrphans > 0 ? "text-warning" : ""}`}>
                {comparison.totalOrphans}
              </p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Vérifié le {new Date(comparison.checkedAt).toLocaleString()} — le statut de chaque sauvegarde est
            affiché directement dans l'historique ci-dessous.
          </p>

          {comparison.orphanGroups.length > 0 && (
            <div className="mt-1 flex flex-col gap-2">
              <p className="flex items-center gap-1 text-xs font-medium text-warning">
                <AlertTriangle className="h-3.5 w-3.5" /> Présents sur Drive uniquement (pas de sauvegarde locale
                correspondante)
              </p>
              {comparison.orphanGroups.map((group) => (
                <OrphanGroupCard key={`${group.category}/${group.sourceRef}`} group={group} onDeleted={onDeletedFile} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OrphanGroupCard({
  group,
  onDeleted,
}: {
  group: GDriveComparisonResult["orphanGroups"][number];
  onDeleted: () => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function deleteFile(fileId: string) {
    setDeletingId(fileId);
    try {
      await apiJson(`/backups/gdrive/files/${fileId}`, { method: "DELETE" });
      onDeleted();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-xs font-medium">
        {group.category}/{group.sourceRef}
        <span className="ml-1 text-muted-foreground">({group.files.length} fichier(s))</span>
      </p>
      <div className="mt-1 flex flex-col gap-1">
        {group.files.map((f) => (
          <div key={f.fileId} className="flex items-center justify-between text-xs">
            <div className="min-w-0">
              <p className="truncate">{f.fileName}</p>
              <p className="text-muted-foreground">
                {formatBytes(f.sizeBytes)} · {new Date(f.modifiedAt).toLocaleDateString()}
              </p>
            </div>
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="destructive" disabled={deletingId === f.fileId}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              }
              title="Supprimer ce fichier sur Google Drive ?"
              description="Le fichier sera définitivement supprimé de Google Drive (aucune copie locale n'existe)."
              confirmLabel="Supprimer"
              onConfirm={() => deleteFile(f.fileId)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function UsbConnection() {
  const [status, setStatus] = useState<UsbStatus | null>(null);
  const [archives, setArchives] = useState<UsbBackupArchive[] | null>(null);
  const [showArchives, setShowArchives] = useState(false);
  const [loadingArchives, setLoadingArchives] = useState(false);
  const [enabling, setEnabling] = useState<string | null>(null);
  const [ejecting, setEjecting] = useState<string | null>(null);
  const [ejected, setEjected] = useState<string | null>(null);

  function loadStatus() {
    apiJson<UsbStatus>("/backups/usb/status")
      .then(setStatus)
      .catch(() => setStatus(null));
  }

  useEffect(loadStatus, []);

  async function enableDrive(mountpoint: string) {
    setEnabling(mountpoint);
    try {
      await apiJson("/backups/usb/enable", { method: "POST", body: JSON.stringify({ mountpoint }) });
      loadStatus();
    } finally {
      setEnabling(null);
    }
  }

  async function ejectDrive(mountpoint: string) {
    setEjecting(mountpoint);
    try {
      await apiJson("/backups/usb/eject", { method: "POST", body: JSON.stringify({ mountpoint }) });
      setEjected(mountpoint);
      loadStatus();
    } finally {
      setEjecting(null);
    }
  }

  async function loadArchives() {
    setShowArchives((v) => !v);
    if (archives) return;
    setLoadingArchives(true);
    try {
      setArchives(await apiJson<UsbBackupArchive[]>("/backups/usb/archives"));
    } catch {
      setArchives([]);
    } finally {
      setLoadingArchives(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle className="flex items-center gap-1">
          <Usb className="h-4 w-4" /> Disque USB / SSD
        </CardTitle>
        <Button size="sm" variant="outline" onClick={loadStatus}>
          Rafraîchir
        </Button>
      </div>

      {ejected && (
        <p className="flex items-center gap-1 text-sm text-primary">
          <CheckCircle2 className="h-4 w-4" /> Disque démonté, débranchement possible en toute sécurité.
        </p>
      )}

      {!status ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : !status.available ? (
        <p className="flex items-center gap-1 text-sm text-warning">
          <XCircle className="h-4 w-4" /> Aucun disque USB détecté (branchez-le, il sera monté automatiquement).
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {status.drives.map((d) =>
            d.isBackupConfigured ? (
              <div key={d.mountpoint} className="rounded-md border border-border p-2 text-sm">
                <p className="flex items-center gap-1 text-primary">
                  <CheckCircle2 className="h-4 w-4" /> {d.label} ({d.device})
                </p>
                <p className="text-xs text-muted-foreground">
                  {d.filesystem ?? "?"} · {d.freeBytes != null ? formatBytes(d.freeBytes) : "?"} libre
                  {d.totalBytes != null ? ` / ${formatBytes(d.totalBytes)}` : ""}
                </p>
                <p className="truncate text-xs text-muted-foreground">{d.backupRoot}</p>
                <ConfirmDialog
                  trigger={
                    <Button size="sm" variant="outline" className="mt-2" disabled={ejecting === d.mountpoint}>
                      {ejecting === d.mountpoint ? "Éjection…" : "Éjecter"}
                    </Button>
                  }
                  title="Éjecter ce disque ?"
                  description="Le disque sera démonté proprement. Attendez la confirmation avant de le débrancher physiquement, sinon une sauvegarde en cours pourrait être corrompue."
                  confirmLabel="Éjecter"
                  onConfirm={() => ejectDrive(d.mountpoint)}
                />
              </div>
            ) : (
              <div key={d.mountpoint} className="rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">
                <p className="flex items-center gap-1 text-warning">
                  <AlertTriangle className="h-4 w-4" /> {d.label} ({d.device}) — non configuré comme disque de sauvegarde
                </p>
                <p className="text-xs text-muted-foreground">
                  {d.filesystem ?? "?"} · {d.freeBytes != null ? formatBytes(d.freeBytes) : "?"} libre
                  {d.totalBytes != null ? ` / ${formatBytes(d.totalBytes)}` : ""}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={enabling === d.mountpoint}
                  onClick={() => enableDrive(d.mountpoint)}
                >
                  {enabling === d.mountpoint ? "Activation…" : "Activer comme disque de sauvegarde"}
                </Button>
              </div>
            )
          )}

          {status.drives.some((d) => d.isBackupConfigured) && (
            <Button size="sm" variant="outline" onClick={loadArchives}>
              {showArchives ? "Masquer les archives" : "Parcourir les archives sur le disque"}
            </Button>
          )}

          {showArchives && (
            <div className="flex flex-col gap-1">
              {loadingArchives && <p className="text-xs text-muted-foreground">Chargement…</p>}
              {!loadingArchives && archives?.length === 0 && (
                <p className="text-xs text-muted-foreground">Aucune archive trouvée sur le disque.</p>
              )}
              {archives?.map((a) => (
                <div key={a.fullPath} className="flex items-center justify-between text-xs">
                  <div className="min-w-0">
                    <p className="truncate">
                      {a.category}/{a.sourceRef}/{a.fileName}
                    </p>
                    <p className="text-muted-foreground">
                      {formatBytes(a.sizeBytes)} · {new Date(a.modifiedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** Capture-only card: takes a whole-server "migration" snapshot onto the
 * configured USB drive (disaster recovery / hardware swap). Restoring FROM a
 * snapshot is deliberately not here — that's Restore.tsx's job, same
 * separation as every other backup category in this app. */
function MigrationSnapshotCard() {
  const [usbConfigured, setUsbConfigured] = useState(false);
  const [snapshots, setSnapshots] = useState<MigrationSnapshotRun[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeManifestId, setActiveManifestId] = useState<string | null>(null);
  // Décoché par défaut — un conteneur "-duplicate" est un clone de bascule
  // manuelle permanent (voir Sites > Dupliquer), identique à son original
  // au moment de la capture ; l'inclure double le temps/l'espace USB pour
  // un artefact qui n'a de sens que sur CE serveur, pas pour une
  // restauration sur une machine neuve.
  const [includeDuplicates, setIncludeDuplicates] = useState(false);

  function loadSnapshots() {
    apiJson<MigrationSnapshotRun[]>("/migration/snapshots")
      .then(setSnapshots)
      .catch(() => setSnapshots([]));
  }

  useEffect(() => {
    apiJson<UsbStatus>("/backups/usb/status")
      .then((s) => setUsbConfigured(s.drives.some((d) => d.isBackupConfigured)))
      .catch(() => setUsbConfigured(false));
    loadSnapshots();
  }, []);

  useEffect(() => {
    if (!activeManifestId) return;
    const interval = setInterval(async () => {
      try {
        const run = await apiJson<MigrationSnapshotRun>(`/migration/snapshot/${activeManifestId}`);
        if (run.status !== "running" && run.status !== "pending") {
          setActiveManifestId(null);
          loadSnapshots();
        }
      } catch {
        setActiveManifestId(null);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [activeManifestId]);

  async function startSnapshot() {
    setStarting(true);
    setError(null);
    try {
      const { manifestId } = await apiJson<{ manifestId: string }>("/migration/snapshot", {
        method: "POST",
        body: JSON.stringify({ confirm: true, includeDuplicates }),
      });
      setActiveManifestId(manifestId);
      loadSnapshots();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <Card>
      <CardTitle className="flex items-center gap-1">
        <HardDriveUpload className="h-4 w-4" /> Migration serveur (disque externe)
      </CardTitle>
      <p className="text-xs text-muted-foreground">
        Capture un instantané complet du serveur (images/volumes Docker, bases de données, config
        Nginx, applications, paquets système, configuration pwa-admin) sur le disque USB de
        sauvegarde — à utiliser en cas de changement de matériel. La restauration se fait depuis
        l'écran Restore, sur le nouveau serveur.
      </p>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {!usbConfigured ? (
        <p className="mt-2 flex items-center gap-1 text-sm text-warning">
          <AlertTriangle className="h-4 w-4" /> Aucun disque USB configuré comme sauvegarde (voir
          ci-dessus).
        </p>
      ) : (
        <>
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={includeDuplicates}
              onChange={(e) => setIncludeDuplicates(e.target.checked)}
              disabled={starting || !!activeManifestId}
            />
            Inclure les conteneurs "-duplicate" (clones de bascule manuelle — généralement inutiles pour une
            migration vers un nouveau serveur)
          </label>
          <Button size="sm" variant="outline" className="mt-2" onClick={startSnapshot} disabled={starting || !!activeManifestId}>
            {starting || activeManifestId ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Capture en cours…
              </>
            ) : (
              "Prendre un instantané de migration"
            )}
          </Button>
        </>
      )}

      {snapshots && snapshots.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {snapshots.map((s) => (
            <div key={s.manifestId} className="flex items-center justify-between text-xs">
              <span className="truncate text-muted-foreground">
                {s.scope.type === "site" ? `Site: ${s.scope.siteName}` : "Serveur complet"} ·{" "}
                {new Date(s.startedAt).toLocaleString()}
              </span>
              <span
                className={
                  "shrink-0 rounded-full px-2 py-0.5 font-medium " +
                  (s.status === "success"
                    ? "bg-primary/15 text-primary"
                    : s.status === "failed"
                      ? "bg-destructive/15 text-destructive"
                      : s.status === "partial"
                        ? "bg-warning/15 text-warning"
                        : "bg-muted text-muted-foreground")
                }
              >
                {s.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

