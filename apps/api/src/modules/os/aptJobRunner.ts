import { randomUUID } from "node:crypto";
import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../../db/index.js";
import { env } from "../../config/env.js";
import { spawnCommand } from "../../utils/exec.js";
import { registerChannel } from "../../services/wsHub.js";
import type { OsJob, OsJobKind } from "@pwa-admin/shared";

let jobRunning = false;
const jobPushers = new Map<string, Set<(data: unknown) => void>>();

registerChannel("os.upgrade", (params, push) => {
  const jobId = params.jobId as string;
  let set = jobPushers.get(jobId);
  if (!set) {
    set = new Set();
    jobPushers.set(jobId, set);
  }
  set.add(push);
  return () => {
    set!.delete(push);
    if (set!.size === 0) jobPushers.delete(jobId);
  };
});

function broadcast(jobId: string, data: unknown) {
  const set = jobPushers.get(jobId);
  if (set) for (const push of set) push(data);
}

function rowToJob(row: any): OsJob {
  return {
    jobId: row.job_id,
    kind: row.kind,
    status: row.status,
    exitCode: row.exit_code,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export const AptJobRunner = {
  isRunning(): boolean {
    return jobRunning;
  },

  async start(kind: OsJobKind, bin: string, args: string[]): Promise<string> {
    if (jobRunning) throw new Error("job_already_running");
    jobRunning = true;

    const jobId = randomUUID();
    await mkdir(env.APT_JOB_LOG_DIR, { recursive: true });
    const logPath = join(env.APT_JOB_LOG_DIR, `${jobId}.log`);

    db.prepare(
      "INSERT INTO os_jobs (job_id, kind, status, log_path) VALUES (?, ?, 'running', ?)"
    ).run(jobId, kind, logPath);

    const child = spawnCommand(bin, args);

    const onData = async (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      await appendFile(logPath, text).catch(() => {});
      broadcast(jobId, text);
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.on("close", (code) => {
      jobRunning = false;
      const status = code === 0 ? "succeeded" : "failed";
      db.prepare(
        "UPDATE os_jobs SET status = ?, exit_code = ?, finished_at = datetime('now') WHERE job_id = ?"
      ).run(status, code, jobId);
      broadcast(jobId, { done: true, exitCode: code, status });
    });

    child.on("error", () => {
      jobRunning = false;
      db.prepare(
        "UPDATE os_jobs SET status = 'failed', finished_at = datetime('now') WHERE job_id = ?"
      ).run(jobId);
      broadcast(jobId, { done: true, exitCode: -1, status: "failed" });
    });

    return jobId;
  },

  getJob(jobId: string): OsJob | undefined {
    const row = db.prepare("SELECT * FROM os_jobs WHERE job_id = ?").get(jobId);
    return row ? rowToJob(row) : undefined;
  },

  getJobLogPath(jobId: string): string | undefined {
    const row = db.prepare("SELECT log_path FROM os_jobs WHERE job_id = ?").get(jobId) as
      | { log_path: string }
      | undefined;
    return row?.log_path;
  },

  listJobs(): OsJob[] {
    return (db.prepare("SELECT * FROM os_jobs ORDER BY started_at DESC").all() as any[]).map(rowToJob);
  },
};
