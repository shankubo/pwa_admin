import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import type {
  Application,
  AppBackupRun,
  BackupHistoryEntry,
  UsbStatus,
  UsbBackupArchive,
  BackupUploadResult,
  BackupUploadSourceKind,
  GDriveComparisonResult,
  MigrationManifest,
  MigrationRestoreRun,
  MigrationRestorePlan,
  MigrationManifestFileList,
  WsServerFrame,
} from "@pwa-admin/shared";
import { apiJson, apiFetch } from "@/lib/api";
import { useWsChannel } from "@/lib/ws";
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
  XCircle,
  Loader2,
  Shuffle,
  ChevronDown,
  ChevronUp,
  FileText,
  Download,
} from "lucide-react";

type SelectedItem =
  | { kind: "generic"; run: BackupHistoryEntry }
  | { kind: "app"; appId: number; appName: string; run: AppBackupRun }
  | { kind: "app-image"; appId: number; containerName: string; run: BackupHistoryEntry }
  | { kind: "migration"; manifest: MigrationManifest };

type Source = "local" | "usb" | "gdrive" | "upload" | "migration";

export function Restore() {
  const location = useLocation();
  const preselectedManifestId = (location.state as { manifestId?: string } | null)?.manifestId ?? null;
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
  const [migrationManifests, setMigrationManifests] = useState<MigrationManifest[] | null>(null);

  useEffect(() => {
    apiJson<BackupHistoryEntry[]>("/backups/history?limit=100&offset=0").then(setHistory).catch(() => setHistory([]));
    apiJson<UsbStatus>("/backups/usb/status").then(setUsbStatus).catch(() => setUsbStatus(null));
    apiJson<{ authorized: boolean }>("/backups/gdrive/status")
      .then((s) => setGdriveAuthorized(s.authorized))
      .catch(() => setGdriveAuthorized(false));
    apiJson<Application[]>("/applications").then(setApps).catch(() => setApps([]));
    apiJson<AppBackupRun[]>("/applications/runs/all").then(setAppRuns).catch(() => setAppRuns([]));
    apiJson<MigrationManifest[]>("/migration/manifests").then(setMigrationManifests).catch(() => setMigrationManifests([]));
  }, []);

  const usbConfigured = usbStatus?.drives.some((d) => d.isBackupConfigured) ?? false;

  // Deep-link from "Disque externe USB" — double-clicking a manifest.json
  // there navigates here with { manifestId } in router state so the admin
  // lands straight on the confirmation screen instead of re-walking Steps
  // 1-2, even for a manifest captured under a DIFFERENT hostname than this
  // server's own (see MigrationService.listManifestsOnUsb's cross-hostname scan).
  useEffect(() => {
    if (!preselectedManifestId || !migrationManifests) return;
    const manifest = migrationManifests.find((m) => m.manifestId === preselectedManifestId);
    if (manifest) {
      setSource("migration");
      setSelected({ kind: "migration", manifest });
      setStep(3);
    }
  }, [preselectedManifestId, migrationManifests]);

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
    if (!selected || selected.kind === "migration") return;
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
          migrationAvailable={usbConfigured && (migrationManifests?.length ?? 0) > 0}
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
          onError={setError}
        />
      )}

      {step === 2 && source === "migration" && (
        <StepMigration
          manifests={migrationManifests ?? []}
          currentHostname={usbStatus?.hostname ?? null}
          onSelect={(manifest) => {
            setSelected({ kind: "migration", manifest });
            setStep(3);
          }}
        />
      )}

      {step === 3 && selected && selected.kind === "migration" && (
        <StepMigrationConfirm manifest={selected.manifest} onReset={reset} />
      )}

      {step === 3 && selected && selected.kind !== "migration" && (
        <StepConfirm
          selected={selected}
          source={source}
          usbConfigured={usbConfigured}
          gdriveAuthorized={gdriveAuthorized}
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
  migrationAvailable,
  onSelect,
  onUploaded,
}: {
  localAvailable: boolean;
  usbAvailable: boolean;
  gdriveAuthorized: boolean;
  migrationAvailable: boolean;
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
          description="Restaurer à partir d'une sauvegarde déjà présente sur ce serveur."
          enabled={localAvailable}
          disabledReason="Aucune sauvegarde locale"
          onClick={() => onSelect("local")}
        />
        <SourceTile
          icon={Usb}
          label="USB"
          description="Restaurer depuis un disque externe branché (la sauvegarde doit se trouver dans BACKUP/<nom du serveur>/... sur ce disque)."
          enabled={usbAvailable}
          disabledReason="Aucun disque USB connecté"
          onClick={() => onSelect("usb")}
        />
        <SourceTile
          icon={Cloud}
          label="Google Drive"
          description="Si Google Drive est connecté, la sauvegarde est d'abord téléchargée automatiquement sur ce serveur, puis restaurée."
          enabled={gdriveAuthorized}
          disabledReason="Google Drive non connecté"
          onClick={() => onSelect("gdrive")}
        />
        <SourceTile
          icon={Upload}
          label="Téléverser"
          description="Envoyer un fichier de sauvegarde depuis votre appareil (PC/téléphone) vers ce serveur, puis le restaurer directement."
          enabled
          onClick={() => setShowUpload(true)}
        />
        <SourceTile
          icon={Shuffle}
          label="Migration serveur"
          description="Restaurer un instantané complet capturé depuis un disque externe (USB) : sites, données et paquets système sont réinstallés à l'identique — pour remplacer ou reconstruire un serveur."
          enabled={migrationAvailable}
          disabledReason="Aucun instantané de migration sur le disque USB"
          onClick={() => onSelect("migration")}
        />
      </div>

      {showUpload && <UploadForm onCancel={() => setShowUpload(false)} onUploaded={onUploaded} />}
    </div>
  );
}

function SourceTile({
  icon: Icon,
  label,
  description,
  enabled,
  disabledReason,
  onClick,
}: {
  icon: typeof HardDrive;
  label: string;
  description: string;
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
      <span className="text-xs text-muted-foreground">{enabled ? description : disabledReason ?? description}</span>
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
  onError,
}: {
  history: BackupHistoryEntry[];
  onSelect: (item: SelectedItem) => void;
  onError: (message: string) => void;
}) {
  const [comparison, setComparison] = useState<GDriveComparisonResult | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    apiJson<GDriveComparisonResult>("/backups/gdrive/compare")
      .then(setComparison)
      .catch(() => setComparison(null));
  }, []);

  // Only volumes/db/paths are downloadable here — "apps" backups restore
  // through a separate, more involved flow (ApplicationService) not covered
  // by the plain local-file restore path this wizard uses.
  const downloadableGroups = (comparison?.orphanGroups ?? []).filter((g) => g.category !== "apps");

  async function downloadAndSelect(fileId: string, category: string, sourceRef: string) {
    setDownloadingId(fileId);
    try {
      const { runId } = await apiJson<{ runId: string }>(`/backups/gdrive/files/${fileId}/download`, {
        method: "POST",
      });
      const sourceType: BackupHistoryEntry["sourceType"] =
        category === "volumes" ? "volume" : category === "db" ? "db" : "path";
      onSelect({
        kind: "generic",
        run: {
          runId,
          jobId: null,
          type: "backup",
          sourceType,
          sourceRef,
          target: "gdrive",
          driveFileId: fileId,
          usbPath: null,
          status: "success",
          sizeBytes: null,
          checksumSha256: null,
          durationMs: null,
          error: null,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">Étape 2 — Sauvegardes envoyées sur Google Drive.</p>

      {history.length === 0 && downloadableGroups.length === 0 && (
        <p className="text-sm text-muted-foreground">Aucune sauvegarde Drive disponible.</p>
      )}

      {history.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">
            Présentes localement — restauration immédiate à partir du fichier déjà sur ce serveur.
          </p>
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
        </>
      )}

      {downloadableGroups.length > 0 && (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            Présentes uniquement sur Drive — téléchargez-les sur ce serveur avant de pouvoir les restaurer.
          </p>
          {downloadableGroups.map((group) =>
            group.files.map((f) => (
              <div key={f.fileId} className="rounded-md border border-border p-2 text-sm">
                <p className="font-medium">
                  {group.category}:{group.sourceRef}
                </p>
                <p className="text-xs text-muted-foreground">
                  {f.fileName} · {formatBytes(f.sizeBytes)} · {new Date(f.modifiedAt).toLocaleString()}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={downloadingId === f.fileId}
                  onClick={() => downloadAndSelect(f.fileId, group.category, group.sourceRef)}
                >
                  {downloadingId === f.fileId ? "Téléchargement…" : "Télécharger et restaurer"}
                </Button>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}

function StepConfirm({
  selected,
  source,
  usbConfigured,
  gdriveAuthorized,
  restoring,
  restored,
  onRestore,
  onReset,
}: {
  selected: Exclude<SelectedItem, { kind: "migration" }>;
  source: Source | null;
  usbConfigured: boolean;
  gdriveAuthorized: boolean;
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

      {source === "local" && selected.kind === "generic" && (
        <LocalRunActions run={selected.run} usbConfigured={usbConfigured} gdriveAuthorized={gdriveAuthorized} />
      )}

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

/**
 * Extra actions only meaningful for a LOCAL source: the backup already lives
 * on this server's disk, so it can also be pushed to USB / Google Drive
 * after the fact, or pulled straight down to the admin's own PC — none of
 * which apply when the selection already came FROM usb/gdrive/upload (those
 * flows have their own "already there" semantics).
 */
function LocalRunActions({
  run,
  usbConfigured,
  gdriveAuthorized,
}: {
  run: BackupHistoryEntry;
  usbConfigured: boolean;
  gdriveAuthorized: boolean;
}) {
  const [usbPath, setUsbPath] = useState(run.usbPath);
  const [driveFileId, setDriveFileId] = useState(run.driveFileId);
  const [busy, setBusy] = useState<"usb" | "gdrive" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function copyToUsb() {
    setBusy("usb");
    setError(null);
    try {
      const result = await apiJson<{ usbPath: string }>(`/backups/history/${run.runId}/copy-to-usb`, {
        method: "POST",
      });
      setUsbPath(result.usbPath);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function copyToGDrive() {
    setBusy("gdrive");
    setError(null);
    try {
      const result = await apiJson<{ driveFileId: string }>(`/backups/history/${run.runId}/copy-to-gdrive`, {
        method: "POST",
      });
      setDriveFileId(result.driveFileId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function downloadLocal() {
    setBusy("download");
    setError(null);
    try {
      const { token } = await apiJson<{ token: string }>(`/backups/history/${run.runId}/download-token`, {
        method: "POST",
      });
      window.location.href = `/api/backups/history/${run.runId}/download?token=${encodeURIComponent(token)}`;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
      <p className="text-xs font-medium text-muted-foreground">Autres actions sur cette sauvegarde locale</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={downloadLocal}>
          {busy === "download" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Télécharger
        </Button>
        {usbPath ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-xs text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" /> Déjà sur USB
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={!usbConfigured || busy !== null}
            title={usbConfigured ? "Copier vers le disque USB de sauvegarde" : "Aucun disque USB de sauvegarde configuré"}
            onClick={copyToUsb}
          >
            {busy === "usb" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Usb className="h-3.5 w-3.5" />}
            Envoyer sur USB
          </Button>
        )}
        {driveFileId ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-xs text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" /> Déjà sur Google Drive
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={!gdriveAuthorized || busy !== null}
            title={gdriveAuthorized ? "Envoyer vers Google Drive" : "Google Drive non connecté (voir Settings)"}
            onClick={copyToGDrive}
          >
            {busy === "gdrive" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
            Envoyer sur Drive
          </Button>
        )}
      </div>
    </div>
  );
}

/** Sanitized the same way MigrationService's USB folder scan derives a
 * hostname slug from BACKUP/<slug>/ (see sanitizeSegment on the API side) —
 * manifest.hostname itself is the raw os.hostname() at capture time, so this
 * must match it the same way before comparing against currentHostname (the
 * already-sanitized slug from GET /backups/usb/status). */
function hostnameSlug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function StepMigration({
  manifests,
  currentHostname,
  onSelect,
}: {
  manifests: MigrationManifest[];
  currentHostname: string | null;
  onSelect: (manifest: MigrationManifest) => void;
}) {
  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const byHost = new Map<string, MigrationManifest[]>();
    for (const m of manifests) {
      const slug = hostnameSlug(m.hostname);
      if (!byHost.has(slug)) byHost.set(slug, []);
      byHost.get(slug)!.push(m);
    }
    const ownHost = currentHostname && byHost.has(currentHostname) ? currentHostname : null;
    const ownManifests = ownHost ? byHost.get(ownHost)! : [];
    const otherGroups = [...byHost.entries()]
      .filter(([slug]) => slug !== ownHost)
      .sort((a, b) => a[0].localeCompare(b[0]));
    return { ownHost, ownManifests, otherGroups };
  }, [manifests, currentHostname]);

  function toggleHost(slug: string) {
    setExpandedHosts((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Étape 2 — Instantanés de migration disponibles sur le disque USB.
      </p>
      {manifests.length === 0 && (
        <p className="text-sm text-muted-foreground">Aucun instantané de migration trouvé.</p>
      )}

      {groups.ownManifests.length > 0 && (
        <div className="flex flex-col gap-2">
          {groups.ownManifests.map((m) => (
            <ManifestTile key={m.manifestId} manifest={m} onSelect={onSelect} />
          ))}
        </div>
      )}

      {manifests.length > 0 && groups.ownManifests.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Aucun instantané pour ce serveur ({currentHostname ?? "hôte inconnu"}) — voir les autres machines ci-dessous.
        </p>
      )}

      {groups.otherGroups.map(([slug, hostManifests]) => {
        const expanded = expandedHosts.has(slug);
        return (
          <div key={slug} className="flex flex-col gap-2">
            <Button size="sm" variant="outline" className="self-start" onClick={() => toggleHost(slug)}>
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              Autres — {slug} ({hostManifests.length})
            </Button>
            {expanded && (
              <div className="ml-2 flex flex-col gap-2 border-l border-border pl-3">
                {hostManifests.map((m) => (
                  <ManifestTile key={m.manifestId} manifest={m} onSelect={onSelect} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ManifestTile({ manifest: m, onSelect }: { manifest: MigrationManifest; onSelect: (manifest: MigrationManifest) => void }) {
  const successCount = m.items.filter((i) => i.status === "success").length;
  return (
    <button
      type="button"
      onClick={() => onSelect(m)}
      className="rounded-md border border-border p-3 text-left text-sm hover:bg-muted"
    >
      <p className="flex items-center gap-2 font-medium">
        <Shuffle className="h-4 w-4 text-primary" />
        {m.scope.type === "site" ? `Site : ${m.scope.siteName}` : `Serveur complet (${m.hostname})`}
      </p>
      <p className="text-xs text-muted-foreground">
        {new Date(m.createdAt).toLocaleString()} · {successCount}/{m.items.length} éléments capturés ·{" "}
        {m.osDistro} {m.osRelease}
      </p>
    </button>
  );
}

async function downloadManifestFile(manifestId: string, fileId: string) {
  const { token } = await apiJson<{ token: string }>(`/migration/manifests/${manifestId}/files/download-token`, {
    method: "POST",
    body: JSON.stringify({ fileId }),
  });
  window.location.href = `/api/migration/manifests/${manifestId}/files/download?token=${encodeURIComponent(token)}`;
}

/** Read-only export view for a migration manifest — lets the admin see and
 * download the exact archives an automated restore would use, for a manual
 * SSH-based install instead. Never mutates anything. */
function MigrationFileListPanel({ manifestId }: { manifestId: string }) {
  const [list, setList] = useState<MigrationManifestFileList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setList(null);
    setError(null);
    apiJson<MigrationManifestFileList>(`/migration/manifests/${manifestId}/files`)
      .then(setList)
      .catch((err) => setError((err as Error).message));
  }, [manifestId]);

  return (
    <div className="mt-2 rounded-md border border-border p-3">
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!list && !error && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement…
        </p>
      )}
      {list && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Tous ces fichiers se trouvent déjà ensemble dans le même dossier sur le disque USB — pour une
            installation manuelle complète, copiez-le directement (<code className="font-mono">scp -r</code> ou
            disque monté) :
          </p>
          <p className="break-all rounded-md bg-muted p-2 font-mono text-[11px]">{list.usbRoot}</p>
          {list.files.length === 0 && <p className="text-xs text-muted-foreground">Aucun fichier disponible.</p>}
          {list.files.length > 0 && (
            <div className="flex flex-col gap-1">
              {list.files.map((f) => (
                <div
                  key={f.fileId}
                  className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{f.label}</p>
                    {f.destinationPath && <p className="truncate text-muted-foreground">→ {f.destinationPath}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {f.sizeBytes != null && <span className="text-muted-foreground">{formatBytes(f.sizeBytes)}</span>}
                    <Button size="sm" variant="outline" onClick={() => downloadManifestFile(manifestId, f.fileId)}>
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepMigrationConfirm({ manifest, onReset }: { manifest: MigrationManifest; onReset: () => void }) {
  const [includeOsPackages, setIncludeOsPackages] = useState(false);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [run, setRun] = useState<MigrationRestoreRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<MigrationRestorePlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  // Per-item and per-package opt-out — everything is selected by default
  // (preserves the previous "restore everything" behavior), the admin
  // unchecks specific lines/packages they don't want touched this run.
  const [uncheckedLabels, setUncheckedLabels] = useState<Set<string>>(new Set());
  const [uncheckedPackages, setUncheckedPackages] = useState<Set<string>>(new Set());
  // Independent of the plan/checkbox state above — a purely read-only export
  // view, never touches what gets restored.
  const [showFiles, setShowFiles] = useState(false);

  // Pre-flight, read-only: shows exactly what the restore is about to do
  // (installer/mettre à jour/ignorer par paquet, remplacer/ignorer par
  // élément) BEFORE anything is touched — refetched whenever the manifest
  // changes, never triggered by the restore itself.
  useEffect(() => {
    setPlan(null);
    setPlanError(null);
    setUncheckedLabels(new Set());
    setUncheckedPackages(new Set());
    apiJson<MigrationRestorePlan>(`/migration/restore/plan/${manifest.manifestId}`)
      .then(setPlan)
      .catch((err) => setPlanError((err as Error).message));
  }, [manifest.manifestId]);

  function toggleLabel(label: string) {
    setUncheckedLabels((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function togglePackage(name: string) {
    setUncheckedPackages((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  useWsChannel(
    "migration.restore",
    (frame: WsServerFrame) => {
      const data = frame.data as { items?: MigrationRestoreRun["items"]; done?: boolean; status?: string };
      if (data.items) {
        setRun((prev) => (prev ? { ...prev, items: data.items! } : prev));
      }
      if (data.done) {
        setRun((prev) =>
          prev ? { ...prev, status: (data.status as MigrationRestoreRun["status"]) ?? prev.status } : prev
        );
      }
    },
    restoreId ? { restoreId } : undefined
  );

  // Polling fallback alongside the WS subscription above (same pattern as
  // MigrationSnapshotCard in Backups.tsx) — the server can start publishing
  // progress before the browser's WebSocket has finished (re)connecting and
  // subscribing, and wsHub has no frame replay for late subscribers, so a
  // restore that finishes in that gap would otherwise leave this screen
  // stuck on "en cours" forever with no way to recover.
  const runStatus = run?.status;
  useEffect(() => {
    if (!restoreId || (runStatus && runStatus !== "running" && runStatus !== "pending")) return;
    const interval = setInterval(async () => {
      try {
        const latest = await apiJson<MigrationRestoreRun>(`/migration/restore/${restoreId}`);
        setRun(latest);
      } catch {
        // transient fetch failure — next tick retries, WS may also still deliver
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [restoreId, runStatus]);

  const hasOsPackagesItem = manifest.items.some((i) => i.category === "os-packages" && i.status === "success");

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const excludedLabels = [...uncheckedLabels];
      const selectedPackageNames = includeOsPackages
        ? (plan?.packages ?? []).filter((p) => !uncheckedPackages.has(p.name)).map((p) => p.name)
        : undefined;
      const result = await apiJson<{ restoreId: string }>("/migration/restore", {
        method: "POST",
        body: JSON.stringify({
          manifestId: manifest.manifestId,
          includeOsPackages,
          excludedLabels,
          selectedPackageNames,
          confirm: true,
        }),
      });
      setRestoreId(result.restoreId);
      setRun({
        restoreId: result.restoreId,
        manifestId: manifest.manifestId,
        status: "running",
        includeOsPackages,
        items: [],
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }

  if (run && (run.status === "success" || run.status === "partial" || run.status === "failed")) {
    return (
      <Card>
        <p
          className={`flex items-center gap-1 text-sm ${
            run.status === "success" ? "text-primary" : run.status === "partial" ? "text-warning" : "text-destructive"
          }`}
        >
          {run.status === "success" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : run.status === "partial" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          {run.status === "success"
            ? "Restauration terminée avec succès."
            : run.status === "partial"
              ? "Restauration terminée avec des erreurs partielles."
              : "Échec de la restauration."}
        </p>
        <RestoreItemsList items={run.items} />
        <Button size="sm" variant="outline" className="mt-3" onClick={onReset}>
          Nouvelle restauration
        </Button>
      </Card>
    );
  }

  if (run) {
    return (
      <Card>
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Restauration en cours…
        </p>
        <RestoreItemsList items={run.items} />
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>Étape 3 — Confirmation</CardTitle>
      <p className="mt-1 text-xs text-muted-foreground">
        {manifest.scope.type === "site" ? `Site : ${manifest.scope.siteName}` : `Serveur complet (${manifest.hostname})`}{" "}
        · {new Date(manifest.createdAt).toLocaleString()}
      </p>

      <Button size="sm" variant="outline" className="mt-2" onClick={() => setShowFiles((v) => !v)}>
        <FileText className="h-3.5 w-3.5" /> {showFiles ? "Masquer les fichiers" : "Voir les fichiers"}
      </Button>
      {showFiles && <MigrationFileListPanel manifestId={manifest.manifestId} />}

      {planError && <p className="mt-2 text-xs text-destructive">{planError}</p>}

      {!plan && !planError && (
        <p className="mt-3 flex items-center gap-1 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Analyse de l'état actuel du serveur…
        </p>
      )}

      {plan && (
        <div className="mt-3 flex flex-col gap-3">
          {!plan.osMatch && (
            <p className="flex items-start gap-1 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
              <span>
                OS différent : instantané pris sur {plan.manifestOsDistro} {plan.manifestOsRelease}, ce serveur est{" "}
                {plan.currentOsDistro} {plan.currentOsRelease} — les paquets seront installés en best-effort.
              </span>
            </p>
          )}

          {plan.packages.length > 0 && (
            <div>
              <label className="mb-1 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeOsPackages}
                  onChange={(e) => setIncludeOsPackages(e.target.checked)}
                />
                Paquets système ({plan.packages.length})
              </label>
              {includeOsPackages && (
                <div className="ml-6 flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-md border border-border p-2">
                  {plan.packages
                    .filter((p) => p.action !== "up-to-date")
                    .map((p) => (
                      <label key={p.name} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={!uncheckedPackages.has(p.name)}
                          onChange={() => togglePackage(p.name)}
                        />
                        <span className="font-mono">{p.name}</span> :{" "}
                        {p.action === "install"
                          ? `installer (${p.manifestVersion})`
                          : `mettre à jour ${p.currentVersion} → ${p.manifestVersion}`}
                      </label>
                    ))}
                  {plan.packages.every((p) => p.action === "up-to-date") && (
                    <p className="text-xs text-muted-foreground">Tous les paquets sont déjà à jour.</p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1">
            {plan.items.map((line, i) => (
              <label
                key={`${line.category}-${i}`}
                className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!uncheckedLabels.has(line.label)}
                    onChange={() => toggleLabel(line.label)}
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{line.label}</p>
                    {line.detail && <p className="truncate text-xs text-muted-foreground">{line.detail}</p>}
                  </div>
                </div>
                <span
                  className={
                    "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium " +
                    (line.action === "skip-unchanged"
                      ? "bg-muted text-muted-foreground"
                      : "bg-warning/15 text-warning")
                  }
                >
                  {line.action === "replace"
                    ? "remplacer"
                    : line.action === "skip-unchanged"
                      ? "déjà à jour"
                      : "restaurer"}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <ConfirmDialog
        trigger={
          <Button size="sm" variant="destructive" className="mt-3" disabled={starting || !plan}>
            {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Restaurer"}
          </Button>
        }
        title="Restaurer cet instantané de migration ?"
        description="Cette opération va appliquer uniquement les éléments cochés ci-dessus (les éléments décochés seront ignorés). Les éléments marqués « remplacer »/« restaurer » seront écrasés. Action irréversible."
        requireTypedConfirmation="RESTORE"
        confirmLabel="Restaurer"
        onConfirm={start}
      />
    </Card>
  );
}

function RestoreItemsList({ items }: { items: MigrationRestoreRun["items"] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-1">
      {items.map((item, i) => (
        <div key={`${item.category}-${i}`} className="flex items-center justify-between text-xs">
          <span className="truncate">{item.label}</span>
          {item.status === "success" ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
          ) : item.status === "failed" ? (
            <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
          ) : (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
          )}
        </div>
      ))}
    </div>
  );
}
