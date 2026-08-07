export type Pm2Status = "online" | "stopping" | "stopped" | "launching" | "errored" | "one-launch-status";

export interface Pm2Process {
  pmId: number;
  name: string;
  pid: number | null;
  status: Pm2Status;
  cpuPercent: number;
  memoryBytes: number;
  restarts: number;
  uptimeMs: number | null;
  scriptPath: string | null;
  cwd: string | null;
  nodeVersion: string | null;
}
