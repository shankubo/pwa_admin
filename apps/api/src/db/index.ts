import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../config/env.js";
import { runMigrations } from "./migrate.js";

mkdirSync(dirname(env.SQLITE_PATH), { recursive: true });

export const db = new Database(env.SQLITE_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

runMigrations(db);

// A job's status only ever transitions to succeeded/failed via its spawned
// child process's own "close" event (AptJobRunner.start) — if the service
// itself is restarted while a job is running (e.g. mid-deploy), that event
// never fires: the child is killed alongside the parent, but the os_jobs row
// stays stuck at "running" forever, and the WS channel keyed to that jobId
// has no live pusher left, leaving the frontend's job panel stuck on "en
// attente de données…" indefinitely with no way to recover short of a
// manual DB edit. Run once at every boot, before anything else can read
// os_jobs, so a job interrupted by a restart is always visible as failed
// rather than silently stuck.
db.prepare("UPDATE os_jobs SET status = 'failed', finished_at = datetime('now') WHERE status = 'running'").run();
