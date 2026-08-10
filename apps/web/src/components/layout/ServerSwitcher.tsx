import { useState } from "react";
import { Server, Plus, Trash2 } from "lucide-react";
import { useServerConnectionsStore } from "@/stores/serverConnections.store";
import { Button } from "@/components/ui/Button";

/** Switches between fully independent pwa-admin deployments (own DB, own
 * auth, own Tailscale identity) registered client-side — not a remote-host
 * proxy. Switching navigates to the other server's own /login, since a
 * refresh-token cookie doesn't cross origins. */
export function ServerSwitcher() {
  const { servers, addServer, removeServer } = useServerConnectionsStore();
  const [open, setOpen] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const currentOrigin = window.location.origin;

  function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !baseUrl.trim()) return;
    addServer({ id: crypto.randomUUID(), label: label.trim(), baseUrl: baseUrl.trim().replace(/\/$/, "") });
    setLabel("");
    setBaseUrl("");
    setShowAddForm(false);
  }

  function switchTo(url: string) {
    window.location.href = `${url}/login`;
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Changer de serveur"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md p-2 hover:bg-muted"
      >
        <Server className="h-5 w-5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-md border border-border bg-card p-2 shadow-lg">
          <p className="px-1 text-xs font-medium text-muted-foreground">Serveur actuel</p>
          <p className="mb-2 truncate px-1 text-sm">{currentOrigin}</p>

          {servers.length > 0 && (
            <>
              <p className="px-1 text-xs font-medium text-muted-foreground">Autres serveurs</p>
              <div className="mb-2 flex flex-col gap-1">
                {servers.map((s) => (
                  <div key={s.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => switchTo(s.baseUrl)}
                      className="flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      {s.label}
                      <span className="ml-1 text-xs text-muted-foreground">{s.baseUrl}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Retirer ${s.label}`}
                      onClick={() => removeServer(s.id)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {showAddForm ? (
            <form onSubmit={submitAdd} className="flex flex-col gap-1">
              <input
                type="text"
                placeholder="Nom (ex: Pi)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              <input
                type="text"
                placeholder="https://…tailnet.ts.net:8443"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              <div className="flex gap-1">
                <Button type="submit" size="sm">
                  Ajouter
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>
                  Annuler
                </Button>
              </div>
            </form>
          ) : (
            <Button size="sm" variant="outline" className="w-full" onClick={() => setShowAddForm(true)}>
              <Plus className="h-3.5 w-3.5" /> Ajouter un serveur
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
