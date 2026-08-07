import { useState } from "react";
import type { SystemStatsSnapshot, SystemAlert } from "@pwa-admin-pi/shared";
import { Card, CardTitle } from "@/components/ui/Card";
import { useWsChannel } from "@/lib/ws";
import { AlertTriangle, Cpu, Thermometer, HardDrive, MemoryStick } from "lucide-react";

function GaugeCard({
  icon: Icon,
  label,
  value,
  unit,
  severity,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  unit?: string;
  severity?: "warning" | "critical";
}) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <Icon
          className={
            severity === "critical"
              ? "h-5 w-5 text-destructive"
              : severity === "warning"
                ? "h-5 w-5 text-warning"
                : "h-5 w-5 text-primary"
          }
        />
        <CardTitle className="mb-0">{label}</CardTitle>
      </div>
      <p className="mt-1 text-2xl font-semibold">
        {value}
        {unit && <span className="ml-0.5 text-sm font-normal text-muted-foreground">{unit}</span>}
      </p>
    </Card>
  );
}

export function Dashboard() {
  const [stats, setStats] = useState<SystemStatsSnapshot | null>(null);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);

  useWsChannel("sys.stats", (frame) => setStats(frame.data as SystemStatsSnapshot));
  useWsChannel("sys.alerts", (frame) => setAlerts(frame.data as SystemAlert[]));

  const alertFor = (type: string) => alerts.find((a) => a.type === type)?.severity;
  const primaryDisk = stats?.disks[0];

  return (
    <div className="flex flex-col gap-4">
      {alerts.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{alerts.length} alerte(s) active(s) — voir System pour le détail.</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <GaugeCard
          icon={Cpu}
          label="CPU"
          value={stats ? stats.cpu.loadPercent.toFixed(0) : "…"}
          unit="%"
          severity={alertFor("cpu_load")}
        />
        <GaugeCard
          icon={Thermometer}
          label="Température"
          value={stats?.cpu.temperatureC != null ? stats.cpu.temperatureC.toFixed(1) : "…"}
          unit="°C"
          severity={alertFor("cpu_temp")}
        />
        <GaugeCard
          icon={MemoryStick}
          label="RAM"
          value={stats ? stats.memory.usedPercent.toFixed(0) : "…"}
          unit="%"
          severity={alertFor("memory_usage")}
        />
        <GaugeCard
          icon={HardDrive}
          label="Disque"
          value={primaryDisk ? primaryDisk.usedPercent.toFixed(0) : "…"}
          unit="%"
          severity={alertFor("disk_usage")}
        />
      </div>

      <Card>
        <CardTitle>Uptime</CardTitle>
        <p className="text-lg font-medium">
          {stats ? formatUptime(stats.uptimeSeconds) : "…"}
        </p>
      </Card>

      <Card>
        <CardTitle>Système</CardTitle>
        <p className="text-sm">{stats ? `${stats.os.distro} — noyau ${stats.os.kernel}` : "…"}</p>
      </Card>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}j ${hours}h ${minutes}m`;
}
