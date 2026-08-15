import { useEffect, useState } from "react";
import type { MigrationSnapshotRun } from "@pwa-admin/shared";
import { apiJson } from "@/lib/api";

/** Starts + polls a migration snapshot capture (whole-server or site-scoped)
 * — shared by Backups.tsx's MigrationSnapshotCard and the Migration Wizard
 * flow so the polling loop isn't duplicated. */
export function useMigrationSnapshot() {
  const [snapshots, setSnapshots] = useState<MigrationSnapshotRun[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [activeManifestId, setActiveManifestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadSnapshots() {
    apiJson<MigrationSnapshotRun[]>("/migration/snapshots")
      .then(setSnapshots)
      .catch(() => setSnapshots([]));
  }

  useEffect(() => {
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

  async function startWholeServerSnapshot(includeDuplicates: boolean) {
    setStarting(true);
    setError(null);
    try {
      const { manifestId } = await apiJson<{ manifestId: string }>("/migration/snapshot", {
        method: "POST",
        body: JSON.stringify({ confirm: true, includeDuplicates }),
      });
      setActiveManifestId(manifestId);
      loadSnapshots();
      return manifestId;
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setStarting(false);
    }
  }

  async function startSiteSnapshot(siteName: string) {
    setStarting(true);
    setError(null);
    try {
      const { manifestId } = await apiJson<{ manifestId: string }>(
        `/migration/snapshot/site/${encodeURIComponent(siteName)}`,
        { method: "POST", body: JSON.stringify({ confirm: true }) }
      );
      setActiveManifestId(manifestId);
      loadSnapshots();
      return manifestId;
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setStarting(false);
    }
  }

  return {
    snapshots,
    starting,
    activeManifestId,
    error,
    startWholeServerSnapshot,
    startSiteSnapshot,
  };
}
