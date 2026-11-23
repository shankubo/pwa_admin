import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Lock, LockOpen, ShieldCheck, ShieldOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UsbDriveInfo, UsbLockedDriveInfo } from "@pwa-admin/shared";
import { apiJson } from "@/lib/api";
import { Button } from "@/components/ui/Button";

const inputClass = "w-full rounded-sm border border-border bg-muted p-2 text-sm";

export type UsbDriveState = "plain" | "unlocked" | "locked";

const STATE_STYLE: Record<UsbDriveState, { className: string; Icon: typeof Lock }> = {
  plain: { className: "border-border text-muted-foreground", Icon: ShieldOff },
  unlocked: { className: "border-primary/40 text-primary", Icon: ShieldCheck },
  locked: { className: "border-warning/40 text-warning", Icon: Lock },
};

/** At-a-glance state of a plugged-in USB drive: not encrypted, encrypted and
 * unlocked (usable), or encrypted and still locked (needs the passphrase). */
export function UsbDriveStateBadge({ state }: { state: UsbDriveState }) {
  const { t } = useTranslation("backupEncryption");
  const { className, Icon } = STATE_STYLE[state];
  return (
    <span
      title={t(`luks.state.${state}Hint`)}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${className}`}
    >
      <Icon className="h-3 w-3" /> {t(`luks.state.${state}`)}
    </span>
  );
}

export function useLuksError() {
  const { t } = useTranslation("backupEncryption");
  return (code: string) => {
    const known = [
      "eject_failed_still_mounted", "unmount_failed",
      "wrong_passphrase", "confirmation_mismatch", "usb_partition_not_found", "partition_still_mounted",
      "mapper_busy", "invalid_passphrase_length", "not_a_luks_partition", "device_disconnected",
      "luks_format_failed", "luks_open_failed", "mkfs_failed", "unsupported_inner_filesystem",
    ];
    // The helper may suffix a detail after a colon (e.g. unsupported_inner_filesystem:none).
    const key = code.split(":")[0];
    return known.includes(key) ? t(`luks.errors.${key}`) : code;
  };
}

/** A plugged-in LUKS drive waiting for its passphrase. */
export function LockedDriveCard({ drive, onDone }: { drive: UsbLockedDriveInfo; onDone: () => void }) {
  const { t } = useTranslation("backupEncryption");
  const explain = useLuksError();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      await apiJson("/backups/usb/luks/unlock", {
        method: "POST",
        body: JSON.stringify({ partition: drive.partition, passphrase }),
      });
      setPassphrase("");
      onDone();
    } catch (err) {
      setError(explain((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">
      <p className="flex flex-wrap items-center gap-2 text-warning">
        <span className="flex items-center gap-1">
          <Lock className="h-4 w-4" /> {t("luks.locked.title")}
        </span>
        <UsbDriveStateBadge state="locked" />
      </p>
      <p className="text-xs text-muted-foreground">{t("luks.locked.description", { label: drive.label, device: drive.device })}</p>
      <input
        type="password"
        autoComplete="off"
        className={`${inputClass} mt-2`}
        placeholder={t("luks.passphrase")}
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      <Button size="sm" className="mt-2" disabled={busy || passphrase.length < 8} onClick={unlock}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LockOpen className="h-3.5 w-3.5" />}
        {t("luks.locked.unlock")}
      </Button>
      <EncryptDriveForm drive={drive} onDone={onDone} reformat />
    </div>
  );
}

/** Wipes a USB partition and sets it up as an encrypted LUKS backup drive. */
export function EncryptDriveForm({
  drive,
  onDone,
  reformat = false,
}: {
  drive: Pick<UsbDriveInfo, "partition" | "label" | "device">;
  onDone: () => void;
  /** An already-LUKS (locked) drive: same erase flow, worded as a reformat. */
  reformat?: boolean;
}) {
  const { t } = useTranslation("backupEncryption");
  const explain = useLuksError();
  const [open, setOpen] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [repeat, setRepeat] = useState("");
  const [withKeyfile, setWithKeyfile] = useState(true);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = passphrase.length >= 8 && passphrase === repeat && typed === drive.partition;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await apiJson("/backups/usb/luks/format", {
        method: "POST",
        body: JSON.stringify({
          partition: drive.partition,
          passphrase,
          confirmPartition: typed,
          confirmErase: true,
          withKeyfile,
        }),
      });
      setPassphrase("");
      setRepeat("");
      setOpen(false);
      onDone();
    } catch (err) {
      setError(explain((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpen(true)}>
        <Lock className="h-3.5 w-3.5" /> {reformat ? t("luks.encrypt.reformatButton") : t("luks.encrypt.button")}
      </Button>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-destructive/50 p-2">
      <p className="flex items-start gap-1 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        {t("luks.encrypt.warning", { device: drive.device, label: drive.label })}
      </p>
      <input type="password" autoComplete="new-password" className={inputClass} placeholder={t("luks.passphrase")} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      <input type="password" autoComplete="new-password" className={inputClass} placeholder={t("luks.encrypt.passphraseConfirm")} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      {passphrase.length > 0 && passphrase.length < 8 && <p className="text-xs text-destructive">{t("luks.encrypt.tooShort")}</p>}
      {repeat.length > 0 && passphrase !== repeat && <p className="text-xs text-destructive">{t("luks.encrypt.mismatch")}</p>}
      <p className="text-xs text-muted-foreground">{t("luks.encrypt.passphraseWarning")}</p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={withKeyfile} onChange={() => setWithKeyfile((v) => !v)} />
        <span>
          {t("luks.encrypt.keyfile")}
          <span className="block text-xs text-muted-foreground">{t("luks.encrypt.keyfileHint")}</span>
        </span>
      </label>
      <label className="text-sm">
        {t("luks.encrypt.confirmType", { partition: drive.partition })}
        <input className={`${inputClass} mt-1`} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </label>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {busy && <p className="text-xs text-muted-foreground">{t("luks.encrypt.working")}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={!valid || busy} onClick={submit}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t("luks.encrypt.submit")}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
          {t("luks.encrypt.cancel")}
        </Button>
      </div>
    </div>
  );
}

/** Shows whether the drive auto-unlocks with a keyfile stored on this server,
 * and lets the admin switch that on/off (needs the passphrase either way). */
export function KeyfileControl({ partition }: { partition: string }) {
  const { t } = useTranslation("backupEncryption");
  const explain = useLuksError();
  const [keyfile, setKeyfile] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiJson<{ keyfile: boolean }>(`/backups/usb/luks/keyfile-status?partition=${encodeURIComponent(partition)}`)
      .then((s) => setKeyfile(s.keyfile))
      .catch(() => setKeyfile(null));
  }
  useEffect(load, [partition]);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      await apiJson("/backups/usb/luks/keyfile", {
        method: "POST",
        body: JSON.stringify({ partition, passphrase, enabled: !keyfile }),
      });
      setPassphrase("");
      setAsking(false);
      load();
    } catch (err) {
      setError(explain((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  if (keyfile === null) return null;

  return (
    <div className="mt-2 text-xs">
      <p className="flex items-center gap-1 text-muted-foreground">
        <Lock className="h-3.5 w-3.5" /> {t("luks.badge")} · {keyfile ? t("luks.keyfile.on") : t("luks.keyfile.off")}
      </p>
      {!asking ? (
        <Button size="sm" variant="outline" className="mt-1" onClick={() => setAsking(true)}>
          {keyfile ? t("luks.keyfile.disable") : t("luks.keyfile.enable")}
        </Button>
      ) : (
        <div className="mt-1 flex flex-col gap-1">
          <input type="password" autoComplete="off" className={inputClass} placeholder={t("luks.passphrase")} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          {error && <p className="text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || passphrase.length < 8} onClick={apply}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t("luks.keyfile.apply")}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setAsking(false)}>
              {t("luks.encrypt.cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
