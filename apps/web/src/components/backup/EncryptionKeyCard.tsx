import { useEffect, useState } from "react";
import { Check, Copy, Download, KeyRound, Loader2, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BackupEncryptionStatus } from "@pwa-admin/shared";
import { apiJson } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

/** Shows the encryption state of USB/Drive copies and, until the admin has
 * confirmed saving it, the one-time private key. */
export function EncryptionKeyCard() {
  const { t } = useTranslation("backupEncryption");
  const [status, setStatus] = useState<BackupEncryptionStatus | null>(null);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"reveal" | "confirm" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiJson<BackupEncryptionStatus>("/backups/encryption").then(setStatus).catch(() => setStatus(null));
  }
  useEffect(load, []);

  async function reveal() {
    setBusy("reveal");
    setError(null);
    try {
      const res = await apiJson<{ privateKey: string }>("/backups/encryption/reveal", { method: "POST", body: JSON.stringify({}) });
      setPrivateKey(res.privateKey);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function confirmSaved() {
    setBusy("confirm");
    setError(null);
    try {
      await apiJson("/backups/encryption/confirm", { method: "POST", body: JSON.stringify({ confirm: true }) });
      setPrivateKey(null);
      setSaved(false);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function copyKey() {
    if (!privateKey) return;
    try {
      await navigator.clipboard.writeText(privateKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (non-secure context) — the key stays selectable in the textarea.
    }
  }

  function downloadKey() {
    if (!privateKey) return;
    const url = URL.createObjectURL(new Blob([privateKey + "\n"], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "pwa-admin-backup-private-key.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function removeServerKey() {
    if (!window.confirm(t("active.removeConfirm"))) return;
    setBusy("remove");
    setError(null);
    try {
      await apiJson("/backups/encryption/remove-server-key", { method: "POST", body: JSON.stringify({ confirm: true }) });
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!status?.enabled) return null;

  if (status.savedConfirmed) {
    return (
      <Card>
        <CardTitle className="flex items-center gap-1">
          <Lock className="h-4 w-4" /> {t("active.title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {status.privateKeyOnServer ? t("active.descriptionOnServer") : t("active.descriptionOffServer")}
        </p>
        {status.fingerprint && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("active.fingerprint")} <code>{status.fingerprint}</code>
          </p>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        {status.privateKeyOnServer && (
          <Button className="mt-3" size="sm" variant="outline" disabled={busy !== null} onClick={removeServerKey}>
            {busy === "remove" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t("active.remove")}
          </Button>
        )}
      </Card>
    );
  }

  return (
    <Card className="border-destructive/50">
      <CardTitle className="flex items-center gap-1">
        <KeyRound className="h-4 w-4" /> {t("pending.title")}
      </CardTitle>
      <p className="text-sm">{t("pending.description")}</p>
      {status.fingerprint && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("active.fingerprint")} <code>{status.fingerprint}</code>
        </p>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {!privateKey ? (
        <Button className="mt-3" size="sm" onClick={reveal} disabled={busy !== null}>
          {busy === "reveal" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
          {t("pending.reveal")}
        </Button>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            readOnly
            rows={2}
            value={privateKey}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-sm border border-border bg-muted p-2 font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={copyKey}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t("pending.copied") : t("pending.copy")}
            </Button>
            <Button size="sm" variant="outline" onClick={downloadKey}>
              <Download className="h-3.5 w-3.5" /> {t("pending.download")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("pending.warning")}</p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={saved} onChange={() => setSaved((v) => !v)} />
            {t("pending.savedCheckbox")}
          </label>
          <Button size="sm" disabled={!saved || busy !== null} onClick={confirmSaved}>
            {busy === "confirm" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {t("pending.confirm")}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Asks for the private key needed to decrypt a USB/Drive archive. The key is
 * only held in component state and sent once in the request body. */
export function PrivateKeyPrompt({
  fileName,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  fileName: string;
  busy: boolean;
  error: string | null;
  onSubmit: (privateKey: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("backupEncryption");
  const [key, setKey] = useState("");

  const errorText =
    error === "wrong_private_key"
      ? t("prompt.wrongKey")
      : error === "invalid_private_key_format"
        ? t("prompt.invalidFormat")
        : error === "private_key_required"
          ? null
          : error;

  return (
    <Card className="border-primary/50">
      <CardTitle className="flex items-center gap-1">
        <Lock className="h-4 w-4" /> {t("prompt.title")}
      </CardTitle>
      <p className="text-sm text-muted-foreground">{t("prompt.description", { fileName })}</p>
      <textarea
        rows={2}
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="pwa-admin-key-v1:…"
        autoComplete="off"
        spellCheck={false}
        className="mt-2 w-full rounded-sm border border-border bg-muted p-2 font-mono text-xs"
      />
      {errorText && <p className="mt-1 text-sm text-destructive">{errorText}</p>}
      <div className="mt-2 flex gap-2">
        <Button size="sm" disabled={busy || key.trim().length === 0} onClick={() => onSubmit(key.trim())}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t("prompt.submit")}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          {t("prompt.cancel")}
        </Button>
      </div>
    </Card>
  );
}
