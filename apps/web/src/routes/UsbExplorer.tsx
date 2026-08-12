import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { UsbStatus, UsbExplorerListing, UsbExplorerEntry } from "@pwa-admin/shared";
import { apiJson } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatBytes } from "./Docker";
import { Folder, FileArchive, FileJson, File, Shuffle, ChevronRight, HardDrive, Loader2 } from "lucide-react";

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
  const navigate = useNavigate();
  const [status, setStatus] = useState<UsbStatus | null>(null);
  const [mountpoint, setMountpoint] = useState<string | null>(null);
  const [relativePath, setRelativePath] = useState("");
  const [listing, setListing] = useState<UsbExplorerListing | null>(null);
  const [selected, setSelected] = useState<UsbExplorerEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
  }, [mountpoint, relativePath]);

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

  if (status && status.drives.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">Aucun disque USB/SSD détecté.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Parcourir le contenu brut du dossier BACKUP/ de chaque disque externe — sauvegardes et instantanés de
        migration de toutes les machines présentes sur ce disque, pas seulement ce serveur.
      </p>

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
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
            </p>
          )}
          {!loading && listing && listing.entries.length === 0 && (
            <p className="text-sm text-muted-foreground">Dossier vide.</p>
          )}
          {!loading && listing && listing.entries.length > 0 && (
            <div className="flex flex-col gap-1">
              {listing.entries.map((entry) => {
                const Icon = iconFor(entry);
                return (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => openEntry(entry)}
                    onDoubleClick={() => doubleClick(entry)}
                    className={`flex items-center gap-2 rounded-md border p-2 text-left text-sm transition-colors ${
                      selected?.path === entry.path
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:bg-muted"
                    }`}
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
                    {!entry.isDirectory && entry.sizeBytes != null && (
                      <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(entry.sizeBytes)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Détail</CardTitle>
          {!selected && <p className="text-sm text-muted-foreground">Sélectionnez un fichier pour voir le détail.</p>}
          {selected && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-medium break-all">{selected.name}</p>
              {selected.hostname && (
                <p className="text-xs text-muted-foreground">Machine : {selected.hostname}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {selected.isDirectory ? "Dossier" : formatBytes(selected.sizeBytes ?? 0)}
              </p>
              <p className="text-xs text-muted-foreground">{new Date(selected.modifiedAt).toLocaleString()}</p>
              {selected.kind === "manifest" && selected.migrationManifestId && (
                <Button
                  size="sm"
                  className="mt-2"
                  onClick={() => navigate("/restore", { state: { manifestId: selected.migrationManifestId } })}
                >
                  <Shuffle className="h-3.5 w-3.5" /> Ouvrir dans Restore
                </Button>
              )}
              {selected.kind !== "manifest" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Utilisez Restore &gt; USB pour restaurer une sauvegarde de ce serveur ; les instantanés de
                  migration (manifest.json) s'ouvrent directement depuis ici.
                </p>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
