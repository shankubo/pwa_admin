import { useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BackupEncryptionStatus, UsbStatus } from "@pwa-admin/shared";
import { apiJson } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";

/** Settings: choose, per destination, whether NEW backup copies are encrypted
 * with the app's own key. A LUKS-encrypted USB drive already protects what is
 * written on it, so encrypting each archive too can be switched off. */
export function BackupEncryptionSettingsCard() {
  const { t } = useTranslation("backupEncryption");
  const [status, setStatus] = useState<BackupEncryptionStatus | null>(null);
  const [luksDrivePlugged, setLuksDrivePlugged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiJson<BackupEncryptionStatus>("/backups/encryption").then(setStatus).catch(() => setStatus(null));
    apiJson<UsbStatus>("/backups/usb/status")
      .then((s) => setLuksDrivePlugged(s.drives.some((d) => d.encrypted)))
      .catch(() => setLuksDrivePlugged(false));
  }, []);

  async function save(next: { encryptUsbCopies: boolean; encryptDriveCopies: boolean }) {
    setSaving(true);
    setError(null);
    try {
      setStatus(await apiJson<BackupEncryptionStatus>("/backups/encryption/settings", {
        method: "POST",
        body: JSON.stringify(next),
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!status?.enabled) return null;

  return (
    <Card>
      <CardTitle className="flex items-center gap-1">
        <Lock className="h-4 w-4" /> {t("settings.title")}
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      </CardTitle>
      <p className="text-sm text-muted-foreground">{t("settings.description")}</p>

      <label className="mt-3 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={status.encryptUsbCopies}
          disabled={saving}
          onChange={() => save({ encryptUsbCopies: !status.encryptUsbCopies, encryptDriveCopies: status.encryptDriveCopies })}
        />
        <span>
          {t("settings.usb")}
          {status.encryptUsbCopies && luksDrivePlugged && (
            <span className="block text-xs text-primary">{t("settings.usbHintLuks")}</span>
          )}
          {!status.encryptUsbCopies && luksDrivePlugged && (
            <span className="block text-xs text-muted-foreground">{t("settings.usbOffLuks")}</span>
          )}
          {!status.encryptUsbCopies && !luksDrivePlugged && (
            <span className="block text-xs text-destructive">{t("settings.usbOffNoLuks")}</span>
          )}
        </span>
      </label>

      <label className="mt-3 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={status.encryptDriveCopies}
          disabled={saving}
          onChange={() => save({ encryptUsbCopies: status.encryptUsbCopies, encryptDriveCopies: !status.encryptDriveCopies })}
        />
        <span>
          {t("settings.drive")}
          {!status.encryptDriveCopies && <span className="block text-xs text-destructive">{t("settings.driveOff")}</span>}
        </span>
      </label>

      <p className="mt-3 text-xs text-muted-foreground">{t("settings.note")}</p>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </Card>
  );
}
