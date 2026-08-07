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
