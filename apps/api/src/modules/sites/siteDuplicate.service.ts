import { mkdir } from "node:fs/promises";
import { dirname, basename, join, resolve, sep } from "node:path";
import { db } from "../../db/index.js";
import { runCommand } from "../../utils/exec.js";
import { dirSize } from "../../utils/dirSize.js";
import { docker } from "../../services/docker.client.js";
import { NginxService } from "../nginx/nginx.service.js";
import { DbBackupService } from "../dbbackup/dbbackup.service.js";
import { DockerService } from "../docker/docker.service.js";
import type { SiteDuplicateStatus } from "@pwa-admin/shared";

// Matches the sudoers rsync/rm rule's scope (deploy/sudoers.d/pwa-admin) —
// site roots are only ever supposed to live here on this server.
const SITE_ROOTS_PARENT = "/var/www";

interface SiteDuplicateRow {
  vhost_name: string;
  content_path: string | null;
  db_location: "docker" | "native" | null;
  db_ref: string | null;
  db_name: string | null;
  duplicate_db_name: string | null;
  duplicate_container_id: string | null;
  duplicate_container_name: string | null;
  duplicate_port: number | null;
  status: string;
  progress_step: string | null;
  error: string | null;
  last_synced_at: string;
  created_at: string;
}

function rowToStatus(row: SiteDuplicateRow, sizeBytes: number | null, dbSizeBytes: number | null): SiteDuplicateStatus {
  return {
    vhostName: row.vhost_name,
    contentPath: row.content_path,
    dbLocation: row.db_location,
    dbRef: row.db_ref,
    dbName: row.db_name,
    duplicateDbName: row.duplicate_db_name,
    duplicateContainerId: row.duplicate_container_id,
    duplicateContainerName: row.duplicate_container_name,
    duplicatePort: row.duplicate_port,
    status: row.status as SiteDuplicateStatus["status"],
    progressStep: row.progress_step,
    error: row.error,
    sizeBytes,
    dbSizeBytes,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
  };
}

function setProgress(vhostName: string, step: string): void {
  db.prepare(
    `INSERT INTO site_duplicates (vhost_name, status, progress_step, error, last_synced_at)
     VALUES (?, 'refreshing', ?, NULL, datetime('now'))
     ON CONFLICT(vhost_name) DO UPDATE SET status = 'refreshing', progress_step = excluded.progress_step, error = NULL`
  ).run(vhostName, step);
}

function getRow(vhostName: string): SiteDuplicateRow | undefined {
  return db.prepare("SELECT * FROM site_duplicates WHERE vhost_name = ?").get(vhostName) as
    | SiteDuplicateRow
    | undefined;
}

/** Finds a matching container the same way sites.service.ts does — a
 * container whose published port appears as a substring of the vhost's
 * proxy_pass target. Exported for reuse by MigrationService's per-site
 * capture, which needs the same heuristic to scope a snapshot to one site's
 * linked container. */
export async function findLinkedContainer(proxyPassTarget: string | null) {
  if (!proxyPassTarget) return null;
  const containers = await DockerService.listContainers();
  return (
    containers.find((c) => c.ports.some((p) => proxyPassTarget.includes(String(p.publicPort ?? p.privatePort)))) ??
    null
  );
}

/** Finds a free host port near the original, checking against currently
 * published container ports. Tries originalPort+1 upward through a bounded
 * range rather than a full system port scan — good enough since this only
 * needs to avoid colliding with other containers this app already knows about. */
async function findFreePortNear(originalPort: number): Promise<number> {
  const containers = await DockerService.listContainers();
  const usedPorts = new Set(
    containers.flatMap((c) => c.ports.map((p) => p.publicPort).filter((p): p is number => p != null))
  );
  for (let candidate = originalPort + 1; candidate < originalPort + 100; candidate++) {
    if (!usedPorts.has(candidate)) return candidate;
  }
  throw new Error("no_free_port_found_near_original");
}

/**
 * Clones a container onto a free port. If dbNameRewrite is given, rewrites
 * every env var whose VALUE exactly matches the source database name to the
 * duplicate's database name instead — without this, the cloned container
 * keeps every DB_NAME/POSTGRES_DB/-style env var pointing at the source
 * database, so it silently reads/writes the SAME data as the original
 * despite nginx routing traffic to a "different" container. Matching by
 * value (not a guessed variable name like DB_NAME) works regardless of the
 * app's own env var naming convention.
 */
async function cloneContainerAsDuplicate(
  sourceContainerId: string,
  dbNameRewrite?: { from: string; to: string }
): Promise<{ id: string; name: string; port: number }> {
  const source = docker.getContainer(sourceContainerId);
  const info = await source.inspect();

  const portBindings = info.HostConfig?.PortBindings as Record<string, Array<{ HostPort: string }>> | undefined;
  const firstBinding = portBindings ? Object.values(portBindings)[0]?.[0] : undefined;
  const originalPort = firstBinding ? Number(firstBinding.HostPort) : null;
  if (originalPort == null) throw new Error("source_container_has_no_published_port");

  const duplicatePort = await findFreePortNear(originalPort);
  const duplicateName = `${info.Name.replace(/^\//, "")}-duplicate`;

  const rewrittenBindings: Record<string, Array<{ HostPort: string }>> = {};
  for (const [containerPort, bindings] of Object.entries(portBindings ?? {})) {
    rewrittenBindings[containerPort] = bindings.map((b) =>
      Number(b.HostPort) === originalPort ? { ...b, HostPort: String(duplicatePort) } : b
    );
  }

  const rewrittenEnv = (info.Config.Env ?? []).map((entry) => {
    if (!dbNameRewrite) return entry;
    const idx = entry.indexOf("=");
    if (idx < 0) return entry;
    const value = entry.slice(idx + 1);
    return value === dbNameRewrite.from ? `${entry.slice(0, idx)}=${dbNameRewrite.to}` : entry;
  });

  // A duplicate with the same name may already exist from a previous
  // create/refresh — remove it first so createContainer doesn't collide.
  const existing = docker.getContainer(duplicateName);
  await existing.remove({ force: true }).catch(() => {});

  const created = await docker.createContainer({
    name: duplicateName,
    Image: info.Config.Image,
    Env: rewrittenEnv,
    Cmd: info.Config.Cmd,
    Entrypoint: info.Config.Entrypoint,
    ExposedPorts: info.Config.ExposedPorts,
    Labels: info.Config.Labels,
    HostConfig: { ...info.HostConfig, PortBindings: rewrittenBindings },
    NetworkingConfig: { EndpointsConfig: info.NetworkSettings.Networks },
  });
  await created.start();

  return { id: created.id, name: duplicateName, port: duplicatePort };
}

export const SiteDuplicateService = {
  async getDuplicateStatus(vhostName: string): Promise<SiteDuplicateStatus | null> {
    const row = getRow(vhostName);
    if (!row) return null;
    const sizeBytes = row.content_path ? await dirSize(row.content_path) : null;
    const dbSizeBytes =
      row.duplicate_db_name && row.db_location && row.db_ref
        ? await DbBackupService.getDatabaseSizeBytes(row.db_location, row.db_ref, row.duplicate_db_name)
        : null;
    return rowToStatus(row, sizeBytes, dbSizeBytes);
  },

  /**
   * Kicks off duplicate creation/refresh in the background and returns
   * immediately with a "refreshing" status — the actual rsync/container
   * clone/DB dump+restore can take a while (large sites, big databases), so
   * the frontend polls getDuplicateStatus() for progressStep updates rather
   * than holding one long-lived HTTP request open.
   */
  async createDuplicate(
    vhostName: string,
    opts: { dbLocation?: "docker" | "native"; dbRef?: string; dbName?: string }
  ): Promise<SiteDuplicateStatus> {
    if (NginxService.isSwitchedToDuplicate(vhostName)) {
      throw new Error("cannot_refresh_while_failover_active");
    }

    setProgress(vhostName, "Préparation…");
    runCreateDuplicate(vhostName, opts).catch((err) => {
      db.prepare("UPDATE site_duplicates SET status = 'failed', progress_step = NULL, error = ? WHERE vhost_name = ?").run(
        (err as Error).message,
        vhostName
      );
    });

    const status = await this.getDuplicateStatus(vhostName);
    return status!;
  },

  async deleteDuplicate(vhostName: string): Promise<void> {
    if (NginxService.isSwitchedToDuplicate(vhostName)) {
      throw new Error("cannot_delete_while_failover_active");
    }

    const row = getRow(vhostName);
    if (!row) return;

    if (row.content_path) {
      await runCommand("sudo", ["rm", "-rf", row.content_path], { timeoutMs: 60_000 }).catch(() => {});
    }
    if (row.duplicate_container_id) {
      await docker
        .getContainer(row.duplicate_container_id)
        .remove({ force: true })
        .catch(() => {});
    }
    if (row.duplicate_db_name && row.db_location && row.db_ref) {
      await dropDuplicateDatabase(row.db_location, row.db_ref, row.duplicate_db_name).catch(() => {});
    }

    db.prepare("DELETE FROM site_duplicates WHERE vhost_name = ?").run(vhostName);
  },
};

async function runCreateDuplicate(
  vhostName: string,
  opts: { dbLocation?: "docker" | "native"; dbRef?: string; dbName?: string }
): Promise<void> {
  const vhost = await NginxService.getVhostDetail(vhostName);

  let contentPath: string | null = null;
  if (vhost.root) {
    // Site roots are only ever supposed to live under /var/www/ on this
    // server (confirmed against real vhost configs) — matches the sudoers
    // rsync/rm rule's scope, so refuse to touch anything outside it rather
    // than silently attempting an rsync/rm -rf a stray root value might
    // otherwise trigger against an unexpected path.
    const normalizedRoot = resolve(vhost.root);
    if (!normalizedRoot.startsWith(SITE_ROOTS_PARENT + sep)) {
      throw new Error("site_root_outside_allowed_parent");
    }
    setProgress(vhostName, "Copie des fichiers…");
    contentPath = join(dirname(normalizedRoot), `${basename(normalizedRoot)}__duplicate`);
    await mkdir(contentPath, { recursive: true });
    // sudo: site roots are frequently owned by www-data or another service
    // user the admin service account can't read/write directly, same
    // rationale as the existing rsync rules in application.service.ts.
    await runCommand("sudo", ["rsync", "-a", `${normalizedRoot}/`, contentPath], { timeoutMs: 600_000 });
  }

  // DB duplication runs BEFORE the container clone, on purpose: the cloned
  // container's env vars get rewritten to point at duplicateDbName (see
  // cloneContainerAsDuplicate's dbNameRewrite param), so that name — and the
  // database itself — must already exist before the duplicate container
  // starts and tries to connect.
  let duplicateDbName: string | null = null;
  if (opts.dbLocation && opts.dbRef && opts.dbName) {
    if (!DbBackupService.validateDbName(opts.dbName)) throw new Error("invalid_db_name");
    duplicateDbName = `${opts.dbName}__duplicate`;
    if (!DbBackupService.validateDbName(duplicateDbName)) throw new Error("db_name_too_long_to_duplicate");

    setProgress(vhostName, "Duplication de la base de données…");
    const dumpPath = await DbBackupService.dumpSingleDatabase(opts.dbLocation, opts.dbRef, opts.dbName);
    await DbBackupService.restoreSingleDatabaseAs(opts.dbLocation, opts.dbRef, dumpPath, duplicateDbName);
  }

  let duplicateContainerId: string | null = null;
  let duplicateContainerName: string | null = null;
  let duplicatePort: number | null = null;
  if (vhost.proxyPassTarget) {
    const linkedContainer = await findLinkedContainer(vhost.proxyPassTarget);
    if (linkedContainer) {
      setProgress(vhostName, "Clonage du conteneur…");
      const cloned = await cloneContainerAsDuplicate(
        linkedContainer.id,
        opts.dbName && duplicateDbName ? { from: opts.dbName, to: duplicateDbName } : undefined
      );
      duplicateContainerId = cloned.id;
      duplicateContainerName = cloned.name;
      duplicatePort = cloned.port;
    }
  }

  db.prepare(
    `INSERT INTO site_duplicates (
      vhost_name, content_path, db_location, db_ref, db_name, duplicate_db_name,
      duplicate_container_id, duplicate_container_name, duplicate_port, status, progress_step, error, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', NULL, NULL, datetime('now'))
    ON CONFLICT(vhost_name) DO UPDATE SET
      content_path = excluded.content_path,
      db_location = excluded.db_location,
      db_ref = excluded.db_ref,
      db_name = excluded.db_name,
      duplicate_db_name = excluded.duplicate_db_name,
      duplicate_container_id = excluded.duplicate_container_id,
      duplicate_container_name = excluded.duplicate_container_name,
      duplicate_port = excluded.duplicate_port,
      status = 'ready',
      progress_step = NULL,
      error = NULL,
      last_synced_at = datetime('now')`
  ).run(
    vhostName,
    contentPath,
    opts.dbLocation ?? null,
    opts.dbRef ?? null,
    opts.dbName ?? null,
    duplicateDbName,
    duplicateContainerId,
    duplicateContainerName,
    duplicatePort
  );
}

function parseDockerEnv(envList: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of envList) {
    const idx = entry.indexOf("=");
    if (idx > 0) result[entry.slice(0, idx)] = entry.slice(idx + 1);
  }
  return result;
}

async function dropDuplicateDatabase(location: "docker" | "native", ref: string, dbName: string): Promise<void> {
  if (location === "docker") {
    const container = docker.getContainer(ref);
    const info = await container.inspect();
    const envVars = parseDockerEnv(info.Config.Env ?? []);
    const isPostgres = /postgres/i.test(info.Config.Image);
    const cmd = isPostgres
      ? ["psql", "-U", envVars.POSTGRES_USER ?? "postgres", "-d", "postgres", "-c", `DROP DATABASE IF EXISTS "${dbName}";`]
      : [
          "mysql",
          "-u",
          "root",
          `-p${envVars.MARIADB_ROOT_PASSWORD ?? envVars.MYSQL_ROOT_PASSWORD ?? ""}`,
          "-e",
          `DROP DATABASE IF EXISTS \`${dbName}\`;`,
        ];
    const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
    const { Writable } = await import("node:stream");
    const sink = new Writable({ write(_chunk, _enc, cb) { cb(); } });
    const stream = await exec.start({ hijack: true, stdin: false });
    if (!stream) throw new Error("docker_exec_stream_null — le conteneur est-il démarré ?");
    await new Promise<void>((resolve, reject) => {
      container.modem.demuxStream(stream, sink, sink);
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    return;
  }

  // Native — engine unknown from ref alone here, try both forms; whichever
  // doesn't apply is a fast no-op failure that's safely swallowed by the
  // caller's .catch(() => {}).
  await runCommand("sudo", ["mysql", "-e", `DROP DATABASE IF EXISTS \`${dbName}\`;`], { timeoutMs: 10_000 }).catch(
    () => {}
  );
  await runCommand("sudo", ["-u", "postgres", "psql", "-c", `DROP DATABASE IF EXISTS "${dbName}";`], {
    timeoutMs: 10_000,
  }).catch(() => {});
}
