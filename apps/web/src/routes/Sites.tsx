import { useEffect, useState } from "react";
import type { SiteSummary, SiteDetail, DetectedDatabase } from "@pwa-admin/shared";
import { apiFetch, apiJson } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LiveLogPanel } from "@/components/LiveLogPanel";
import { formatBytes } from "./Docker";
import { ChevronDown, ChevronUp, Globe, ExternalLink, Copy } from "lucide-react";

function siteUrl(s: SiteSummary): string | null {
  const host = s.serverNames.find((n) => n !== "_");
  if (!host) return null;
  const scheme = s.listenPorts.includes(443) ? "https" : "http";
  return `${scheme}://${host}/`;
}

function certBadgeClass(daysRemaining: number | null) {
  if (daysRemaining == null) return "bg-muted text-muted-foreground";
  if (daysRemaining < 14) return "bg-destructive/15 text-destructive";
  if (daysRemaining < 30) return "bg-warning/15 text-warning";
  return "bg-primary/15 text-primary";
}

export function Sites() {
  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setSites(await apiJson<SiteSummary[]>("/sites"));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggle(name: string, enabled: boolean) {
    await apiJson(`/sites/${name}/${enabled ? "disable" : "enable"}`, { method: "POST" });
    await load();
  }

  async function toggleMaintenance(name: string, maintenanceMode: boolean) {
    await apiJson(`/sites/${name}/maintenance/${maintenanceMode ? "disable" : "enable"}`, { method: "POST" });
    await load();
  }

  async function switchFailover(name: string, action: "switch" | "revert") {
    await apiJson(`/sites/${name}/failover/${action}`, { method: "POST" });
    await load();
  }

  if (error) return <Card className="text-sm text-destructive">{error}</Card>;
  if (!sites) return <Card className="text-sm text-muted-foreground">Chargement…</Card>;
  if (sites.length === 0) return <Card className="text-sm text-muted-foreground">Aucun site.</Card>;

  return (
    <div className="flex flex-col gap-3">
      {sites.map((s) => (
        <Card key={s.name}>
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

          <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
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
        <LiveLogPanel initialText={logText} emptyLabel="Aucun log." />
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
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function deleteDuplicate() {
    setDeleting(true);
    try {
      await apiJson(`/sites/${name}/duplicate`, { method: "DELETE" });
      onChanged();
    } finally {
      setDeleting(false);
    }
  }

  if (!detail.vhost.root && !detail.linkedContainer) {
    // Nothing to duplicate — no content root and no linked container.
    return null;
  }

  return (
    <div className="border-t border-border pt-3">
      <CardTitle>Duplicata</CardTitle>
      {detail.duplicate ? (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          {detail.duplicate.contentPath && <p>Contenu : {detail.duplicate.contentPath}</p>}
          {detail.duplicate.sizeBytes != null && <p>Taille : {formatBytes(detail.duplicate.sizeBytes)}</p>}
          {detail.duplicate.duplicateContainerName && (
            <p>
              Conteneur : {detail.duplicate.duplicateContainerName} (port {detail.duplicate.duplicatePort})
            </p>
          )}
          {detail.duplicate.duplicateDbName && <p>Base de données : {detail.duplicate.duplicateDbName}</p>}
          <p>Dernière synchro : {new Date(detail.duplicate.lastSyncedAt).toLocaleString()}</p>

          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={refreshing || detail.failoverActive}
              onClick={async () => {
                setRefreshing(true);
                try {
                  await apiJson(`/sites/${name}/duplicate`, { method: "POST", body: JSON.stringify({}) });
                  onChanged();
                } finally {
                  setRefreshing(false);
                }
              }}
            >
              {refreshing ? "Rafraîchissement…" : "Rafraîchir"}
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
          detail={detail}
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
  detail,
  onClose,
  onCreated,
}: {
  name: string;
  detail: SiteDetail;
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
        {detail.vhost.root && "Le contenu du dossier du site sera copié. "}
        {detail.linkedContainer && "Un second conteneur (même image, port différent) sera créé et démarré. "}
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

      {selectedDb && selectedDb.location === "native" && (
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

      {selectedDb && selectedDb.location === "docker" && (
        <div className="mb-2">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Nom exact de la base dans le conteneur</p>
          <input
            type="text"
            value={dbName}
            onChange={(e) => setDbName(e.target.value)}
            placeholder="ex: myapp"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
          />
        </div>
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
