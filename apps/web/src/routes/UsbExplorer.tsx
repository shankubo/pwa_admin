import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { UsbStatus, UsbExplorerListing, UsbExplorerEntry } from "@pwa-admin/shared";
import { useTranslation } from "react-i18next";
import { apiJson } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatBytes } from "./Docker";
import {
  Folder,
  FileArchive,
  FileJson,
  File,
  Shuffle,
  ChevronRight,
  HardDrive,
  Loader2,
  Download,
  Trash2,
  Lock,
} from "lucide-react";

/** BACKUP/<host>/migration/<snapshot id> — a whole-server migration snapshot. */
function isMigrationSnapshot(entry: UsbExplorerEntry): boolean {
  return entry.isDirectory && /^[^/]+\/migration\/[^/]+$/.test(entry.path);
}

function EntryActions({
  entry,
  busy,
  onDownload,
  onDelete,
}: {
  entry: UsbExplorerEntry;
  busy: boolean;
  onDownload: (entry: UsbExplorerEntry) => void;
  onDelete: (entry: UsbExplorerEntry) => Promise<void>;
}) {
  const { t } = useTranslation("usbExplorer");
  const description = isMigrationSnapshot(entry)
    ? t("deleteConfirm.descriptionMigration")
    : entry.isDirectory
      ? t("deleteConfirm.descriptionFolder")
      : t("deleteConfirm.descriptionFile");

  return (
    <div className="flex shrink-0 gap-1 pr-1">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => onDownload(entry)}
        title={entry.isDirectory ? t("actions.downloadFolder") : t("actions.download")}
      >
        <Download className="h-3.5 w-3.5" />
      </Button>
      <ConfirmDialog
        trigger={
          <Button size="sm" variant="destructive" disabled={busy} title={t("actions.delete")}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        }
        title={t("deleteConfirm.title", { name: entry.name })}
        description={description}
        confirmLabel={t("deleteConfirm.confirmLabel")}
        onConfirm={() => onDelete(entry)}
      />
    </div>
  );
}

function iconFor(entry: UsbExplorerEntry) {
  if (entry.isDirectory) return Folder;
  switch (entry.kind) {
    case "manifest":
      return Shuffle;
    case "archive":
      return FileArchive;
    case "json":
      return FileJson;
    default:
      return File;
  }
}

export function UsbExplorer() {
  const { t } = useTranslation("usbExplorer");
  const navigate = useNavigate();
  const [status, setStatus] = useState<UsbStatus | null>(null);
  const [mountpoint, setMountpoint] = useState<string | null>(null);
  const [relativePath, setRelativePath] = useState("");
  const [listing, setListing] = useState<UsbExplorerListing | null>(null);
  const [selected, setSelected] = useState<UsbExplorerEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyPath, setBusyPath] = useState<string | null>(null);

  // Server error codes → a readable message (unknown codes are shown as-is).
  function explain(code: string): string {
    const known = [
      "permission_denied", "entry_busy", "not_found", "path_not_allowed",
      "path_traversal_rejected", "symlink_rejected", "usb_drive_not_found", "unsupported_entry",
    ];
    return known.includes(code) ? t(`errors.${code}`) : code;
  }

  useEffect(() => {
    apiJson<UsbStatus>("/backups/usb/status")
      .then((s) => {
        setStatus(s);
        if (s.drives.length > 0) setMountpoint(s.drives[0].mountpoint);
      })
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    if (!mountpoint) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    apiJson<UsbExplorerListing>(
      `/usb-explorer/list?mountpoint=${encodeURIComponent(mountpoint)}&path=${encodeURIComponent(relativePath)}`
    )
      .then(setListing)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [mountpoint, relativePath, reloadKey]);

  const breadcrumbs = useMemo(() => {
    const segments = relativePath ? relativePath.split("/").filter(Boolean) : [];
    return segments.map((seg, i) => ({ label: seg, path: segments.slice(0, i + 1).join("/") }));
  }, [relativePath]);

  function openEntry(entry: UsbExplorerEntry) {
    if (entry.isDirectory) {
      setRelativePath(entry.path);
      return;
    }
    setSelected(entry);
  }

  function doubleClick(entry: UsbExplorerEntry) {
    if (entry.isDirectory) {
      setRelativePath(entry.path);
      return;
    }
    if (entry.kind === "manifest" && entry.migrationManifestId) {
      navigate("/restore", { state: { manifestId: entry.migrationManifestId } });
    }
  }

  async function downloadEntry(entry: UsbExplorerEntry) {
    if (!mountpoint) return;
    setError(null);
    try {
      // A plain navigation can't carry the Authorization header, so ask for a
      // short-lived token scoped to this one file or folder first.
      const { token } = await apiJson<{ token: string }>("/usb-explorer/download-token", {
        method: "POST",
        body: JSON.stringify({ mountpoint, path: entry.path }),
      });
      window.location.href = `/api/usb-explorer/download?token=${encodeURIComponent(token)}`;
    } catch (err) {
      setError(explain((err as Error).message));
    }
  }

  async function deleteEntry(entry: UsbExplorerEntry) {
    if (!mountpoint) return;
    setError(null);
    setBusyPath(entry.path);
    try {
      await apiJson("/usb-explorer/delete", {
        method: "POST",
        body: JSON.stringify({ mountpoint, path: entry.path, confirm: true }),
      });
      setSelected(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(explain((err as Error).message));
    } finally {
      setBusyPath(null);
    }
  }

  if (status && status.drives.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">{t("noDriveDetected")}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <p className="text-xs text-muted-foreground">{t("actionsHint")}</p>

      {status && status.drives.length > 1 && (
        <div className="flex gap-2">
          {status.drives.map((d) => (
            <Button
              key={d.mountpoint}
              size="sm"
              variant={d.mountpoint === mountpoint ? "default" : "outline"}
              onClick={() => {
                setMountpoint(d.mountpoint);
                setRelativePath("");
              }}
            >
              <HardDrive className="h-3.5 w-3.5" /> {d.label}
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <button type="button" className="hover:text-foreground hover:underline" onClick={() => setRelativePath("")}>
          BACKUP
        </button>
        {breadcrumbs.map((b) => (
          <span key={b.path} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5" />
            <button type="button" className="hover:text-foreground hover:underline" onClick={() => setRelativePath(b.path)}>
              {b.label}
            </button>
          </span>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          {loading && (
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
            </p>
          )}
          {!loading && listing && listing.entries.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("emptyFolder")}</p>
          )}
          {!loading && listing && listing.entries.length > 0 && (
            <div className="flex flex-col gap-1">
              {listing.entries.map((entry) => {
                const Icon = iconFor(entry);
                return (
                  <div
                    key={entry.path}
                    className={`flex items-center gap-1 rounded-md border transition-colors ${
                      selected?.path === entry.path
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:bg-muted"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => openEntry(entry)}
                      onDoubleClick={() => doubleClick(entry)}
                      className="flex min-w-0 flex-1 items-center gap-2 p-2 text-left text-sm"
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          entry.isDirectory
                            ? "text-primary"
                            : entry.kind === "manifest"
                              ? "text-primary"
                              : "text-muted-foreground"
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      {isMigrationSnapshot(entry) && (
                        <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                          {t("migrationSnapshot")}
                        </span>
                      )}
                      {entry.name.endsWith(".enc") && (
                        <Lock className="h-3.5 w-3.5 shrink-0 text-primary" aria-label={t("encryptedBadge")} />
                      )}
                      {!entry.isDirectory && entry.sizeBytes != null && (
                        <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(entry.sizeBytes)}</span>
                      )}
                    </button>
                    {entry.manageable && (
                      <EntryActions
                        entry={entry}
                        busy={busyPath === entry.path}
                        onDownload={downloadEntry}
                        onDelete={deleteEntry}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>{t("detailTitle")}</CardTitle>
          {!selected && <p className="text-sm text-muted-foreground">{t("selectFilePrompt")}</p>}
          {selected && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-medium break-all">{selected.name}</p>
              {selected.hostname && (
                <p className="text-xs text-muted-foreground">{t("machineLabel", { hostname: selected.hostname })}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {selected.isDirectory ? t("folderLabel") : formatBytes(selected.sizeBytes ?? 0)}
              </p>
              <p className="text-xs text-muted-foreground">{new Date(selected.modifiedAt).toLocaleString()}</p>
              {selected.kind === "manifest" && selected.migrationManifestId && (
                <Button
                  size="sm"
                  className="mt-2"
                  onClick={() => navigate("/restore", { state: { manifestId: selected.migrationManifestId } })}
                >
                  <Shuffle className="h-3.5 w-3.5" /> {t("openInRestore")}
                </Button>
              )}
              {selected.kind !== "manifest" && (
                <p className="mt-1 text-xs text-muted-foreground">{t("restoreHint")}</p>
              )}
              {selected.name.endsWith(".enc") && (
                <p className="flex items-start gap-1 text-xs text-muted-foreground">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> {t("encryptedHint")}
                </p>
              )}
              {selected.manageable && (
                <div className="mt-2">
                  <EntryActions
                    entry={selected}
                    busy={busyPath === selected.path}
                    onDownload={downloadEntry}
                    onDelete={deleteEntry}
                  />
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
