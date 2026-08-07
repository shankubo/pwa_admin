import { useEffect, useState } from "react";
import type { SystemStatsSnapshot, SystemAlert, HardwareOverview, WifiNetwork, WifiStatus } from "@pwa-admin-pi/shared";
import { apiJson } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useWsChannel } from "@/lib/ws";
import { formatBytes } from "./Docker";
import {
  AlertTriangle,
  Cpu,
  Thermometer,
  HardDrive,
  MemoryStick,
  Wifi,
  Server,
  Zap,
  Clock,
  Network,
  ShieldCheck,
  ListChecks,
  RefreshCw,
} from "lucide-react";

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}j ${hours}h ${minutes}m`;
}

function severityClass(severity: "warning" | "critical") {
  return severity === "critical"
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : "border-warning/40 bg-warning/10 text-warning";
}

export function System() {
  const [stats, setStats] = useState<SystemStatsSnapshot | null>(null);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [overview, setOverview] = useState<HardwareOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  useWsChannel("sys.stats", (frame) => setStats(frame.data as SystemStatsSnapshot));
  useWsChannel("sys.alerts", (frame) => setAlerts(frame.data as SystemAlert[]));

  function loadOverview() {
    return apiJson<HardwareOverview>("/hardware/overview")
      .then(setOverview)
      .catch((err) => setOverviewError((err as Error).message));
  }

  useEffect(() => {
    loadOverview();
    const interval = setInterval(loadOverview, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Alertes actives</h2>
        {alerts.length === 0 ? (
          <Card className="text-sm text-muted-foreground">Aucune alerte active.</Card>
        ) : (
          <div className="flex flex-col gap-2">
            {alerts.map((a) => (
              <div key={a.id} className={`flex items-start gap-2 rounded-md border p-3 text-sm ${severityClass(a.severity)}`}>
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-medium">{a.message}</p>
                  <p className="text-xs opacity-80">
                    {a.type} · {new Date(a.raisedAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            <CardTitle className="mb-0">CPU</CardTitle>
          </div>
          <p className="mt-1 text-2xl font-semibold">
            {stats ? stats.cpu.loadPercent.toFixed(0) : "…"}
            <span className="ml-0.5 text-sm font-normal text-muted-foreground">%</span>
          </p>
        </Card>
        <Card>
          <div className="flex items-center gap-2">
            <Thermometer className="h-5 w-5 text-primary" />
            <CardTitle className="mb-0">Température</CardTitle>
          </div>
          <p className="mt-1 text-2xl font-semibold">
            {stats?.cpu.temperatureC != null ? stats.cpu.temperatureC.toFixed(1) : "…"}
            <span className="ml-0.5 text-sm font-normal text-muted-foreground">°C</span>
          </p>
          {stats?.cpu.throttled?.throttled && (
            <p className="mt-1 text-xs text-destructive">Throttling actif</p>
          )}
          {stats?.cpu.throttled?.underVoltage && (
            <p className="text-xs text-destructive">Sous-tension détectée</p>
          )}
        </Card>
        <Card>
          <div className="flex items-center gap-2">
            <MemoryStick className="h-5 w-5 text-primary" />
            <CardTitle className="mb-0">RAM</CardTitle>
          </div>
          <p className="mt-1 text-2xl font-semibold">
            {stats ? stats.memory.usedPercent.toFixed(0) : "…"}
            <span className="ml-0.5 text-sm font-normal text-muted-foreground">%</span>
          </p>
          {stats && (
            <p className="text-xs text-muted-foreground">
              {formatBytes(stats.memory.usedBytes)} / {formatBytes(stats.memory.totalBytes)}
            </p>
          )}
        </Card>
        <Card>
          <CardTitle>Uptime</CardTitle>
          <p className="text-lg font-medium">{stats ? formatUptime(stats.uptimeSeconds) : "…"}</p>
        </Card>
      </div>

      <div>
        <h2 className="mb-2 flex items-center gap-1 text-sm font-semibold text-muted-foreground">
          <HardDrive className="h-4 w-4" /> Disques
        </h2>
        <div className="flex flex-col gap-2">
          {stats?.disks.length ? (
            stats.disks.map((d) => (
              <Card key={d.mount}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-mono">{d.mount}</span>
                  <span>{d.usedPercent.toFixed(0)}%</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(d.usedBytes)} / {formatBytes(d.totalBytes)}
                </p>
              </Card>
            ))
          ) : (
            <Card className="text-sm text-muted-foreground">Chargement…</Card>
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-2 flex items-center gap-1 text-sm font-semibold text-muted-foreground">
          <Wifi className="h-4 w-4" /> Réseau
        </h2>
        <div className="flex flex-col gap-2">
          {stats?.network.length ? (
            stats.network.map((n) => (
              <Card key={n.iface}>
                <p className="text-sm font-medium">{n.iface}</p>
                <p className="text-xs text-muted-foreground">
                  ↓ {formatBytes(n.rxBytesPerSec)}/s · ↑ {formatBytes(n.txBytesPerSec)}/s
                </p>
              </Card>
            ))
          ) : (
            <Card className="text-sm text-muted-foreground">Chargement…</Card>
          )}
        </div>
      </div>

      <Card>
        <CardTitle>Système d'exploitation</CardTitle>
        {stats ? (
          <div className="text-sm">
            <p>{stats.os.distro} {stats.os.release}</p>
            <p className="text-xs text-muted-foreground">
              {stats.os.platform} · noyau {stats.os.kernel} · {stats.os.arch}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        )}
      </Card>

      {overviewError && <Card className="text-sm text-destructive">{overviewError}</Card>}

      <Card>
        <CardTitle className="flex items-center gap-1">
          <Server className="h-4 w-4" /> Matériel
        </CardTitle>
        {overview ? (
          <div className="flex flex-col gap-1 text-sm">
            <p>{overview.hardware.model ?? "Modèle inconnu"}</p>
            <p className="text-xs text-muted-foreground">
              {overview.hardware.serial && `N° série ${overview.hardware.serial}`}
              {overview.hardware.revision && ` · rév. ${overview.hardware.revision}`}
            </p>
            {(overview.hardware.cpuVoltage != null || overview.hardware.coreVoltage != null) && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Zap className="h-3 w-3" />
                {overview.hardware.cpuVoltage != null && `Core ${overview.hardware.cpuVoltage.toFixed(4)} V`}
                {overview.hardware.coreVoltage != null && ` · SDRAM ${overview.hardware.coreVoltage.toFixed(4)} V`}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        )}
      </Card>

      <Card>
        <CardTitle className="flex items-center gap-1">
          <Clock className="h-4 w-4" /> Date et heure de la machine
        </CardTitle>
        {overview ? (
          <div className="text-sm">
            <p>{new Date(overview.clock.isoTime).toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">
              Fuseau {overview.clock.timezone}
              {overview.clock.ntpSynchronized != null &&
                (overview.clock.ntpSynchronized ? " · synchronisée (NTP)" : " · non synchronisée")}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        )}
      </Card>

      <div>
        <h2 className="mb-2 flex items-center gap-1 text-sm font-semibold text-muted-foreground">
          <Network className="h-4 w-4" /> Interfaces & adresses IP
        </h2>
        <div className="flex flex-col gap-2">
          {overview?.interfaces.length ? (
            overview.interfaces.map((i) => (
              <Card key={i.name}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {i.name}
                    {i.isDefault && (
                      <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        défaut
                      </span>
                    )}
                  </p>
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-xs font-medium " +
                      (i.state === "up" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")
                    }
                  >
                    {i.state}
                  </span>
                </div>
                {i.addresses.length > 0 && (
                  <p className="text-xs text-muted-foreground">{i.addresses.join(" · ")}</p>
                )}
                {i.mac && <p className="text-xs text-muted-foreground">{i.mac}</p>}
              </Card>
            ))
          ) : (
            <Card className="text-sm text-muted-foreground">Chargement…</Card>
          )}
        </div>
      </div>

      {overview && <WifiManagerCard status={overview.wifi} onChanged={loadOverview} />}

      <Card>
        <CardTitle className="flex items-center gap-1">
          <ShieldCheck className="h-4 w-4" /> SSH
        </CardTitle>
        {overview ? (
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center gap-2">
              <span
                className={
                  "rounded-full px-2 py-0.5 text-xs font-medium " +
                  (overview.ssh.active ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive")
                }
              >
                {overview.ssh.active ? "actif" : "inactif"}
              </span>
              <span className="text-xs text-muted-foreground">
                {overview.ssh.enabled ? "démarrage auto activé" : "démarrage auto désactivé"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Port {overview.ssh.port ?? 22}
              {overview.ssh.passwordAuthEnabled != null &&
                (overview.ssh.passwordAuthEnabled
                  ? " · authentification par mot de passe activée"
                  : " · authentification par mot de passe désactivée (clé uniquement)")}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        )}
      </Card>

      {overview && (overview.failedUnits.length > 0 || overview.runningServicesCount > 0) && (
        <div>
          <h2 className="mb-2 flex items-center gap-1 text-sm font-semibold text-muted-foreground">
            <ListChecks className="h-4 w-4" /> Services système
          </h2>
          <Card className="mb-2 text-xs text-muted-foreground">
            {overview.runningServicesCount} service(s) actif(s)
            {overview.failedUnits.length > 0 && ` · ${overview.failedUnits.length} en échec`}
          </Card>
          {overview.failedUnits.map((u) => (
            <Card key={u.name} className="mb-2 border-destructive/40 bg-destructive/10">
              <p className="text-sm font-medium text-destructive">{u.name}</p>
              <p className="text-xs text-muted-foreground">
                {u.description || "—"} · {u.activeState}/{u.subState}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function WifiManagerCard({ status, onChanged }: { status: WifiStatus; onChanged: () => void }) {
  const [scanning, setScanning] = useState(false);
  const [networks, setNetworks] = useState<WifiNetwork[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectingTo, setConnectingTo] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      setNetworks(await apiJson<WifiNetwork[]>("/hardware/wifi/scan"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScanning(false);
    }
  }

  async function connect(ssid: string) {
    setBusy(true);
    setError(null);
    try {
      await apiJson("/hardware/wifi/connect", { method: "POST", body: JSON.stringify({ ssid, password }) });
      setConnectingTo(null);
      setPassword("");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!status.deviceName) return;
    setBusy(true);
    try {
      await apiJson("/hardware/wifi/disconnect", {
        method: "POST",
        body: JSON.stringify({ deviceName: status.deviceName }),
      });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!status.available) {
    return (
      <Card>
        <CardTitle className="flex items-center gap-1">
          <Wifi className="h-4 w-4" /> Wi-Fi
        </CardTitle>
        <p className="text-sm text-muted-foreground">Aucun adaptateur Wi-Fi détecté.</p>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle className="flex items-center gap-1">
        <Wifi className="h-4 w-4" /> Wi-Fi ({status.deviceName})
      </CardTitle>

      <div className="mb-2 flex items-center gap-2 text-sm">
        <span
          className={
            "rounded-full px-2 py-0.5 text-xs font-medium " +
            (status.connected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")
          }
        >
          {status.connected ? "connecté" : "déconnecté"}
        </span>
        {status.connected && status.currentSsid && <span>{status.currentSsid}</span>}
        {status.signal != null && <span className="text-xs text-muted-foreground">{status.signal}%</span>}
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={scanning} onClick={scan}>
          <RefreshCw className="h-3.5 w-3.5" /> {scanning ? "Scan…" : "Scanner"}
        </Button>
        {status.connected && (
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="destructive" disabled={busy}>
                Déconnecter
              </Button>
            }
            title="Déconnecter le Wi-Fi ?"
            description="La connexion réseau via Wi-Fi sera coupée."
            confirmLabel="Déconnecter"
            onConfirm={disconnect}
          />
        )}
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {networks && (
        <div className="mt-3 flex flex-col gap-1">
          {networks.length === 0 && <p className="text-xs text-muted-foreground">Aucun réseau détecté.</p>}
          {networks.map((n) => (
            <div key={n.ssid} className="rounded-md border border-border p-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {n.ssid} {n.inUse && <span className="text-xs text-primary">(actuel)</span>}
                </span>
                <span className="text-xs text-muted-foreground">
                  {n.signal}% · {n.security || "ouvert"}
                </span>
              </div>
              {connectingTo === n.ssid ? (
                <div className="mt-2 flex gap-2">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mot de passe"
                    className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary"
                    autoFocus
                  />
                  <Button size="sm" disabled={busy || password.length < 8} onClick={() => connect(n.ssid)}>
                    Connecter
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setConnectingTo(null); setPassword(""); }}>
                    Annuler
                  </Button>
                </div>
              ) : (
                !n.inUse && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setConnectingTo(n.ssid)}>
                    Se connecter
                  </Button>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
