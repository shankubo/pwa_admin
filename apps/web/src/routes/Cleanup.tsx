import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { CleanupCategory, CleanupCategoryId, CleanupRunResponse, CleanupScan } from "@pwa-admin/shared";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Container,
  DatabaseBackup,
  Eraser,
  FileText,
  Folder,
  HardDrive,
  Loader2,
  Package,
  ScanSearch,
  Trash2,
  XCircle,
} from "lucide-react";
import { apiJson } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatBytes } from "./Docker";

const ICONS: Record<CleanupCategoryId, typeof Folder> = {
  "app-temp": Folder,
  "tmp-owned": Folder,
  "npm-cache": Package,
  "docker-dangling-images": Container,
  "docker-build-cache": Container,
  "apt-cache": Package,
  journal: FileText,
  "old-backups": DatabaseBackup,
};

const DAY_CHOICES = [7, 14, 30, 60, 90, 180];

function CategoryCard({
  category,
  checked,
  onToggle,
  open,
  onOpen,
  backupDays,
  backupMinCopies,
}: {
  category: CleanupCategory;
  checked: boolean;
  onToggle: () => void;
  open: boolean;
  onOpen: () => void;
  backupDays: number;
  backupMinCopies: number;
}) {
  const { t } = useTranslation("cleanup");
  const Icon = ICONS[category.id];
  const nothing = category.available && category.scanError === null && (category.sizeBytes ?? 0) === 0;
  const disabled = !category.available || nothing || category.scanError !== null;

  return (
    <Card className={checked ? "border-primary/50 bg-primary/5" : undefined}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1.5 h-4 w-4 shrink-0"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          aria-label={t(`categories.${category.id}.title`)}
        />
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{t(`categories.${category.id}.title`)}</p>
            <span
              className={
                "rounded-full border px-2 py-0.5 text-[10px] font-medium " +
                (category.risk === "safe"
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-warning/50 bg-warning/10 text-warning")
              }
            >
              {t(`risk.${category.risk}`)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(`categories.${category.id}.description`, { days: backupDays, keep: backupMinCopies })}
          </p>
          {category.scanError && (
            <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> {t(`scanErrors.${category.scanError}`, { defaultValue: category.scanError })}
            </p>
          )}
          {!category.available && <p className="mt-1 text-xs text-muted-foreground">{t("unavailable")}</p>}
        </div>

        <div className="shrink-0 text-right">
          {category.available && category.scanError === null && (
            <p className="text-sm font-semibold">
              {category.sizeIsUpperBound && (category.sizeBytes ?? 0) > 0 ? "≤ " : ""}
              {category.sizeBytes == null ? "—" : formatBytes(category.sizeBytes)}
            </p>
          )}
          {category.itemCount != null && category.itemCount > 0 && (
            <p className="text-[11px] text-muted-foreground">{t("itemCount", { count: category.itemCount })}</p>
          )}
        </div>
      </div>

      {category.items.length > 0 && (
        <>
          <button type="button" onClick={onOpen} className="mt-2 flex items-center gap-1 text-xs text-primary">
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {open ? t("hideDetails") : t("showDetails")}
          </button>
          {open && (
            <ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
              {category.items.map((item, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {item.label}
                    {item.detail ? ` · ${item.detail}` : ""}
                  </span>
                  {item.sizeBytes != null && <span className="shrink-0">{formatBytes(item.sizeBytes)}</span>}
                </li>
              ))}
              {category.itemCount != null && category.itemCount > category.items.length && (
                <li className="text-[11px] text-muted-foreground">
                  {t("andMore", { count: category.itemCount - category.items.length })}
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

export function Cleanup() {
  const { t } = useTranslation("cleanup");
  const [scan, setScan] = useState<CleanupScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState<Set<CleanupCategoryId>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CleanupRunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  function explain(code: string): string {
    // The service reports partial failures as "<n>_failed".
    const partial = code.match(/^(\d+)_failed$/);
    if (partial) return t("errors.someFailed", { count: Number(partial[1]) });
    return t(`errors.${code}`, { defaultValue: code });
  }

  async function runScan(backupDays = days) {
    setScanning(true);
    setError(null);
    try {
      const data = await apiJson<CleanupScan>(`/cleanup/scan?backupDays=${backupDays}`);
      setScan(data);
      // Only the harmless categories start ticked; anything that removes data waits for a deliberate click.
      setSelected(
        new Set(data.categories.filter((c) => c.risk === "safe" && c.available && !c.scanError && (c.sizeBytes ?? 0) > 0).map((c) => c.id))
      );
    } catch (err) {
      setError(explain((err as Error).message));
    } finally {
      setScanning(false);
    }
  }

  async function runCleanup() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiJson<CleanupRunResponse>("/cleanup/run", {
        method: "POST",
        body: JSON.stringify({ categories: [...selected], backupDays: days, confirm: true }),
      });
      setResult(res);
      await runScan();
    } catch (err) {
      setError(explain((err as Error).message));
    } finally {
      setRunning(false);
    }
  }

  function toggle(id: CleanupCategoryId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleOpen(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const estimate = scan
    ? scan.categories.filter((c) => selected.has(c.id)).reduce((sum, c) => sum + (c.sizeBytes ?? 0), 0)
    : 0;
  const reviewSelected = scan ? scan.categories.some((c) => selected.has(c.id) && c.risk === "review") : false;
  const freed = result ? result.freeBytesAfter - result.freeBytesBefore : 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <Card>
        <CardTitle className="flex items-center gap-1">
          <HardDrive className="h-4 w-4" /> {t("disk.title")}
        </CardTitle>
        {scan ? (
          <>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full ${scan.disk.usedPct >= 90 ? "bg-destructive" : scan.disk.usedPct >= 80 ? "bg-warning" : "bg-primary"}`}
                style={{ width: `${scan.disk.usedPct}%` }}
              />
            </div>
            <p className="mt-1 text-sm">
              {t("disk.usage", {
                pct: scan.disk.usedPct,
                free: formatBytes(scan.disk.freeBytes),
                total: formatBytes(scan.disk.totalBytes),
              })}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noScanYet")}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={() => runScan()} disabled={scanning || running}>
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
            {scanning ? t("scanning") : scan ? t("rescan") : t("scan")}
          </Button>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            {t("backupAge")}
            <select
              value={days}
              disabled={scanning || running}
              onChange={(e) => {
                const value = Number(e.target.value);
                setDays(value);
                if (scan) void runScan(value);
              }}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none"
            >
              {DAY_CHOICES.map((d) => (
                <option key={d} value={d}>
                  {t("daysOption", { count: d })}
                </option>
              ))}
            </select>
          </label>
        </div>
        {scan && <p className="mt-2 text-[11px] text-muted-foreground">{t("scannedAt", { when: new Date(scan.scannedAt).toLocaleString() })}</p>}
      </Card>

      {error && (
        <Card className="flex items-center gap-2 text-sm text-destructive">
          <XCircle className="h-4 w-4 shrink-0" /> {error}
        </Card>
      )}

      {result && (
        <Card className="border-primary/40 bg-primary/5">
          <CardTitle className="flex items-center gap-1">
            <CheckCircle2 className="h-4 w-4 text-primary" /> {t("result.title")}
          </CardTitle>
          <p className="text-sm font-medium">{t("result.freed", { size: formatBytes(Math.max(0, freed)) })}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {result.results.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1">
                  {r.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                  {t(`categories.${r.id}.title`)}
                </span>
                <span className={r.ok ? "text-muted-foreground" : "text-destructive"}>
                  {r.ok
                    ? r.freedBytes != null
                      ? formatBytes(r.freedBytes)
                      : t("result.done")
                    : explain(r.message ?? "unknown")}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {scan && (
        <>
          <div className="flex flex-col gap-2">
            {scan.categories.map((c) => (
              <CategoryCard
                key={c.id}
                category={c}
                checked={selected.has(c.id)}
                onToggle={() => toggle(c.id)}
                open={open.has(c.id)}
                onOpen={() => toggleOpen(c.id)}
                backupDays={scan.backupDays}
                backupMinCopies={scan.backupMinCopies}
              />
            ))}
          </div>

          <Card className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-2 shadow-md">
            <div>
              <p className="text-sm font-medium">{t("selection.title", { count: selected.size })}</p>
              <p className="text-xs text-muted-foreground">{t("selection.estimate", { size: formatBytes(estimate) })}</p>
            </div>
            <ConfirmDialog
              trigger={
                <Button variant="destructive" disabled={selected.size === 0 || running || scanning}>
                  {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eraser className="h-4 w-4" />}
                  {running ? t("selection.running") : t("selection.run")}
                </Button>
              }
              title={t("confirm.title", { count: selected.size })}
              description={
                t("confirm.description", { size: formatBytes(estimate) }) + (reviewSelected ? ` ${t("confirm.reviewWarning")}` : "")
              }
              confirmLabel={t("confirm.confirmLabel")}
              onConfirm={runCleanup}
            />
          </Card>

          {scan.localBackups.length > 0 && (
            <Card>
              <CardTitle className="flex items-center gap-1">
                <Trash2 className="h-4 w-4" /> {t("localBackups.title")}
              </CardTitle>
              <p className="mb-2 text-xs text-muted-foreground">{t("localBackups.description")}</p>
              <ul className="flex flex-col gap-1">
                {scan.localBackups.map((f) => (
                  <li key={f.name} className="flex items-center justify-between text-xs">
                    <span className="truncate text-muted-foreground">{f.name}</span>
                    <span>{formatBytes(f.sizeBytes)}</span>
                  </li>
                ))}
              </ul>
              <Link to="/backups" className="mt-2 inline-block text-xs text-primary underline">
                {t("localBackups.link")}
              </Link>
            </Card>
          )}

          <p className="text-xs text-muted-foreground">{t("neverTouched")}</p>
        </>
      )}
    </div>
  );
}
