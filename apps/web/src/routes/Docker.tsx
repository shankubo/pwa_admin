import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  ContainerSummary,
  ContainerDetail,
  ImageSummary,
  VolumeSummary,
  NetworkSummary,
  BackupHistoryEntry,
  SiteSummary,
  VhostAccessibility,
} from "@pwa-admin/shared";
import { useTranslation } from "react-i18next";
import { apiJson, apiFetch } from "@/lib/api";
import { useWsChannel } from "@/lib/ws";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LiveLogPanel } from "@/components/LiveLogPanel";
import {
  Play,
  Square,
  RotateCw,
  Trash2,
  ChevronDown,
  ChevronUp,
  Container as ContainerIcon,
  DatabaseBackup,
  Upload,
  Download,
  Loader2,
  CheckCircle2,
} from "lucide-react";

type Tab = "containers" | "images" | "volumes" | "networks";

const TABS: { key: Tab; labelKey: string }[] = [
  { key: "containers", labelKey: "tabs.containers" },
  { key: "images", labelKey: "tabs.images" },
  { key: "volumes", labelKey: "tabs.volumes" },
  { key: "networks", labelKey: "tabs.networks" },
];

export function Docker() {
  const { t } = useTranslation("docker");
  const [tab, setTab] = useState<Tab>("containers");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 overflow-x-auto rounded-md border border-border bg-card p-1">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={
              "flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
              (tab === tb.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")
            }
          >
            {t(tb.labelKey)}
          </button>
        ))}
      </div>

      {tab === "containers" && <ContainersTab />}
      {tab === "images" && <ImagesTab />}
      {tab === "volumes" && <VolumesTab />}
      {tab === "networks" && <NetworksTab />}
    </div>
  );
}

function stateBadgeClass(state: string) {
  const s = state.toLowerCase();
  if (s === "running") return "bg-primary/15 text-primary";
  if (s === "exited" || s === "dead") return "bg-muted text-muted-foreground";
  if (s === "paused") return "bg-warning/15 text-warning";
  return "bg-destructive/15 text-destructive";
}

/**
 * Card color scheme (per admin request): green = running AND (no linked
 * site, e.g. a database container with nothing to check — OR the linked
 * site is enabled/not-in-maintenance/HTTP-reachable); red = stopped/dead, OR
 * running but its linked site is disabled/in-maintenance/unreachable;
 * orange = "-duplicate" clone (handled by the caller, takes priority over
 * this). While an accessibility probe for a linked site is still in flight,
 * no color is applied yet rather than guessing.
 */
function siteLinkedCardClass(
  state: string,
  site: SiteSummary | undefined,
  accessibility: VhostAccessibility | null | undefined
): string | undefined {
  const s = state.toLowerCase();
  if (s !== "running") return "border-destructive/50 bg-destructive/5";
  if (!site) return "border-primary/40 bg-primary/5";
  if (!site.enabled || site.maintenanceMode) return "border-destructive/50 bg-destructive/5";
  if (accessibility === undefined) return undefined; // still checking
  if (accessibility === null || !accessibility.reachable) return "border-destructive/50 bg-destructive/5";
  return "border-primary/40 bg-primary/5";
}

function ContainersTab() {
  const { t } = useTranslation("docker");
  const navigate = useNavigate();
  const [containers, setContainers] = useState<ContainerSummary[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sitesByContainer, setSitesByContainer] = useState<Record<string, SiteSummary>>({});
  const [accessibilityByContainer, setAccessibilityByContainer] = useState<
    Record<string, VhostAccessibility | null>
  >({});

  async function load() {
    try {
      const data = await apiJson<ContainerSummary[]>("/docker/containers");
      setContainers(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function loadSitesAndAccessibility() {
    let sites: SiteSummary[];
    try {
      sites = await apiJson<SiteSummary[]>("/sites");
    } catch {
      return;
    }
    const byContainer: Record<string, SiteSummary> = {};
    for (const s of sites) {
      if (s.linkedContainer) byContainer[s.linkedContainer.name] = s;
    }
    setSitesByContainer(byContainer);

    // Only probe sites that are actually up — a disabled/maintenance site is
    // already known-red without spending an 8s-timeout HTTP request on it.
    const toCheck = Object.values(byContainer).filter((s) => s.enabled && !s.maintenanceMode);
    const results = await Promise.all(
      toCheck.map((s) =>
        apiJson<VhostAccessibility>(`/nginx/vhosts/${encodeURIComponent(s.name)}/accessibility`).catch(
          () => null
        )
      )
    );
    setAccessibilityByContainer((prev) => {
      const next = { ...prev };
      toCheck.forEach((s, i) => {
        next[s.linkedContainer!.name] = results[i];
      });
      return next;
    });
  }

  useEffect(() => {
    load();
    loadSitesAndAccessibility();
  }, []);

  async function runAction(id: string, action: "start" | "stop" | "restart") {
    setBusyId(id);
    try {
      await apiJson(`/docker/containers/${id}/${action}`, { method: "POST" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function removeContainer(id: string) {
    await apiJson(`/docker/containers/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ confirm: true }),
    });
    if (expandedId === id) setExpandedId(null);
    await load();
  }

  if (error) return <Card className="text-sm text-destructive">{error}</Card>;
  if (!containers) return <Card className="text-sm text-muted-foreground">{t("containers.loading")}</Card>;
  if (containers.length === 0) return <Card className="text-sm text-muted-foreground">{t("containers.empty")}</Card>;

  return (
    <div className="flex flex-col gap-3">
      {containers.map((c) => {
        const isDuplicate = c.name.endsWith("-duplicate");
        const linkedSite = sitesByContainer[c.name];
        const accessibility = accessibilityByContainer[c.name];
        const cardClass = isDuplicate
          ? "border-warning/50 bg-warning/5"
          : siteLinkedCardClass(c.state, linkedSite, accessibility);
        return (
        <Card key={c.id} className={cardClass}>
          <div
            className="flex cursor-pointer items-start justify-between gap-2"
            onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <ContainerIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{c.name}</span>
                {isDuplicate && (
                  <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                    {t("containers.duplicateBadge")}
                  </span>
                )}
                {linkedSite && (
                  <span className="shrink-0 truncate rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {t("containers.linkedSite", { name: linkedSite.name })}
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.image}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{c.status}</p>
              {c.ports.length > 0 && (
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  {c.ports
                    .filter((p) => p.publicPort != null)
                    .map((p) => `${p.publicPort}→${p.privatePort}/${p.type}`)
                    .join(", ")}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stateBadgeClass(c.state)}`}>
                {c.state}
              </span>
              {expandedId === c.id ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="outline" disabled={busyId === c.id} onClick={() => runAction(c.id, "start")}>
              <Play className="h-3.5 w-3.5" /> {t("containers.actions.start")}
            </Button>
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="outline" disabled={busyId === c.id}>
                  <Square className="h-3.5 w-3.5" /> {t("containers.actions.stop")}
                </Button>
              }
              title={t("containers.stopConfirm.title", { name: c.name })}
              description={t("containers.stopConfirm.description")}
              confirmLabel={t("containers.actions.stop")}
              onConfirm={() => runAction(c.id, "stop")}
            />
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="outline" disabled={busyId === c.id}>
                  <RotateCw className="h-3.5 w-3.5" /> {t("containers.actions.restart")}
                </Button>
              }
              title={t("containers.restartConfirm.title", { name: c.name })}
              confirmLabel={t("containers.actions.restart")}
              onConfirm={() => runAction(c.id, "restart")}
            />
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="destructive" disabled={busyId === c.id}>
                  <Trash2 className="h-3.5 w-3.5" /> {t("containers.actions.remove")}
                </Button>
              }
              title={t("containers.removeConfirm.title", { name: c.name })}
              description={t("containers.removeConfirm.description")}
              confirmLabel={t("containers.actions.remove")}
              onConfirm={() => removeContainer(c.id)}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/applications?container=${encodeURIComponent(c.name)}`)}
              title={t("containers.backupButtonTitle")}
            >
              <DatabaseBackup className="h-3.5 w-3.5" /> {t("containers.actions.backup")}
            </Button>
          </div>

          {expandedId === c.id && <ContainerDetailPanel id={c.id} />}
        </Card>
        );
      })}
    </div>
  );
}

function ContainerDetailPanel({ id }: { id: string }) {
  const { t } = useTranslation("docker");
  const [detail, setDetail] = useState<ContainerDetail | null>(null);
  const [stats, setStats] = useState<{ cpuPercent: number; memUsageBytes: number; memLimitBytes: number } | null>(
    null
  );
  const [logChunk, setLogChunk] = useState<string | null>(null);

  useEffect(() => {
    apiJson<ContainerDetail>(`/docker/containers/${id}`)
      .then(setDetail)
      .catch(() => {});
  }, [id]);

  useWsChannel(
    "docker.stats",
    (frame) => setStats(frame.data as { cpuPercent: number; memUsageBytes: number; memLimitBytes: number }),
    { id }
  );
  useWsChannel("docker.logs", (frame) => setLogChunk(frame.data as string), { id });

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">{t("detail.cpu")}</p>
          <p className="font-medium">{stats ? `${stats.cpuPercent.toFixed(1)}%` : "…"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("detail.memory")}</p>
          <p className="font-medium">
            {stats ? `${formatBytes(stats.memUsageBytes)} / ${formatBytes(stats.memLimitBytes)}` : "…"}
          </p>
        </div>
      </div>

      {detail && (
        <div className="text-xs text-muted-foreground">
          <p>
            {t("detail.command", { command: "" })}
            <span className="font-mono">{detail.command}</span>
          </p>
          <p>{t("detail.network", { network: detail.networkMode })}</p>
          <p>{t("detail.restartPolicy", { policy: detail.restartPolicy })}</p>
          {detail.mounts.length > 0 && (
            <div className="mt-1">
              <p className="font-medium text-foreground">{t("detail.mounts")}</p>
              {detail.mounts.map((m, i) => (
                <p key={i} className="truncate font-mono">
                  {m.source} → {m.destination} ({m.mode})
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">{t("detail.liveLogs")}</p>
        <LiveLogPanel chunk={logChunk} />
      </div>
    </div>
  );
}

function ImagesTab() {
  const { t } = useTranslation("docker");
  const [images, setImages] = useState<ImageSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exportResult, setExportResult] = useState<
    Record<string, { status: "success" | "failed"; sizeBytes?: number; filePath?: string; error?: string }>
  >({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function load() {
    try {
      setImages(await apiJson<ImageSummary[]>("/docker/images"));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(id: string) {
    await apiJson(`/docker/images/${id}`, { method: "DELETE" });
    await load();
  }

  async function exportImage(img: ImageSummary) {
    setBusyId(img.id);
    setError(null);
    setExportResult((prev) => {
      const { [img.id]: _drop, ...rest } = prev;
      return rest;
    });
    try {
      const label = (img.tags[0] || img.id).replace(/[^a-zA-Z0-9._-]/g, "_");
      const result = await apiJson<{ filePath: string; sizeBytes: number }>(`/docker/images/${img.id}/export`, {
        method: "POST",
        body: JSON.stringify({ label, targets: ["local"] }),
      });
      setExportResult((prev) => ({
        ...prev,
        [img.id]: { status: "success", sizeBytes: result.sizeBytes, filePath: result.filePath },
      }));
    } catch (err) {
      setExportResult((prev) => ({ ...prev, [img.id]: { status: "failed", error: (err as Error).message } }));
    } finally {
      setBusyId(null);
    }
  }

  async function downloadExport(imgId: string, filePath: string) {
    setDownloadingId(imgId);
    try {
      // Mint a short-lived token scoped to this exact file, then let the
      // browser navigate straight to the download URL — native streaming
      // download, nothing held in JS memory (loading large exports via
      // fetch + blob() was found to drop mid-transfer past ~100 MB).
      const { token } = await apiJson<{ token: string }>("/docker/images/export/download-token", {
        method: "POST",
        body: JSON.stringify({ path: filePath }),
      });
      const a = document.createElement("a");
      a.href = `/api/docker/images/export/download?token=${encodeURIComponent(token)}`;
      a.download = filePath.split(/[/\\]/).pop() || "image.tar";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloadingId(null);
    }
  }

  async function importFile(file: File) {
    setImporting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch("/docker/images/import", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "import_failed" }));
        throw new Error(body.error ?? "import_failed");
      }
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground hover:bg-muted">
          <Upload className="h-4 w-4" />
          {importing ? t("images.importing") : t("images.importPrompt")}
          <input
            type="file"
            accept=".tar"
            className="hidden"
            disabled={importing}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importFile(file);
              e.target.value = "";
            }}
          />
        </label>
      </Card>

      {error && <Card className="text-sm text-destructive">{error}</Card>}
      {!images && <Card className="text-sm text-muted-foreground">{t("images.loading")}</Card>}
      {images?.length === 0 && <Card className="text-sm text-muted-foreground">{t("images.empty")}</Card>}

      {images?.map((img) => {
        const result = exportResult[img.id];
        const exporting = busyId === img.id;
        return (
        <Card key={img.id}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{img.tags.length > 0 ? img.tags.join(", ") : img.id}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(img.sizeBytes)}</p>
              <p className="text-xs text-muted-foreground">{new Date(img.createdAt).toLocaleString()}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={exporting}
                onClick={() => exportImage(img)}
                title={t("images.exportButtonTitle")}
              >
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                {exporting && <span className="ml-1">{t("images.exporting")}</span>}
              </Button>
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                }
                title={t("images.removeConfirmTitle")}
                confirmLabel={t("images.remove")}
                onConfirm={() => remove(img.id)}
              />
            </div>
          </div>
          {exporting && (
            <p className="mt-2 text-xs text-muted-foreground">{t("images.exportingNote")}</p>
          )}
          {result?.status === "success" && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="flex items-center gap-1 text-xs text-primary">
                <CheckCircle2 className="h-3.5 w-3.5" /> {t("images.exported", { size: formatBytes(result.sizeBytes ?? 0) })}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={downloadingId === img.id}
                onClick={() => result.filePath && downloadExport(img.id, result.filePath)}
              >
                {downloadingId === img.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {downloadingId === img.id ? t("images.downloading") : t("images.download")}
              </Button>
            </div>
          )}
          {result?.status === "failed" && (
            <p className="mt-2 text-xs text-destructive">{t("images.exportFailed", { error: result.error })}</p>
          )}
        </Card>
        );
      })}
    </div>
  );
}

function VolumesTab() {
  const { t } = useTranslation("docker");
  const [volumes, setVolumes] = useState<VolumeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [lastRunByVolume, setLastRunByVolume] = useState<Record<string, BackupHistoryEntry | undefined>>({});

  async function load() {
    try {
      const data = await apiJson<VolumeSummary[]>("/docker/volumes");
      setVolumes(data);
      const entries = await Promise.all(
        data.map((v) =>
          apiJson<BackupHistoryEntry[]>(`/backups/volumes/${encodeURIComponent(v.name)}/history`)
            .then((runs) => [v.name, runs.find((r) => r.status === "success")] as const)
            .catch(() => [v.name, undefined] as const)
        )
      );
      setLastRunByVolume(Object.fromEntries(entries));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(name: string) {
    await apiJson(`/docker/volumes/${name}`, { method: "DELETE" });
    await load();
  }

  async function backup(name: string) {
    setBusyName(name);
    setError(null);
    try {
      await apiJson(`/backups/volumes/${encodeURIComponent(name)}/run`, {
        method: "POST",
        body: JSON.stringify({ targets: ["local"] }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyName(null);
    }
  }

  async function restore(name: string) {
    const lastRun = lastRunByVolume[name];
    if (!lastRun) return;
    setBusyName(name);
    setError(null);
    try {
      await apiJson("/backups/restore", {
        method: "POST",
        body: JSON.stringify({ runId: lastRun.runId, targetVolume: name, confirm: true }),
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyName(null);
    }
  }

  if (error) return <Card className="text-sm text-destructive">{error}</Card>;
  if (!volumes) return <Card className="text-sm text-muted-foreground">{t("volumes.loading")}</Card>;
  if (volumes.length === 0) return <Card className="text-sm text-muted-foreground">{t("volumes.empty")}</Card>;

  return (
    <div className="flex flex-col gap-3">
      {volumes.map((v) => {
        const lastRun = lastRunByVolume[v.name];
        return (
        <Card key={v.name}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{v.name}</p>
              <p className="text-xs text-muted-foreground">{v.driver} · {v.mountpoint}</p>
              {v.sizeBytes != null && <p className="text-xs text-muted-foreground">{formatBytes(v.sizeBytes)}</p>}
              {lastRun && (
                <p className="text-xs text-muted-foreground">
                  {t("volumes.lastBackup", { date: new Date(lastRun.startedAt).toLocaleString() })}
                  {lastRun.sizeBytes != null && ` · ${formatBytes(lastRun.sizeBytes)}`}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busyName === v.name}
                onClick={() => backup(v.name)}
                title={t("volumes.backupButtonTitle")}
              >
                <DatabaseBackup className="h-3.5 w-3.5" />
              </Button>
              {lastRun && (
                <ConfirmDialog
                  trigger={
                    <Button size="sm" variant="outline" disabled={busyName === v.name} title={t("volumes.restoreButtonTitle")}>
                      <RotateCw className="h-3.5 w-3.5" />
                    </Button>
                  }
                  title={t("volumes.restoreConfirm.title", { name: v.name })}
                  description={t("volumes.restoreConfirm.description", {
                    date: new Date(lastRun.startedAt).toLocaleString(),
                  })}
                  confirmLabel={t("volumes.restore")}
                  onConfirm={() => restore(v.name)}
                />
              )}
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                }
                title={t("volumes.removeConfirm.title", { name: v.name })}
                description={t("volumes.removeConfirm.description")}
                confirmLabel={t("images.remove")}
                onConfirm={() => remove(v.name)}
              />
            </div>
          </div>
        </Card>
        );
      })}
    </div>
  );
}

function NetworksTab() {
  const { t } = useTranslation("docker");
  const [networks, setNetworks] = useState<NetworkSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiJson<NetworkSummary[]>("/docker/networks")
      .then(setNetworks)
      .catch((err) => setError((err as Error).message));
  }, []);

  if (error) return <Card className="text-sm text-destructive">{error}</Card>;
  if (!networks) return <Card className="text-sm text-muted-foreground">{t("networks.loading")}</Card>;
  if (networks.length === 0) return <Card className="text-sm text-muted-foreground">{t("networks.empty")}</Card>;

  return (
    <div className="flex flex-col gap-3">
      {networks.map((n) => (
        <Card key={n.id}>
          <p className="text-sm font-medium">{n.name}</p>
          <p className="text-xs text-muted-foreground">{n.driver} · {n.scope}</p>
        </Card>
      ))}
    </div>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
