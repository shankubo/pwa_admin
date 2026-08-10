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
} from "lucide-react";

const STATUS_FILTERS: { key: "all" | BackupRunStatus; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "success", label: "Succès" },
  { key: "failed", label: "Échec" },
  { key: "running", label: "En cours" },
];

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
      .then((s) => setUsbAvailable(s.available))
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

      <GDriveConnection
        comparison={comparison}
        comparing={comparing}
        onCompare={runComparison}
        onDeletedFile={runComparison}
      />

      <UsbConnection />

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
              <Card key={h.runId}>
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
      .then((s) => setUsbAvailable(s.available))
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
                        : "Chemin absolu (ex: /home/shan/docker-data/pwa-asso)"
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
              {!usbAvailable && <span className="text-xs text-muted-foreground">(non détecté)</span>}
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
    <div className="mt-2 border-t border-border pt-3">
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

  function loadStatus() {
    apiJson<UsbStatus>("/backups/usb/status")
      .then(setStatus)
      .catch(() => setStatus(null));
  }

  useEffect(loadStatus, []);

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

      {!status ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : !status.available ? (
        <p className="flex items-center gap-1 text-sm text-warning">
          <XCircle className="h-4 w-4" /> Aucun disque USB détecté (branchez-le, il sera monté automatiquement).
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {status.drives.map((d) => (
            <div key={d.mountpoint} className="rounded-md border border-border p-2 text-sm">
              <p className="flex items-center gap-1 text-primary">
                <CheckCircle2 className="h-4 w-4" /> {d.label} ({d.device})
              </p>
              <p className="text-xs text-muted-foreground">
                {d.filesystem ?? "?"} · {d.freeBytes != null ? formatBytes(d.freeBytes) : "?"} libre
                {d.totalBytes != null ? ` / ${formatBytes(d.totalBytes)}` : ""}
              </p>
              <p className="truncate text-xs text-muted-foreground">{d.backupRoot}</p>
            </div>
          ))}

          <Button size="sm" variant="outline" onClick={loadArchives}>
            {showArchives ? "Masquer les archives" : "Parcourir les archives sur le disque"}
          </Button>

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

interface GDriveStatus {
  enabled: boolean;
  configured: boolean;
  authorized: boolean;
  rootFolderId: string | null;
}

function GDriveConnection({
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
  const [status, setStatus] = useState<GDriveStatus | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  function loadStatus() {
    apiJson<GDriveStatus>("/backups/gdrive/status")
      .then(setStatus)
      .catch(() => setStatus(null));
  }

  useEffect(loadStatus, []);

  async function startAuth() {
    setMessage(null);
    try {
      const { url } = await apiJson<{ url: string }>("/backups/gdrive/auth-url");
      setAuthUrl(url);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setMessage({ type: "error", text: (err as Error).message });
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiJson("/backups/gdrive/authorize", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      setCode("");
      setAuthUrl(null);
      setMessage({ type: "ok", text: "Connecté à Google Drive avec succès." });
      loadStatus();
    } catch (err) {
      setMessage({ type: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function testUpload() {
    setBusy(true);
    setMessage(null);
    try {
      await apiJson("/backups/gdrive/test-upload", { method: "POST" });
      setMessage({ type: "ok", text: "Fichier de test envoyé avec succès sur Google Drive." });
    } catch (err) {
      setMessage({ type: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setMessage(null);
    try {
      await apiJson("/backups/gdrive/revoke", { method: "POST" });
      setMessage({ type: "ok", text: "Déconnecté de Google Drive." });
      loadStatus();
    } catch (err) {
      setMessage({ type: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle className="flex items-center gap-1">
        <Cloud className="h-4 w-4" /> Google Drive
      </CardTitle>

      {!status ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : !status.enabled ? (
        <p className="text-sm text-muted-foreground">
          Désactivé (GDRIVE_ENABLED=false côté serveur).
        </p>
      ) : !status.configured ? (
        <p className="text-sm text-muted-foreground">
          Identifiants OAuth manquants (GDRIVE_OAUTH_CLIENT_ID / GDRIVE_OAUTH_CLIENT_SECRET).
        </p>
      ) : status.authorized ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1 text-sm text-primary">
            <CheckCircle2 className="h-4 w-4" /> Connecté
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={testUpload} disabled={busy}>
              Tester la connexion
            </Button>
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="destructive" disabled={busy}>
                  Déconnecter
                </Button>
              }
              title="Déconnecter Google Drive ?"
              description="Les jobs ciblant « gdrive » échoueront jusqu'à une nouvelle autorisation."
              confirmLabel="Déconnecter"
              onConfirm={disconnect}
            />
          </div>
          <GDriveCompareSummary
            comparison={comparison}
            comparing={comparing}
            onCompare={onCompare}
            onDeletedFile={onDeletedFile}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1 text-sm text-warning">
            <XCircle className="h-4 w-4" /> Non connecté
          </p>
          <Button size="sm" variant="outline" onClick={startAuth}>
            Autoriser l'accès à Google Drive
          </Button>
          {authUrl && (
            <form onSubmit={submitCode} className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                Une fenêtre Google s'est ouverte. Connectez-vous, autorisez l'accès, puis collez le code affiché ci-dessous.
              </p>
              <input
                type="text"
                placeholder="Code d'autorisation"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              <Button type="submit" size="sm" disabled={busy || !code.trim()}>
                {busy ? "Validation…" : "Valider le code"}
              </Button>
            </form>
          )}
        </div>
      )}

      {message && (
        <p className={`mt-2 text-xs ${message.type === "ok" ? "text-primary" : "text-destructive"}`}>
          {message.text}
        </p>
      )}
    </Card>
  );
}
