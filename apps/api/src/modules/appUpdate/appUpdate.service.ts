import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../../config/env.js";
import { runCommand } from "../../utils/exec.js";
import type { AppUpdateRunStatus, AppUpdateStatus } from "@pwa-admin/shared";

const LOG_PATH = join(env.APP_DIR, "data", "auto-update.log");
const LOG_TAIL_CHARS = 20_000;
const DEPLOYED_RE = /Deployed ([0-9a-f]{7,40}) and restarted pwa-admin successfully/g;

let running = false;
let lastFinishedAt: string | null = null;
let lastDeployedCommit: string | null = null;
// "running" set by start() and cleared once the deploy's restart cycles this
// process — the in-memory flag never survives that restart to see itself
// resolved, so getStatus() falls back to reading the log's own last line
// whenever this is still "idle"/"running" at read time (see getStatus).
let lastStatus: AppUpdateRunStatus = "idle";

async function tailLog(): Promise<string> {
  try {
    const content = await readFile(LOG_PATH, "utf8");
    return content.length > LOG_TAIL_CHARS ? content.slice(-LOG_TAIL_CHARS) : content;
  } catch {
    return "";
  }
}

async function currentHeadCommit(): Promise<string | null> {
  try {
    const { stdout } = await runCommand("git", ["-C", env.APP_DIR, "rev-parse", "--short", "HEAD"], {
      timeoutMs: 5000,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

export const AppUpdateService = {
  isRunning(): boolean {
    return running;
  },

  /**
   * Runs the exact same script the cron uses (deploy/auto-update.sh), on
   * demand rather than waiting for the next poll — same fetch/pull/rebuild
   * logic, same log file, so this and the cron never disagree about state.
   * The child is detached: the script's own final step is `sudo systemctl
   * restart pwa-admin`, which kills THIS Node process mid-script on a
   * successful run, before its own `exit` handler below ever fires — so a
   * successful run's terminal state is recovered by getStatus() reading the
   * log fresh after the restart, not by this function's own bookkeeping.
   */
  async start(): Promise<void> {
    if (running) throw new Error("update_already_running");
    running = true;
    lastStatus = "running";

    const scriptPath = join(env.APP_DIR, "deploy", "auto-update.sh");
    const child = spawn("bash", [scriptPath, env.APP_DIR], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    // Only reachable for a failed run or a no-op (nothing to deploy) — a
    // successful run kills this process before "exit" fires.
    const finish = async (code: number | null) => {
      running = false;
      lastFinishedAt = new Date().toISOString();
      if (code !== 0) {
        lastStatus = "failed";
        return;
      }
      lastStatus = "up_to_date";
    };

    child.on("exit", (code) => void finish(code));
    child.on("error", () => void finish(-1));
  },

  async getStatus(): Promise<AppUpdateStatus> {
    const log = await tailLog();

    // Recover a run's outcome from the log itself whenever this process's
    // own in-memory state can't be trusted: right after boot (a restart may
    // have just deployed successfully, wiping the flags above with it) or
    // mid-"running" for longer than a rebuild should ever take (the restart
    // never happened — sudo prompt, build failure the script didn't catch).
    if (lastStatus === "idle" || lastStatus === "running") {
      const matches = [...log.matchAll(DEPLOYED_RE)];
      const lastMatch = matches[matches.length - 1];
      if (lastMatch) {
        const head = await currentHeadCommit();
        if (head && lastMatch[1].startsWith(head)) {
          lastStatus = "succeeded";
          lastDeployedCommit = lastMatch[1];
        }
      }
    }

    return {
      status: lastStatus,
      log,
      deployedCommit: lastDeployedCommit,
      startedAt: null,
      finishedAt: lastFinishedAt,
    };
  },
};
