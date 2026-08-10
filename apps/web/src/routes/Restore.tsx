import { useEffect, useMemo, useState } from "react";
import type {
  Application,
  AppBackupRun,
  BackupHistoryEntry,
  UsbStatus,
  UsbBackupArchive,
  BackupUploadResult,
  BackupUploadSourceKind,
} from "@pwa-admin/shared";
import { apiJson, apiFetch } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatBytes } from "./Docker";
import {
  HardDrive,
  Usb,
  Cloud,
  Upload,
  ArrowLeft,
  Database,
  Boxes,
  Container,
  CheckCircle2,
  Loader2,
} from "lucide-react";

type SelectedItem =
  | { kind: "generic"; run: BackupHistoryEntry }
  | { kind: "app"; appId: number; appName: string; run: AppBackupRun }
  | { kind: "app-image"; appId: number; containerName: string; run: BackupHistoryEntry };

type Source = "local" | "usb" | "gdrive" | "upload";

export function Restore() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [source, setSource] = useState<Source | null>(null);
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restored, setRestored] = useState(false);

  const [history, setHistory] = useState<BackupHistoryEntry[] | null>(null);
  const [usbStatus, setUsbStatus] = useState<UsbStatus | null>(null);
  const [usbArchives, setUsbArchives] = useState<UsbBackupArchive[] | null>(null);
  const [gdriveAuthorized, setGdriveAuthorized] = useState(false);
  const [apps, setApps] = useState<Application[] | null>(null);
  const [appRuns, setAppRuns] = useState<AppBackupRun[] | null>(null);

  useEffect(() => {
    apiJson<BackupHistoryEntry[]>("/backups/history?limit=100&offset=0").then(setHistory).catch(() => setHistory([]));
    apiJson<UsbStatus>("/backups/usb/status").then(setUsbStatus).catch(() => setUsbStatus(null));
    apiJson<{ authorized: boolean }>("/backups/gdrive/status")
      .then((s) => setGdriveAuthorized(s.authorized))
      .catch(() => setGdriveAuthorized(false));
    apiJson<Application[]>("/applications").then(setApps).catch(() => setApps([]));
    apiJson<AppBackupRun[]>("/applications/runs/all").then(setAppRuns).catch(() => setAppRuns([]));
  }, []);

  const usbConfigured = usbStatus?.drives.some((d) => d.isBackupConfigured) ?? false;

  useEffect(() => {
    if (source !== "usb" || !usbConfigured || usbArchives) return;
    apiJson<UsbBackupArchive[]>("/backups/usb/archives")
      .then(setUsbArchives)
      .catch(() => setUsbArchives([]));
  }, [source, usbConfigured, usbArchives]);

  const localAvailable = (history?.some((h) => h.status === "success") ?? false) ||
    (appRuns?.some((r) => r.status === "success") ?? false);

  function reset() {
    setStep(1);
    setSource(null);
    setSelected(null);
    setError(null);
    setRestored(false);
  }

  async function doRestore() {
    if (!selected) return;
    setRestoring(true);
    setError(null);
    try {
      if (selected.kind === "generic") {
        if (selected.run.sourceType === "db") {
          await apiJson("/dbbackup/restore-by-run", {
            method: "POST",
            body: JSON.stringify({ runId: selected.run.runId, confirm: true }),
          });
        } else if (selected.run.sourceType === "image") {
          await apiJson("/backups/restore-image", {
            method: "POST",
            body: JSON.stringify({ runId: selected.run.runId, confirm: true }),
          });
        } else {
          await apiJson("/backups/restore", {
            method: "POST",
            body: JSON.stringify({
              runId: selected.run.runId,
              targetVolume: selected.run.sourceType === "volume" ? selected.run.sourceRef : undefined,
              confirm: true,
            }),
          });
        }
      } else if (selected.kind === "app") {
        await apiJson(`/applications/${selected.appId}/restore`, {
          method: "POST",
          body: JSON.stringify({ runId: selected.run.runId, confirm: true }),
        });
      } else {
        await apiJson(`/applications/${selected.appId}/restore-image`, {
          method: "POST",
          body: JSON.stringify({ containerName: selected.containerName, runId: selected.run.runId, confirm: true }),
        });
      }
      setRestored(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {step > 1 && !restored && (
        <button
          type="button"
          onClick={() => setStep((s) => ((s - 1) as 1 | 2 | 3))}
          className="flex items-center gap-1 self-start text-sm text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Retour
        </button>
      )}

      {error && <Card className="text-sm text-destructive">{error}</Card>}

      {step === 1 && (
        <StepSource
          localAvailable={localAvailable}
          usbAvailable={usbConfigured}
          gdriveAuthorized={gdriveAuthorized}
          onSelect={(s) => {
            setSource(s);
            if (s !== "upload") setStep(2);
          }}
          onUploaded={(result, sourceType, sourceRef) => {
            setSelected({
              kind: "generic",
              run: {
                runId: result.runId,
                jobId: null,
                type: "backup",
                sourceType,
                sourceRef,
                target: "local",
                driveFileId: null,
                usbPath: null,
                status: "success",
                sizeBytes: result.sizeBytes,
                checksumSha256: null,
                durationMs: null,
                error: null,
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
              },
            });
            setStep(3);
          }}
        />
      )}

      {step === 2 && source === "local" && (
        <StepLocal
          history={history ?? []}
          apps={apps ?? []}
          appRuns={appRuns ?? []}
          onSelect={(item) => {
            setSelected(item);
            setStep(3);
          }}
        />
      )}

      {step === 2 && source === "usb" && (
        <StepUsb
          archives={usbArchives}
          onSelect={async (archive) => {
            setError(null);
            try {
              const { runId } = await apiJson<{ runId: string }>("/backups/usb/archives/import", {
                method: "POST",
                body: JSON.stringify({ fullPath: archive.fullPath }),
              });
              const sourceType = archive.category === "volumes" ? "volume" : archive.category === "db" ? "db" : "path";
              setSelected({
                kind: "generic",
                run: {
                  runId,
                  jobId: null,
                  type: "backup",
                  sourceType,
                  sourceRef: archive.sourceRef,
                  target: "usb",
                  driveFileId: null,
                  usbPath: archive.fullPath,
                  status: "success",
                  sizeBytes: archive.sizeBytes,
                  checksumSha256: null,
                  durationMs: null,
                  error: null,
                  startedAt: archive.modifiedAt,
                  finishedAt: archive.modifiedAt,
                },
              });
              setStep(3);
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        />
      )}

      {step === 2 && source === "gdrive" && (
        <StepGDrive
          history={(history ?? []).filter((h) => h.driveFileId != null)}
          onSelect={(item) => {
            setSelected(item);
            setStep(3);
          }}
        />
      )}

      {step === 3 && selected && (
        <StepConfirm
          selected={selected}
          restoring={restoring}
          restored={restored}
          onRestore={doRestore}
          onReset={reset}
        />
      )}
    </div>
  );
}

function StepSource({
  localAvailable,
  usbAvailable,
  gdriveAuthorized,
  onSelect,
  onUploaded,
}: {
  localAvailable: boolean;
  usbAvailable: boolean;
  gdriveAuthorized: boolean;
  onSelect: (source: Source) => void;
  onUploaded: (result: BackupUploadResult, sourceType: BackupUploadSourceKind, sourceRef: string) => void;
}) {
  const [showUpload, setShowUpload] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Étape 1 — Choisissez la source de la sauvegarde à restaurer.</p>
      <div className="grid grid-cols-2 gap-3">
        <SourceTile
          icon={HardDrive}
          label="Local"
          enabled={localAvailable}
          disabledReason="Aucune sauvegarde locale"
          onClick={() => onSelect("local")}
        />
        <SourceTile
          icon={Usb}
          label="USB"
          enabled={usbAvailable}
          disabledReason="Aucun disque USB connecté"
          onClick={() => onSelect("usb")}
        />
        <SourceTile
          icon={Cloud}
          label="Google Drive"
          enabled={gdriveAuthorized}
          disabledReason="Google Drive non connecté"
          onClick={() => onSelect("gdrive")}
        />
        <SourceTile icon={Upload} label="Téléverser" enabled onClick={() => setShowUpload(true)} />
      </div>

      {showUpload && <UploadForm onCancel={() => setShowUpload(false)} onUploaded={onUploaded} />}
    </div>
  );
}

function SourceTile({
  icon: Icon,
  label,
  enabled,
  disabledReason,
  onClick,
}: {
  icon: typeof HardDrive;
  label: string;
  enabled: boolean;
  disabledReason?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={onClick}
      className={`flex flex-col items-center gap-2 rounded-lg border p-6 text-center transition-colors ${
        enabled
          ? "border-border bg-background hover:border-primary hover:bg-primary/5"
          : "cursor-not-allowed border-border/50 bg-muted/30 text-muted-foreground"
      }`}
    >
      <Icon className={`h-8 w-8 ${enabled ? "text-primary" : "text-muted-foreground"}`} />
      <span className="text-sm font-medium">{label}</span>
      {!enabled && disabledReason && <span className="text-xs text-muted-foreground">{disabledReason}</span>}
    </button>
  );
}

function UploadForm({
  onCancel,
  onUploaded,
}: {
  onCancel: () => void;
  onUploaded: (result: BackupUploadResult, sourceType: BackupUploadSourceKind, sourceRef: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [sourceType, setSourceType] = useState<BackupUploadSourceKind>("volume");
  const [sourceRef, setSourceRef] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !sourceRef.trim()) {
      setError("Fichier et référence source requis");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("sourceType", sourceType);
      form.append("sourceRef", sourceRef.trim());
      const res = await apiFetch("/backups/uploads", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "unknown_error" }));
        throw new Error(body.error ?? `Échec de l'upload (${res.status})`);
      }
      const result = (await res.json()) as BackupUploadResult;
      onUploaded(result, sourceType, sourceRef.trim());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardTitle className="flex items-center gap-1">
        <Upload className="h-4 w-4" /> Téléverser une sauvegarde
      </CardTitle>
      <form onSubmit={submit} className="mt-2 flex flex-col gap-2">
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
        />
        <select
          value={sourceType}
          onChange={(e) => setSourceType(e.target.value as BackupUploadSourceKind)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
        >
          <option value="volume">volume Docker</option>
          <option value="path">dossier (bind mount)</option>
          <option value="db">base de données</option>
        </select>
        <input
          type="text"
          placeholder={
            sourceType === "volume"
              ? "Nom du volume cible"
              : sourceType === "path"
                ? "Chemin cible"
                : "Référence (location:ref, ex: docker:ima-postgres)"
          }
          value={sourceRef}
          onChange={(e) => setSourceRef(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={uploading}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Téléverser"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Annuler
          </Button>
        </div>
      </form>
    </Card>
  );
}

function StepLocal({
  history,
  apps,
  appRuns,
  onSelect,
}: {
  history: BackupHistoryEntry[];
  apps: Application[];
  appRuns: AppBackupRun[];
  onSelect: (item: SelectedItem) => void;
}) {
  const appById = useMemo(() => new Map(apps.map((a) => [a.id, a])), [apps]);
  const successfulHistory = history.filter((h) => h.status === "success");
  const dbBackups = successfulHistory.filter((h) => h.sourceType === "db");
  const volumeBackups = successfulHistory.filter((h) => h.sourceType === "volume");
  const pathBackups = successfulHistory.filter((h) => h.sourceType === "path");
  const successfulAppRuns = appRuns.filter((r) => r.status === "success");
  const fullAppRuns = successfulAppRuns.filter((r) => r.kind === "full");
  const partialAppRuns = successfulAppRuns.filter((r) => r.kind === "partial");

  const hasAnything = successfulHistory.length > 0 || successfulAppRuns.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Étape 2 — Choisissez l'élément à restaurer.</p>

      <GenericGroup title="Bases de données" icon={Database} items={dbBackups} onSelect={onSelect} />
      <GenericGroup title="Volumes Docker" icon={Boxes} items={volumeBackups} onSelect={onSelect} />
      <GenericGroup title="Dossiers (chemins)" icon={HardDrive} items={pathBackups} onSelect={onSelect} />

      {fullAppRuns.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
            <Boxes className="h-3.5 w-3.5" /> Applications — backup complet
          </p>
          <div className="flex flex-col gap-2">
            {fullAppRuns.map((r) => {
              const app = appById.get(r.appId);
              if (!app) return null;
              return (
                <button
                  key={r.runId}
                  type="button"
                  onClick={() => onSelect({ kind: "app", appId: r.appId, appName: app.name, run: r })}
                  className="rounded-md border border-border p-2 text-left text-sm hover:bg-muted"
                >
                  <p className="font-medium">{app.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(r.startedAt).toLocaleString()}
                    {r.sizeBytes != null ? ` · ${formatBytes(r.sizeBytes)}` : ""}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {partialAppRuns.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
            <Boxes className="h-3.5 w-3.5" /> Applications — backup partiel
          </p>
          <div className="flex flex-col gap-2">
            {partialAppRuns.map((r) => {
              const app = appById.get(r.appId);
              if (!app) return null;
              return (
                <button
                  key={r.runId}
                  type="button"
                  onClick={() => onSelect({ kind: "app", appId: r.appId, appName: app.name, run: r })}
                  className="rounded-md border border-border p-2 text-left text-sm hover:bg-muted"
                >
                  <p className="font-medium">{app.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(r.startedAt).toLocaleString()}
                    {r.sizeBytes != null ? ` · ${formatBytes(r.sizeBytes)}` : ""}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {apps.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
            <Container className="h-3.5 w-3.5" /> Images de conteneur sauvegardées
          </p>
          {apps.map((app) => (
            <AppImagePicker key={app.id} app={app} onSelect={onSelect} />
          ))}
        </div>
      )}

      {!hasAnything && <p className="text-sm text-muted-foreground">Aucune sauvegarde locale disponible.</p>}
    </div>
  );
}

function GenericGroup({
  title,
  icon: Icon,
  items,
  onSelect,
}: {
  title: string;
  icon: typeof HardDrive;
  items: BackupHistoryEntry[];
  onSelect: (item: SelectedItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {title}
      </p>
      <div className="flex flex-col gap-2">
        {items.map((h) => (
          <button
            key={h.runId}
            type="button"
            onClick={() => onSelect({ kind: "generic", run: h })}
            className="rounded-md border border-border p-2 text-left text-sm hover:bg-muted"
          >
            <p className="font-medium">{h.sourceRef}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(h.startedAt).toLocaleString()}
              {h.sizeBytes != null ? ` · ${formatBytes(h.sizeBytes)}` : ""}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function AppImagePicker({
  app,
  onSelect,
}: {
  app: Application;
  onSelect: (item: SelectedItem) => void;
}) {
  const [historyByContainer, setHistoryByContainer] = useState<Record<string, BackupHistoryEntry[]>>({});

  useEffect(() => {
    Promise.all(
      app.containerNames.map((name) =>
        apiJson<BackupHistoryEntry[]>(`/backups/images/${encodeURIComponent(name)}/history`).then(
          (rows) => [name, rows.filter((r) => r.status === "success")] as const
        )
      )
    )
      .then((entries) => setHistoryByContainer(Object.fromEntries(entries)))
      .catch(() => {});
  }, [app.containerNames.join(",")]);

  const hasAny = Object.values(historyByContainer).some((rows) => rows.length > 0);
  if (!hasAny) return null;

  return (
    <div className="mb-2">
      {app.containerNames.map((name) => {
        const rows = historyByContainer[name] ?? [];
        if (rows.length === 0) return null;
        return (
          <div key={name} className="mb-1">
            <p className="text-xs font-medium">
              {app.name} / {name}
            </p>
            <div className="mt-1 flex flex-col gap-1">
              {rows.map((run) => (
                <button
                  key={run.runId}
                  type="button"
                  onClick={() => onSelect({ kind: "app-image", appId: app.id, containerName: name, run })}
                  className="rounded-md border border-border p-2 text-left text-xs hover:bg-muted"
                >
                  {new Date(run.startedAt).toLocaleString()}
                  {run.sizeBytes != null ? ` · ${formatBytes(run.sizeBytes)}` : ""}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Groups a flat USB archive list into named sections — a raw flat list mixes
 * DB dumps, full app image exports, and volume/path snapshots together,
 * which is hard to scan once there's more than a handful of entries. */
function StepUsb({
  archives,
  onSelect,
}: {
  archives: UsbBackupArchive[] | null;
  onSelect: (archive: UsbBackupArchive) => void;
}) {
  const groups = useMemo(() => {
    if (!archives) return null;
    const db: UsbBackupArchive[] = [];
    const images: UsbBackupArchive[] = [];
    const volumes: UsbBackupArchive[] = [];
    const paths: UsbBackupArchive[] = [];
    for (const a of archives) {
      if (a.category === "db") db.push(a);
      else if (a.category === "volumes") volumes.push(a);
      else if (a.sourceRef.startsWith("image-")) images.push(a);
      else paths.push(a);
    }
    const byDateDesc = (list: UsbBackupArchive[]) => [...list].sort((x, y) => y.modifiedAt.localeCompare(x.modifiedAt));
    return {
      db: byDateDesc(db),
      images: byDateDesc(images),
      volumes: byDateDesc(volumes),
      paths: byDateDesc(paths),
    };
  }, [archives]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Étape 2 — Archives présentes sur le disque USB.</p>
      {!groups && <p className="text-sm text-muted-foreground">Chargement…</p>}
      {groups && archives?.length === 0 && (
        <p className="text-sm text-muted-foreground">Aucune archive trouvée sur le disque.</p>
      )}
      {groups && (
        <>
          <ArchiveGroup title="Bases de données" icon={Database} archives={groups.db} onSelect={onSelect} />
          <ArchiveGroup title="Images de conteneur" icon={Container} archives={groups.images} onSelect={onSelect} />
          <ArchiveGroup title="Volumes Docker" icon={Boxes} archives={groups.volumes} onSelect={onSelect} />
          <ArchiveGroup title="Dossiers (chemins)" icon={HardDrive} archives={groups.paths} onSelect={onSelect} />
        </>
      )}
    </div>
  );
}

function ArchiveGroup({
  title,
  icon: Icon,
  archives,
  onSelect,
}: {
  title: string;
  icon: typeof HardDrive;
  archives: UsbBackupArchive[];
  onSelect: (archive: UsbBackupArchive) => void;
}) {
  if (archives.length === 0) return null;
  return (
    <div>
      <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {title}
      </p>
      <div className="flex flex-col gap-2">
        {archives.map((a) => (
          <button
            key={a.fullPath}
            type="button"
            onClick={() => onSelect(a)}
            className="rounded-md border border-border p-2 text-left text-sm hover:bg-muted"
          >
            <p className="font-medium">{a.sourceRef.replace(/^image-/, "")}</p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(a.sizeBytes)} · {new Date(a.modifiedAt).toLocaleString()}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function StepGDrive({
  history,
  onSelect,
}: {
  history: BackupHistoryEntry[];
  onSelect: (item: SelectedItem) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">Étape 2 — Sauvegardes envoyées sur Google Drive.</p>
      <p className="text-xs text-muted-foreground">
        La restauration utilise le fichier local associé à cette sauvegarde — si le fichier local n'existe plus,
        la restauration échouera (un téléchargement direct depuis Drive n'est pas encore pris en charge).
      </p>
      {history.length === 0 && <p className="text-sm text-muted-foreground">Aucune sauvegarde Drive disponible.</p>}
      {history.map((h) => (
        <button
          key={h.runId}
          type="button"
          onClick={() => onSelect({ kind: "generic", run: h })}
          className="rounded-md border border-border p-2 text-left text-sm hover:bg-muted"
        >
          <p className="font-medium">
            {h.sourceType}:{h.sourceRef}
          </p>
          <p className="text-xs text-muted-foreground">
            {new Date(h.startedAt).toLocaleString()}
            {h.sizeBytes != null ? ` · ${formatBytes(h.sizeBytes)}` : ""}
          </p>
        </button>
      ))}
    </div>
  );
}

function StepConfirm({
  selected,
  restoring,
  restored,
  onRestore,
  onReset,
}: {
  selected: SelectedItem;
  restoring: boolean;
  restored: boolean;
  onRestore: () => void;
  onReset: () => void;
}) {
  const summary =
    selected.kind === "generic"
      ? `${selected.run.sourceType}:${selected.run.sourceRef}`
      : selected.kind === "app"
        ? `${selected.appName} · ${selected.run.kind === "full" ? "backup complet" : "backup partiel"}`
        : `Image de conteneur : ${selected.containerName}`;
  const startedAt = selected.run.startedAt;
  const sizeBytes = selected.run.sizeBytes;

  if (restored) {
    return (
      <Card>
        <p className="flex items-center gap-1 text-sm text-primary">
          <CheckCircle2 className="h-4 w-4" /> Restauration effectuée avec succès.
        </p>
        <Button size="sm" variant="outline" className="mt-3" onClick={onReset}>
          Nouvelle restauration
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>Étape 3 — Confirmation</CardTitle>
      <div className="mt-2 flex flex-col gap-1 text-sm">
        <p>Source : {summary}</p>
        <p className="text-xs text-muted-foreground">
          {new Date(startedAt).toLocaleString()}
          {sizeBytes != null ? ` · ${formatBytes(sizeBytes)}` : ""}
        </p>
      </div>
      <ConfirmDialog
        trigger={
          <Button size="sm" variant="destructive" className="mt-3" disabled={restoring}>
            {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Restaurer"}
          </Button>
        }
        title="Restaurer cette sauvegarde ?"
        description="Cette opération va écraser les données existantes de la cible. Action irréversible."
        requireTypedConfirmation="RESTORE"
        confirmLabel="Restaurer"
        onConfirm={onRestore}
      />
    </Card>
  );
}
