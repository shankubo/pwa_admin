import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { SiteSummary, SiteDetail, DetectedDatabase, UsbStatus } from "@pwa-admin/shared";
import { apiFetch, apiJson } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LiveLogPanel } from "@/components/LiveLogPanel";
import { formatBytes } from "./Docker";
import { ChevronDown, ChevronUp, Globe, ExternalLink, Copy, Loader2, HardDriveUpload } from "lucide-react";

function siteUrl(s: SiteSummary): string | null {
  const host = s.serverNames.find((n) => n !== "_");
  if (!host) return null;
  const scheme = s.listenPorts.includes(443) ? "https" : "http";
  return `${scheme}://${host}/`;
}

function translateFailoverError(message: string): string {
  const known: Record<string, string> = {
    vhost_in_maintenance: "Ce site est en mode maintenance — quittez la maintenance avant de basculer vers le duplicata.",
    no_duplicate_found: "Aucun duplicata n'existe pour ce site.",
    duplicate_not_ready: "Le duplicata n'est pas encore prêt (création ou rafraîchissement en cours).",
    duplicate_container_unavailable: "Le conteneur du duplicata n'a pas pu être démarré — vérifiez son état dans l'écran Docker.",
    vhost_not_switched_to_duplicate: "Ce site n'est pas actuellement basculé vers son duplicata.",
    snapshot_not_found: "L'ancienne configuration du site est introuvable — impossible de revenir en arrière automatiquement.",
  };
  const errorCode = message.split(":")[0].trim();
  return known[errorCode] ?? message;
}

function certBadgeClass(daysRemaining: number | null) {
  if (daysRemaining == null) return "bg-muted text-muted-foreground";
  if (daysRemaining < 14) return "bg-destructive/15 text-destructive";
  if (daysRemaining < 30) return "bg-warning/15 text-warning";
  return "bg-primary/15 text-primary";
}

function siteCardClass(s: SiteSummary): string {
  if (!s.enabled) return "border-muted-foreground/30 bg-muted/30";
  if (s.maintenanceMode) return "border-warning/50 bg-warning/5";
  return "border-primary/40 bg-primary/5";
}

export function Sites() {
  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [expanded, setExpanded] = useState<string | null>(searchParams.get("site"));
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cloningFor, setCloningFor] = useState<string | null>(null);
  const [usbConfigured, setUsbConfigured] = useState(false);
  const [migratingFor, setMigratingFor] = useState<string | null>(null);
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null);
  const scrolledToTarget = useRef(false);

  async function load() {
    try {
      setSites(await apiJson<SiteSummary[]>("/sites"));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    load();
    apiJson<UsbStatus>("/backups/usb/status")
      .then((s) => setUsbConfigured(s.drives.some((d) => d.isBackupConfigured)))
      .catch(() => setUsbConfigured(false));
  }, []);

  async function captureSiteMigration(name: string) {
    setMigratingFor(name);
    setMigrationMessage(null);
    try {
      await apiJson(`/migration/snapshot/site/${encodeURIComponent(name)}`, {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      });
      setMigrationMessage(
        `Capture de migration démarrée pour ${name} — suivez la progression dans Backups.`
      );
    } catch (err) {
      setMigrationMessage((err as Error).message);
    } finally {
      setMigratingFor(null);
    }
  }

  // Deep-link from Dashboard (?site=<name>): scroll the target card into
  // view once, then drop the query param so it doesn't re-trigger on every
  // re-render or stick around after the operator navigates around manually.
  useEffect(() => {
    const target = searchParams.get("site");
    if (!target || !sites || scrolledToTarget.current) return;
    scrolledToTarget.current = true;
    document.getElementById(`site-${target}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setSearchParams({}, { replace: true });
  }, [sites, searchParams, setSearchParams]);

  async function toggle(name: string, enabled: boolean) {
    await apiJson(`/sites/${name}/${enabled ? "disable" : "enable"}`, { method: "POST" });
    await load();
  }

  async function toggleMaintenance(name: string, maintenanceMode: boolean) {
    await apiJson(`/sites/${name}/maintenance/${maintenanceMode ? "disable" : "enable"}`, { method: "POST" });
    await load();
  }

  async function switchFailover(name: string, action: "switch" | "revert") {
    try {
      setActionError(null);
      await apiJson(`/sites/${name}/failover/${action}`, { method: "POST" });
      await load();
    } catch (err) {
      setActionError(translateFailoverError((err as Error).message));
    }
  }

  if (error) return <Card className="text-sm text-destructive">{error}</Card>;
  if (!sites) return <Card className="text-sm text-muted-foreground">Chargement…</Card>;
  if (sites.length === 0) return <Card className="text-sm text-muted-foreground">Aucun site.</Card>;

  return (
    <div className="flex flex-col gap-3">
      {actionError && <Card className="text-sm text-destructive">{actionError}</Card>}
      {migrationMessage && <Card className="text-sm">{migrationMessage}</Card>}
      {sites.map((s) => (
        <Card key={s.name} id={`site-${s.name}`} className={siteCardClass(s)}>
          <div
            className="flex cursor-pointer items-start justify-between gap-2"
            onClick={() => setExpanded(expanded === s.name ? null : s.name)}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{s.name}</span>
                {s.enabled && siteUrl(s) && (
                  <a
                    href={siteUrl(s)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Ouvrir ${s.name} dans un nouvel onglet`}
                    className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">{s.serverNames.join(", ") || "—"}</p>
              {s.linkedContainer && (
                <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-xs">
                  conteneur : {s.linkedContainer.name} ({s.linkedContainer.state})
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {s.failoverActive && (
                <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
                  bascule active
                </span>
              )}
              {s.maintenanceMode && (
                <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                  maintenance
                </span>
              )}
              <span
                className={
                  "rounded-full px-2 py-0.5 text-xs font-medium " +
                  (s.enabled ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")
                }
              >
                {s.enabled ? "activé" : "désactivé"}
              </span>
              {expanded === s.name ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
            {s.enabled ? (
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="destructive">
                    Désactiver
                  </Button>
                }
                title={`Désactiver ${s.name} ?`}
                description="Le site ne sera plus accessible."
                confirmLabel="Désactiver"
                onConfirm={() => toggle(s.name, s.enabled)}
              />
            ) : (
              <Button size="sm" variant="outline" onClick={() => toggle(s.name, s.enabled)}>
                Activer
              </Button>
            )}

            {s.enabled && (
              s.maintenanceMode ? (
                <Button size="sm" variant="outline" onClick={() => toggleMaintenance(s.name, s.maintenanceMode)}>
                  Quitter maintenance
                </Button>
              ) : (
                <ConfirmDialog
                  trigger={
                    <Button size="sm" variant="outline">
                      Maintenance
                    </Button>
                  }
                  title={`Passer ${s.name} en maintenance ?`}
                  description="Les visiteurs verront une page « en construction » à la place du site."
                  confirmLabel="Activer la maintenance"
                  onConfirm={() => toggleMaintenance(s.name, s.maintenanceMode)}
                />
              )
            )}

            {!s.hasDuplicate && (s.root || s.linkedContainer) && (
              <Button size="sm" variant="outline" onClick={() => setCloningFor(s.name)}>
                <Copy className="h-3.5 w-3.5" /> Cloner
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={!usbConfigured || migratingFor === s.name}
              onClick={() => captureSiteMigration(s.name)}
              title={
                usbConfigured
                  ? "Capture ce site (conteneur, volumes, base de données, config Nginx) sur le disque USB de sauvegarde, en vue d'une migration vers un nouveau serveur"
                  : "Connectez et configurez un disque USB de sauvegarde (écran Backups) pour activer la migration"
              }
            >
              {migratingFor === s.name ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <HardDriveUpload className="h-3.5 w-3.5" />
              )}{" "}
              Migration
            </Button>
            {s.hasDuplicate && !s.failoverActive && (
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="destructive">
                    Basculer vers le duplicata
                  </Button>
                }
                title={`Basculer ${s.name} vers son duplicata ?`}
                description="Tout le trafic sera routé vers la copie de secours. À utiliser en cas de panne ou d'erreur système. Réversible."
                confirmLabel="Basculer"
                onConfirm={() => switchFailover(s.name, "switch")}
              />
            )}
            {s.failoverActive && (
              <Button size="sm" variant="outline" onClick={() => switchFailover(s.name, "revert")}>
                Revenir au site principal
              </Button>
            )}
          </div>

          {cloningFor === s.name && (
            <div onClick={(e) => e.stopPropagation()}>
              <CreateDuplicateDialog
                name={s.name}
                hasRoot={!!s.root}
                hasLinkedContainer={!!s.linkedContainer}
                onClose={() => setCloningFor(null)}
                onCreated={() => {
                  setCloningFor(null);
                  load();
                }}
              />
            </div>
          )}

          {expanded === s.name && <SiteDetailPanel name={s.name} />}
        </Card>
      ))}
    </div>
  );
}

function SiteDetailPanel({ name }: { name: string }) {
  const [detail, setDetail] = useState<SiteDetail | null>(null);
  const [logTab, setLogTab] = useState<"nginx-access" | "nginx-error" | "docker">("nginx-error");
  const [logText, setLogText] = useState("");

  function loadDetail() {
    apiJson<SiteDetail>(`/sites/${name}`)
      .then(setDetail)
      .catch(() => {});
  }

  useEffect(loadDetail, [name]);

  useEffect(() => {
    setLogText("");
    if (logTab === "docker") {
      if (!detail?.linkedContainer) return;
      apiFetch(`/docker/containers/${detail.linkedContainer.id}/logs?tail=200`)
        .then((res) => (res.ok ? res.text() : ""))
        .then(setLogText)
        .catch(() => {});
    } else {
      const type = logTab === "nginx-access" ? "access" : "error";
      apiFetch(`/sites/${name}/logs?type=${type}&tail=200`)
        .then((res) => (res.ok ? res.text() : ""))
        .then(setLogText)
        .catch(() => {});
    }
  }, [logTab, name, detail?.linkedContainer]);

  if (!detail) return <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">Chargement…</p>;

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3 text-sm">
      <div>
        <p className="text-xs text-muted-foreground">Racine : {detail.vhost.root ?? "—"}</p>
        <p className="text-xs text-muted-foreground">Proxy : {detail.vhost.proxyPassTarget ?? "—"}</p>
        <p className="text-xs text-muted-foreground">Ports : {detail.vhost.listenPorts.join(", ")}</p>
      </div>

      <div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${certBadgeClass(detail.cert.daysRemaining)}`}>
          {detail.cert.found
            ? detail.cert.daysRemaining != null
              ? `cert. expire dans ${detail.cert.daysRemaining}j`
              : "cert. présent"
            : "pas de certificat"}
        </span>
      </div>

      <div>
        <div className="mb-1 flex flex-wrap gap-1">
          <button
            onClick={() => setLogTab("nginx-access")}
            className={
              "rounded-md px-2 py-1 text-xs font-medium " +
              (logTab === "nginx-access" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")
            }
          >
            Accès Nginx
          </button>
          <button
            onClick={() => setLogTab("nginx-error")}
            className={
              "rounded-md px-2 py-1 text-xs font-medium " +
              (logTab === "nginx-error" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")
            }
          >
            Erreurs Nginx
          </button>
          {detail.linkedContainer && (
            <button
              onClick={() => setLogTab("docker")}
              className={
                "rounded-md px-2 py-1 text-xs font-medium " +
                (logTab === "docker" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")
              }
            >
              Conteneur
            </button>
          )}
        </div>
        <LiveLogPanel key={logTab} initialText={logText} emptyLabel="Aucun log." />
      </div>

      <SiteDuplicateSection name={name} detail={detail} onChanged={loadDetail} />
    </div>
  );
}

function SiteDuplicateSection({
  name,
  detail,
  onChanged,
}: {
  name: string;
  detail: SiteDetail;
  onChanged: () => void;
}) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isRefreshing = detail.duplicate?.status === "refreshing";

  // While a create/refresh job is running in the background, poll for its
  // progressStep every 2s so the UI shows live status instead of looking
  // frozen for however long the rsync/container-clone/DB-dump takes.
  useEffect(() => {
    if (!isRefreshing) return;
    const interval = setInterval(onChanged, 2000);
    return () => clearInterval(interval);
  }, [isRefreshing, onChanged]);

  async function deleteDuplicate() {
    setDeleting(true);
    try {
      await apiJson(`/sites/${name}/duplicate`, { method: "DELETE" });
      onChanged();
    } finally {
      setDeleting(false);
    }
  }

  async function startRefresh() {
    // Reuse the DB the duplicate was originally created with — without this,
    // a refresh silently drops the database duplication (only content/
    // container would be recreated), since the backend only duplicates a DB
    // when dbLocation/dbRef/dbName are all present in the request.
    await apiJson(`/sites/${name}/duplicate`, {
      method: "POST",
      body: JSON.stringify({
        dbLocation: detail.duplicate?.dbLocation ?? undefined,
        dbRef: detail.duplicate?.dbRef ?? undefined,
        dbName: detail.duplicate?.dbName ?? undefined,
      }),
    });
    onChanged();
  }

  if (!detail.vhost.root && !detail.linkedContainer) {
    // Nothing to duplicate — no content root and no linked container.
    return null;
  }

  return (
    <div className="border-t border-border pt-3">
      <CardTitle>Duplicata</CardTitle>
      {isRefreshing ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {detail.duplicate?.progressStep ?? "Traitement…"}
        </div>
      ) : detail.duplicate ? (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          {detail.duplicate.status === "failed" && detail.duplicate.error && (
            <p className="text-destructive">Échec : {detail.duplicate.error}</p>
          )}
          {detail.duplicate.contentPath && <p>Contenu : {detail.duplicate.contentPath}</p>}
          {detail.duplicate.sizeBytes != null && <p>Taille (fichiers) : {formatBytes(detail.duplicate.sizeBytes)}</p>}
          {detail.duplicate.duplicateContainerName && (
            <p>
              Conteneur : {detail.duplicate.duplicateContainerName} (port {detail.duplicate.duplicatePort})
            </p>
          )}
          {detail.duplicate.duplicateDbName && (
            <p>
              Base de données : {detail.duplicate.duplicateDbName}
              {detail.duplicate.dbSizeBytes != null && ` (${formatBytes(detail.duplicate.dbSizeBytes)})`}
            </p>
          )}
          <p>Dernière synchro : {new Date(detail.duplicate.lastSyncedAt).toLocaleString()}</p>
          <p className="mt-1">
            Le duplicata est figé au moment de sa création — les modifications faites sur l'original depuis ne s'y
            reflètent pas automatiquement. "Mettre à jour" refait une copie complète et à jour (fichiers + base de
            données) à partir de l'original actuel.
          </p>

          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" disabled={detail.failoverActive} onClick={startRefresh}>
              Mettre à jour depuis l'original
            </Button>
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="destructive" disabled={deleting || detail.failoverActive}>
                  Supprimer
                </Button>
              }
              title="Supprimer le duplicata ?"
              description="Le contenu, la base de données et le conteneur dupliqués (le cas échéant) seront définitivement supprimés."
              confirmLabel="Supprimer"
              onConfirm={deleteDuplicate}
            />
          </div>
        </div>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            Aucun duplicata pour ce site. Créez-en un pour pouvoir basculer le trafic dessus en cas de panne.
          </p>
          <Button size="sm" variant="outline" onClick={() => setShowCreateDialog(true)}>
            <Copy className="h-3.5 w-3.5" /> Créer un duplicata
          </Button>
        </>
      )}

      {showCreateDialog && (
        <CreateDuplicateDialog
          name={name}
          hasRoot={!!detail.vhost.root}
          hasLinkedContainer={!!detail.linkedContainer}
          onClose={() => setShowCreateDialog(false)}
          onCreated={() => {
            setShowCreateDialog(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function CreateDuplicateDialog({
  name,
  hasRoot,
  hasLinkedContainer,
  onClose,
  onCreated,
}: {
  name: string;
  hasRoot: boolean;
  hasLinkedContainer: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [detectedDbs, setDetectedDbs] = useState<DetectedDatabase[] | null>(null);
  const [dbValue, setDbValue] = useState("");
  const [dbName, setDbName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiJson<DetectedDatabase[]>("/dbbackup/detect")
      .then(setDetectedDbs)
      .catch(() => setDetectedDbs([]));
  }, []);

  const selectedDb = detectedDbs?.find((d) => `${d.location}:${d.ref}` === dbValue);

  // Auto-select when there's exactly one database on the chosen instance —
  // no reason to make the admin pick from a list of one, and it removes the
  // main source of typo errors (a free-text field for the exact DB name).
  useEffect(() => {
    if (selectedDb?.databases?.length === 1) setDbName(selectedDb.databases[0]);
  }, [selectedDb]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const [dbLocation, dbRef] = dbValue ? dbValue.split(":") : [undefined, undefined];
      await apiJson(`/sites/${name}/duplicate`, {
        method: "POST",
        body: JSON.stringify({
          dbLocation: dbLocation || undefined,
          dbRef: dbRef || undefined,
          dbName: dbLocation ? dbName.trim() || undefined : undefined,
        }),
      });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border border-border p-3">
      <p className="mb-2 text-xs text-muted-foreground">
        {hasRoot && "Le contenu du dossier du site sera copié. "}
        {hasLinkedContainer && "Un second conteneur (même image, port différent) sera créé et démarré. "}
        Sélectionnez une base de données ci-dessous si ce site en utilise une.
      </p>

      <div className="mb-2">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Base de données (optionnel)</p>
        <select
          value={dbValue}
          onChange={(e) => {
            setDbValue(e.target.value);
            setDbName("");
          }}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
        >
          <option value="">Aucune</option>
          {detectedDbs?.map((d) => (
            <option key={`${d.location}:${d.ref}`} value={`${d.location}:${d.ref}`}>
              {d.displayName} ({d.engine})
            </option>
          ))}
        </select>
      </div>

      {selectedDb && (selectedDb.databases?.length ?? 0) > 1 && (
        <div className="mb-2">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Base précise</p>
          <select
            value={dbName}
            onChange={(e) => setDbName(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
          >
            <option value="">Choisir…</option>
            {selectedDb.databases?.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedDb && (selectedDb.databases?.length ?? 0) === 0 && (
        <p className="mb-2 text-xs text-destructive">Aucune base détectée sur cette instance.</p>
      )}

      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={submitting || (!!selectedDb && !dbName)}>
          {submitting ? "Création…" : "Créer"}
        </Button>
        <Button size="sm" variant="outline" onClick={onClose} disabled={submitting}>
          Annuler
        </Button>
      </div>
    </div>
  );
}
