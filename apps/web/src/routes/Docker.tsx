import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  ContainerSummary,
  ContainerDetail,
  ImageSummary,
  VolumeSummary,
  NetworkSummary,
  BackupHistoryEntry,
} from "@pwa-admin/shared";
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

const TABS: { key: Tab; label: string }[] = [
  { key: "containers", label: "Conteneurs" },
  { key: "images", label: "Images" },
  { key: "volumes", label: "Volumes" },
  { key: "networks", label: "Réseaux" },
];

export function Docker() {
  const [tab, setTab] = useState<Tab>("containers");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 overflow-x-auto rounded-md border border-border bg-card p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
              (tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")
            }
          >
            {t.label}
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

function ContainersTab() {
  const navigate = useNavigate();
  const [containers, setContainers] = useState<ContainerSummary[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await apiJson<ContainerSummary[]>("/docker/containers");
      setContainers(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    load();
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
  if (!containers) return <Card className="text-sm text-muted-foreground">Chargement…</Card>;
  if (containers.length === 0) return <Card className="text-sm text-muted-foreground">Aucun conteneur.</Card>;

  return (
    <div className="flex flex-col gap-3">
      {containers.map((c) => {
        const isDuplicate = c.name.endsWith("-duplicate");
        return (
        <Card key={c.id} className={isDuplicate ? "border-warning/50 bg-warning/5" : undefined}>
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
                    duplicata
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
              <Play className="h-3.5 w-3.5" /> Démarrer
            </Button>
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="outline" disabled={busyId === c.id}>
                  <Square className="h-3.5 w-3.5" /> Arrêter
                </Button>
              }
              title={`Arrêter ${c.name} ?`}
              description="Le conteneur sera arrêté proprement."
              confirmLabel="Arrêter"
              onConfirm={() => runAction(c.id, "stop")}
            />
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="outline" disabled={busyId === c.id}>
                  <RotateCw className="h-3.5 w-3.5" /> Redémarrer
                </Button>
              }
              title={`Redémarrer ${c.name} ?`}
              confirmLabel="Redémarrer"
              onConfirm={() => runAction(c.id, "restart")}
            />
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="destructive" disabled={busyId === c.id}>
                  <Trash2 className="h-3.5 w-3.5" /> Supprimer
                </Button>
              }
              title={`Supprimer ${c.name} ?`}
              description="Cette action est irréversible."
              confirmLabel="Supprimer"
              onConfirm={() => removeContainer(c.id)}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/applications?container=${encodeURIComponent(c.name)}`)}
              title="Configurer une sauvegarde complète (conteneur + dossiers + base de données) dans Applications"
            >
              <DatabaseBackup className="h-3.5 w-3.5" /> Sauvegarde
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
          <p className="text-xs text-muted-foreground">CPU</p>
          <p className="font-medium">{stats ? `${stats.cpuPercent.toFixed(1)}%` : "…"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Mémoire</p>
          <p className="font-medium">
            {stats ? `${formatBytes(stats.memUsageBytes)} / ${formatBytes(stats.memLimitBytes)}` : "…"}
          </p>
        </div>
      </div>

      {detail && (
        <div className="text-xs text-muted-foreground">
          <p>Commande : <span className="font-mono">{detail.command}</span></p>
          <p>Réseau : {detail.networkMode}</p>
          <p>Politique de redémarrage : {detail.restartPolicy}</p>
          {detail.mounts.length > 0 && (
            <div className="mt-1">
              <p className="font-medium text-foreground">Montages</p>
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
        <p className="mb-1 text-xs font-medium text-muted-foreground">Logs (temps réel)</p>
        <LiveLogPanel chunk={logChunk} />
      </div>
    </div>
  );
}

function ImagesTab() {
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
          {importing ? "Import en cours…" : "Importer une image (.tar)"}
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
      {!images && <Card className="text-sm text-muted-foreground">Chargement…</Card>}
      {images?.length === 0 && <Card className="text-sm text-muted-foreground">Aucune image.</Card>}

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
                title="Exporter en .tar (local)"
              >
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                {exporting && <span className="ml-1">Export…</span>}
              </Button>
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                }
                title="Supprimer cette image ?"
                confirmLabel="Supprimer"
                onConfirm={() => remove(img.id)}
              />
            </div>
          </div>
          {exporting && (
            <p className="mt-2 text-xs text-muted-foreground">
              Export en cours (peut prendre plusieurs minutes pour une grosse image)…
            </p>
          )}
          {result?.status === "success" && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="flex items-center gap-1 text-xs text-primary">
                <CheckCircle2 className="h-3.5 w-3.5" /> Exportée ({formatBytes(result.sizeBytes ?? 0)})
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
                {downloadingId === img.id ? "Téléchargement…" : "Télécharger le fichier"}
              </Button>
            </div>
          )}
          {result?.status === "failed" && (
            <p className="mt-2 text-xs text-destructive">Échec de l'export : {result.error}</p>
          )}
        </Card>
        );
      })}
    </div>
  );
}

function VolumesTab() {
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
  if (!volumes) return <Card className="text-sm text-muted-foreground">Chargement…</Card>;
  if (volumes.length === 0) return <Card className="text-sm text-muted-foreground">Aucun volume.</Card>;

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
                  Dernière sauvegarde : {new Date(lastRun.startedAt).toLocaleString()}
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
                title="Sauvegarder maintenant (local)"
              >
                <DatabaseBackup className="h-3.5 w-3.5" />
              </Button>
              {lastRun && (
                <ConfirmDialog
                  trigger={
                    <Button size="sm" variant="outline" disabled={busyName === v.name} title="Restaurer la dernière sauvegarde">
                      <RotateCw className="h-3.5 w-3.5" />
                    </Button>
                  }
                  title={`Restaurer le volume ${v.name} ?`}
                  description={`Écrase le contenu actuel avec la sauvegarde du ${new Date(lastRun.startedAt).toLocaleString()}.`}
                  confirmLabel="Restaurer"
                  onConfirm={() => restore(v.name)}
                />
              )}
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                }
                title={`Supprimer le volume ${v.name} ?`}
                description="Toutes les données de ce volume seront perdues."
                confirmLabel="Supprimer"
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
  const [networks, setNetworks] = useState<NetworkSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiJson<NetworkSummary[]>("/docker/networks")
      .then(setNetworks)
      .catch((err) => setError((err as Error).message));
  }, []);

  if (error) return <Card className="text-sm text-destructive">{error}</Card>;
  if (!networks) return <Card className="text-sm text-muted-foreground">Chargement…</Card>;
  if (networks.length === 0) return <Card className="text-sm text-muted-foreground">Aucun réseau.</Card>;

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
