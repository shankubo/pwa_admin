import type { BackupHistoryEntry } from "@pwa-admin/shared";
import { apiJson } from "@/lib/api";

export async function triggerBackupDownload(runId: string) {
  const { token } = await apiJson<{ token: string }>(`/backups/history/${runId}/download-token`, {
    method: "POST",
  });
  window.location.href = `/api/backups/history/${runId}/download?token=${encodeURIComponent(token)}`;
}

/** Polls a run until it leaves running/pending, then optionally triggers a
 * browser download — shared by the Backups screen and the Backup Wizard flow. */
export async function pollBackupRun(runId: string, download: boolean): Promise<BackupHistoryEntry> {
  for (;;) {
    const entry = await apiJson<BackupHistoryEntry>(`/backups/history/${runId}`);
    if (entry.status !== "running") {
      if (download && entry.status === "success") await triggerBackupDownload(runId);
      return entry;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
