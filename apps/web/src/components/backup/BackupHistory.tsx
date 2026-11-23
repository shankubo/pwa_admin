import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { BackupHistoryEntry, BackupRunStatus, BackupSourceType } from "@pwa-admin/shared";
import {
  ArrowRight,
  Boxes,
  ChevronDown,
  ChevronUp,
  Cloud,
  Database,
  Download,
  FolderOpen,
  HardDrive,
  HelpCircle,
  Lock,
  LockOpen,
  Package,
  Search,
  Trash2,
  Usb,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatBytes } from "@/routes/Docker";
import { triggerBackupDownload } from "@/lib/pollBackupRun";

type TypeFilter = "all" | BackupSourceType;
type LocationFilter = "all" | "local" | "usb" | "drive";
type EncryptionFilter = "all" | "encrypted" | "plain";
type StatusFilter = "all" | BackupRunStatus;

const TYPE_ICONS: Record<BackupSourceType, typeof Boxes> = {
  volume: Boxes,
  path: FolderOpen,
  db: Database,
  image: Package,
};

type CopyKind = "local" | "usb" | "drive";
interface Copy {
  kind: CopyKind;
  /** undefined for local copies (never encrypted); null = unknown. */
  encrypted?: boolean | null;
}

/** Where this backup currently exists, and whether each external copy is encrypted. */
function copiesOf(h: BackupHistoryEntry): Copy[] {
  const copies: Copy[] = [];
  if (h.localExists) copies.push({ kind: "local" });
  if (h.usbPath) copies.push({ kind: "usb", encrypted: h.usbEncrypted ?? null });
  if (h.driveFileId) copies.push({ kind: "drive", encrypted: h.driveEncrypted ?? null });
  return copies;
}

function CopyBadge({ copy }: { copy: Copy }) {
  const { t } = useTranslation("backups");

  if (copy.kind === "local") {
    return (
      <span
        title={t("historyView.hints.local")}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
      >
        <HardDrive className="h-3 w-3" /> {t("historyView.badges.local")}
      </span>
    );
  }

  const Icon = copy.kind === "usb" ? Usb : Cloud;
  const label = copy.kind === "usb" ? t("historyView.badges.usb") : t("historyView.badges.drive");
  const hintKey =
    copy.kind === "usb"
      ? copy.encrypted === true
        ? "usbEncrypted"
        : copy.encrypted === false
          ? "usbPlain"
          : "usbUnknown"
      : copy.encrypted === true
        ? "driveEncrypted"
        : copy.encrypted === false
          ? "drivePlain"
          : "driveUnknown";

  const style =
    copy.encrypted === true
      ? "border-primary/40 bg-primary/10 text-primary"
      : copy.encrypted === false
        ? "border-warning/50 bg-warning/10 text-warning"
        : "border-border bg-muted text-muted-foreground";
  const StateIcon = copy.encrypted === true ? Lock : copy.encrypted === false ? LockOpen : HelpCircle;

  return (
    <span
      title={t(`historyView.hints.${hintKey}`)}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${style}`}
    >
      <Icon className="h-3 w-3" /> {label} <StateIcon className="h-3 w-3" />
    </span>
  );
}

function CopyBadges({ entry }: { entry: BackupHistoryEntry }) {
  const copies = copiesOf(entry);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {copies.map((c) => (
        <CopyBadge key={c.kind} copy={c} />
      ))}
    </div>
  );
}

function useAge() {
  const { i18n } = useTranslation();
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" });
  return (iso: string) => {
    const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
    const abs = Math.abs(minutes);
    if (abs < 60) return rtf.format(minutes, "minute");
    if (abs < 60 * 48) return rtf.format(Math.round(minutes / 60), "hour");
    return rtf.format(Math.round(minutes / 1440), "day");
  };
}

interface Group {
  key: string;
  type: BackupHistoryEntry["type"];
  sourceType: BackupSourceType;
  sourceRef: string;
  /** Every entry of this source, newest first (ignores the filters). */
  all: BackupHistoryEntry[];
  /** Entries matching the current filters, newest first. */
  shown: BackupHistoryEntry[];
  /** Most recent successful backup of this source, regardless of filters. */
  latest: BackupHistoryEntry | null;
}

export function BackupHistory({
  history,
  renderDriveStatus,
  deletingRunId,
  onDelete,
  onDeleteMany,
}: {
  history: BackupHistoryEntry[] | null;
  renderDriveStatus: (runId: string) => ReactNode;
  deletingRunId: string | null;
  onDelete: (runId: string) => void;
  onDeleteMany: (runIds: string[]) => Promise<void>;
}) {
  const { t } = useTranslation("backups");
  const age = useAge();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [locationFilter, setLocationFilter] = useState<LocationFilter>("all");
  const [encryptionFilter, setEncryptionFilter] = useState<EncryptionFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const filtersActive =
    query !== "" || typeFilter !== "all" || locationFilter !== "all" || encryptionFilter !== "all" || statusFilter !== "all";

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: history?.length ?? 0 };
    for (const h of history ?? []) counts[h.sourceType] = (counts[h.sourceType] ?? 0) + 1;
    return counts;
  }, [history]);

  const groups = useMemo<Group[]>(() => {
    const byKey = new Map<string, BackupHistoryEntry[]>();
    for (const h of history ?? []) {
      const key = `${h.type}|${h.sourceType}|${h.sourceRef}`;
      byKey.set(key, [...(byKey.get(key) ?? []), h]);
    }

    const q = query.trim().toLowerCase();
    const matches = (h: BackupHistoryEntry): boolean => {
      if (typeFilter !== "all" && h.sourceType !== typeFilter) return false;
      if (q && !h.sourceRef.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && h.status !== statusFilter) return false;
      const copies = copiesOf(h);
      if (locationFilter !== "all" && !copies.some((c) => c.kind === locationFilter)) return false;
      if (encryptionFilter !== "all") {
        const external = copies.filter((c) => c.kind !== "local");
        if (encryptionFilter === "encrypted" && !(external.length > 0 && external.every((c) => c.encrypted === true))) return false;
        if (encryptionFilter === "plain" && !external.some((c) => c.encrypted !== true)) return false;
      }
      return true;
    };

    const byNewest = (a: BackupHistoryEntry, b: BackupHistoryEntry) => b.startedAt.localeCompare(a.startedAt);
    const result: Group[] = [];
    for (const [key, entries] of byKey) {
      const all = [...entries].sort(byNewest);
      const shown = all.filter(matches);
      if (shown.length === 0) continue;
      result.push({
        key,
        type: all[0].type,
        sourceType: all[0].sourceType,
        sourceRef: all[0].sourceRef,
        all,
        shown,
        latest: all.find((e) => e.status === "success") ?? null,
      });
    }
    return result.sort((a, b) => b.shown[0].startedAt.localeCompare(a.shown[0].startedAt));
  }, [history, query, typeFilter, locationFilter, encryptionFilter, statusFilter]);

  function toggle(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function resetFilters() {
    setQuery("");
    setTypeFilter("all");
    setLocationFilter("all");
    setEncryptionFilter("all");
    setStatusFilter("all");
  }

  const selectClass = "rounded-md border border-border bg-background px-2 py-1 text-xs outline-none";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("history.title")}</h2>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className={selectClass}
        >
          {(["all", "success", "failed", "running"] as const).map((k) => (
            <option key={k} value={k}>
              {t(`statusFilters.${k}`)}
            </option>
          ))}
        </select>
      </div>

      <p className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
        {t("history.restorePrompt")}{" "}
        <Link to="/restore" className="inline-flex items-center gap-0.5 text-primary underline">
          {t("history.restoreLink")} <ArrowRight className="h-3 w-3" />
        </Link>
      </p>

      <Card className="mb-2 flex flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("historyView.searchPlaceholder")}
            className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-sm outline-none"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {(["all", "volume", "path", "db", "image"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTypeFilter(k)}
              className={
                "rounded-full border px-2.5 py-0.5 text-xs " +
                (typeFilter === k ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-muted")
              }
            >
              {t(`historyView.type.${k}`)} <span className="opacity-60">{typeCounts[k] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value as LocationFilter)} className={selectClass}>
            {(["all", "local", "usb", "drive"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`historyView.location.${k}`)}
              </option>
            ))}
          </select>
          <select value={encryptionFilter} onChange={(e) => setEncryptionFilter(e.target.value as EncryptionFilter)} className={selectClass}>
            {(["all", "encrypted", "plain"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`historyView.encryption.${k}`)}
              </option>
            ))}
          </select>
          {filtersActive && (
            <button type="button" onClick={resetFilters} className="text-xs text-primary underline">
              {t("historyView.reset")}
            </button>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">{t("historyView.legend")}</p>
      </Card>

      <div className="flex flex-col gap-2">
        {history && history.length === 0 && <Card className="text-sm text-muted-foreground">{t("history.empty")}</Card>}
        {history && history.length > 0 && groups.length === 0 && (
          <Card className="text-sm text-muted-foreground">{t("historyView.noMatch")}</Card>
        )}

        {groups.map((g) => {
          const open = openGroups.has(g.key);
          const Icon = TYPE_ICONS[g.sourceType] ?? Package;
          const latest = g.latest;
          const olderIds = latest ? g.all.filter((e) => e.runId !== latest.runId).map((e) => e.runId) : [];
          const shownLatest = latest ? g.shown.find((e) => e.runId === latest.runId) : undefined;
          const headEntry = shownLatest ?? g.shown[0];

          return (
            <Card
              key={g.key}
              className={latest ? "border-primary/40" : g.all.every((e) => e.status === "failed") ? "border-destructive/40" : undefined}
            >
              <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => toggle(g.key)}>
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {g.sourceRef}
                      {g.type !== "backup" && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                          {t(`historyView.runType.${g.type}`)}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t(`historyView.type.${g.sourceType}`)} · {t("historyView.count", { count: g.all.length })}
                    </p>
                    {headEntry && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-foreground">
                          {latest
                            ? t("historyView.lastBackup", { when: age(latest.startedAt) })
                            : t("historyView.noSuccess")}
                        </span>
                        {headEntry.sizeBytes != null && (
                          <span className="text-xs text-muted-foreground">{formatBytes(headEntry.sizeBytes)}</span>
                        )}
                        <CopyBadges entry={headEntry} />
                      </div>
                    )}
                  </div>
                </div>
                {open ? (
                  <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </button>

              {open && (
                <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                  {olderIds.length > 0 && (
                    <div className="flex justify-end">
                      <ConfirmDialog
                        trigger={
                          <Button size="sm" variant="outline">
                            <Trash2 className="h-3.5 w-3.5" /> {t("historyView.keepOnlyLatest")}
                          </Button>
                        }
                        title={t("historyView.keepOnlyLatestConfirm.title", { count: olderIds.length })}
                        description={t("historyView.keepOnlyLatestConfirm.description", { name: g.sourceRef, count: olderIds.length })}
                        confirmLabel={t("historyView.keepOnlyLatestConfirm.confirmLabel")}
                        onConfirm={() => onDeleteMany(olderIds)}
                      />
                    </div>
                  )}

                  {g.shown.map((h) => {
                    const isLatest = latest?.runId === h.runId;
                    const failed = h.status === "failed";
                    return (
                      <div
                        key={h.runId}
                        className={
                          "rounded-md border p-2 text-sm " +
                          (isLatest
                            ? "border-primary bg-primary/10"
                            : failed
                              ? "border-destructive/40 bg-destructive/5"
                              : "border-border bg-muted/30")
                        }
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-2 font-medium">
                              {new Date(h.startedAt).toLocaleString()}
                              {isLatest && (
                                <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                                  {t("historyView.latest")}
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {age(h.startedAt)}
                              {h.sizeBytes != null ? ` · ${formatBytes(h.sizeBytes)}` : ""}
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

                        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <CopyBadges entry={h} />
                            {renderDriveStatus(h.runId)}
                          </div>
                          <div className="flex gap-1">
                            {h.status === "success" && h.localExists && (
                              <Button size="sm" variant="outline" onClick={() => triggerBackupDownload(h.runId)} title={t("history.downloadTitle")}>
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <ConfirmDialog
                              trigger={
                                <Button size="sm" variant="destructive" disabled={deletingRunId === h.runId}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              }
                              title={t("history.deleteConfirm.title")}
                              description={t("history.deleteConfirm.description")}
                              confirmLabel={t("history.deleteConfirm.confirmLabel")}
                              onConfirm={() => onDelete(h.runId)}
                            />
                          </div>
                        </div>
                        {h.error && <p className="mt-1 text-xs text-destructive">{h.error}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
