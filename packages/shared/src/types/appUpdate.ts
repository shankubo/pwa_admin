/** State of a manually-triggered (or cron-triggered) run of deploy/auto-update.sh.
 * "idle" means no run is in progress — status reflects the *last* run, if any. */
export type AppUpdateRunStatus = "idle" | "running" | "up_to_date" | "succeeded" | "failed";

export interface AppUpdateStatus {
  status: AppUpdateRunStatus;
  /** Tail of data/auto-update.log written by the current or most recent run. */
  log: string;
  /** Commit deploy/auto-update.sh reported deploying, if the last run succeeded. */
  deployedCommit: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}
