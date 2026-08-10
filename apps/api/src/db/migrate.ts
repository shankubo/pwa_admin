import type Database from "better-sqlite3";

interface Migration {
  id: number;
  name: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    id: 1,
    name: "init_users_and_audit",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          totp_secret TEXT,
          totp_enabled INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS refresh_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          revoked INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS login_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL,
          ip TEXT NOT NULL,
          success INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id),
          action TEXT NOT NULL,
          target TEXT,
          result TEXT NOT NULL,
          source_ip TEXT,
          detail TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS system_stats_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sampled_at TEXT NOT NULL DEFAULT (datetime('now')),
          cpu_load_pct REAL,
          cpu_temp_c REAL,
          mem_used_pct REAL,
          disk_used_pct REAL
        );
      `);
    },
  },
  {
    id: 2,
    name: "backups_and_jobs",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS backup_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_ref TEXT NOT NULL,
          targets TEXT NOT NULL,
          schedule_cron TEXT,
          retention_days INTEGER,
          retention_min_copies INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS backup_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL UNIQUE,
          job_id INTEGER REFERENCES backup_jobs(id) ON DELETE SET NULL,
          type TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_ref TEXT NOT NULL,
          target TEXT NOT NULL,
          status TEXT NOT NULL,
          file_path TEXT,
          size_bytes INTEGER,
          checksum_sha256 TEXT,
          drive_file_id TEXT,
          duration_ms INTEGER,
          error TEXT,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          finished_at TEXT
        );

        CREATE TABLE IF NOT EXISTS nginx_config_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          vhost_name TEXT NOT NULL,
          snapshot_path TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS os_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          log_path TEXT,
          exit_code INTEGER,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          finished_at TEXT
        );
      `);
    },
  },
  {
    id: 3,
    name: "applications",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS applications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          container_names TEXT NOT NULL DEFAULT '[]',
          paths TEXT NOT NULL DEFAULT '[]',
          db_location TEXT,
          db_ref TEXT,
          targets TEXT NOT NULL DEFAULT '["local"]',
          schedule_full_cron TEXT,
          schedule_partial_cron TEXT,
          retention_days INTEGER,
          retention_min_copies INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS app_backup_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL UNIQUE,
          app_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          snapshot_dir TEXT NOT NULL,
          db_dump_path TEXT,
          db_drive_file_id TEXT,
          status TEXT NOT NULL,
          files_changed INTEGER,
          size_bytes INTEGER,
          error TEXT,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          finished_at TEXT
        );
      `);
    },
  },
  {
    id: 4,
    name: "app_backup_drive_upload_tracking",
    up: (db) => {
      db.exec(`
        ALTER TABLE app_backup_runs ADD COLUMN drive_upload_status TEXT NOT NULL DEFAULT 'none';
        ALTER TABLE app_backup_runs ADD COLUMN drive_upload_progress_pct INTEGER;
        ALTER TABLE app_backup_runs ADD COLUMN drive_file_ids TEXT;
        ALTER TABLE app_backup_runs ADD COLUMN drive_upload_error TEXT;
      `);
    },
  },
  {
    id: 5,
    name: "vhost_maintenance",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS vhost_maintenance (
          vhost_name TEXT PRIMARY KEY,
          snapshot_id INTEGER NOT NULL REFERENCES nginx_config_history(id),
          enabled_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    id: 6,
    name: "access_tokens",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS access_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          label TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_used_at TEXT
        );
      `);
    },
  },
  {
    id: 7,
    name: "backup_history_usb_path",
    up: (db) => {
      db.exec(`
        ALTER TABLE backup_history ADD COLUMN usb_path TEXT;
      `);
    },
  },
  {
    id: 8,
    name: "app_backup_usb_copy_tracking",
    up: (db) => {
      db.exec(`
        ALTER TABLE app_backup_runs ADD COLUMN usb_copy_status TEXT NOT NULL DEFAULT 'none';
        ALTER TABLE app_backup_runs ADD COLUMN usb_copy_progress_pct INTEGER;
        ALTER TABLE app_backup_runs ADD COLUMN usb_paths TEXT;
        ALTER TABLE app_backup_runs ADD COLUMN usb_copy_error TEXT;
      `);
    },
  },
  {
    id: 9,
    name: "applications_volume_names",
    up: (db) => {
      db.exec(`
        ALTER TABLE applications ADD COLUMN volume_names TEXT NOT NULL DEFAULT '[]';
      `);
    },
  },
  {
    id: 10,
    name: "site_duplicates_and_failover",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS site_duplicates (
          vhost_name TEXT PRIMARY KEY,
          content_path TEXT,
          db_location TEXT,
          db_ref TEXT,
          db_name TEXT,
          duplicate_db_name TEXT,
          duplicate_container_id TEXT,
          duplicate_container_name TEXT,
          duplicate_port INTEGER,
          status TEXT NOT NULL DEFAULT 'ready',
          last_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS vhost_failover (
          vhost_name TEXT PRIMARY KEY,
          snapshot_id INTEGER NOT NULL REFERENCES nginx_config_history(id),
          switched_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((row) => (row as { id: number }).id)
  );

  const insertMigration = db.prepare(
    "INSERT INTO schema_migrations (id, name) VALUES (?, ?)"
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    const runMigration = db.transaction(() => {
      migration.up(db);
      insertMigration.run(migration.id, migration.name);
    });
    runMigration();
  }
}
