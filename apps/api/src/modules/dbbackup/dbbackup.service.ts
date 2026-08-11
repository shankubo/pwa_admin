import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, stat, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createGzip, createGunzip } from "node:zlib";
import { docker } from "../../services/docker.client.js";
import { env } from "../../config/env.js";
import { BackupHistoryModel } from "../../db/models/backup.js";
import { BackupService } from "../backup/backup.service.js";
import { GDriveService } from "../../services/gdrive.client.js";
import { UsbBackupService } from "../../services/usbBackup.client.js";
import { runCommand, spawnCommand, spawnCommandWithStdin } from "../../utils/exec.js";
import type { DetectedDatabase, DbEngine, BackupTarget } from "@pwa-admin/shared";

const DB_NAME_RE = /^[a-zA-Z0-9_-]+$/;

interface DockerEngineConfig {
  engine: DbEngine;
  imageMatch: RegExp;
  buildDumpCmd: (env: Record<string, string>) => string[];
  extension: string;
}

const DOCKER_ENGINES: DockerEngineConfig[] = [
  {
    engine: "postgres",
    imageMatch: /postgres/i,
    buildDumpCmd: (e) => [
      "pg_dump",
      "-U",
      e.POSTGRES_USER ?? "postgres",
      "-Fc",
      e.POSTGRES_DB ?? e.POSTGRES_USER ?? "postgres",
    ],
    extension: "dump",
  },
  {
    engine: "mysql",
    imageMatch: /mysql/i,
    buildDumpCmd: (e) => ["mysqldump", "-u", "root", `-p${e.MYSQL_ROOT_PASSWORD ?? ""}`, "--all-databases"],
    extension: "sql",
  },
  {
    engine: "mariadb",
    imageMatch: /mariadb/i,
    buildDumpCmd: (e) => [
      "mysqldump",
      "-u",
      "root",
      `-p${e.MARIADB_ROOT_PASSWORD ?? e.MYSQL_ROOT_PASSWORD ?? ""}`,
      "--all-databases",
    ],
    extension: "sql",
  },
  {
    engine: "mongo",
    imageMatch: /mongo/i,
    buildDumpCmd: () => ["mongodump", "--archive"],
    extension: "archive",
  },
  {
    engine: "redis",
    imageMatch: /redis/i,
    buildDumpCmd: () => ["redis-cli", "SAVE"],
    extension: "rdb",
  },
];

/** Native (host OS) DB services this module knows how to detect and dump via sudo. */
const NATIVE_SERVICES: Array<{ service: string; engine: DbEngine }> = [
  { service: "mariadb", engine: "mariadb" },
  { service: "mysql", engine: "mysql" },
  { service: "postgresql", engine: "postgres" },
  { service: "redis-server", engine: "redis" },
];

const SYSTEM_SCHEMAS = new Set([
  "information_schema",
  "performance_schema",
  "mysql",
  "sys",
  "template0",
  "template1",
  "postgres",
]);

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return hash.digest("hex");
}

async function isServiceActive(service: string): Promise<boolean> {
  try {
    const { stdout } = await runCommand("systemctl", ["is-active", service], { timeoutMs: 3000 });
    return stdout.trim() === "active";
  } catch {
    return false;
  }
}

/** Resolves a unit name to systemd's canonical Id, so aliases (e.g. mysql.service
 * -> mariadb.service on Debian) collapse to a single detected instance instead of
 * being reported as two separate running databases. */
async function resolveServiceId(service: string): Promise<string | null> {
  try {
    const { stdout } = await runCommand("systemctl", ["show", service, "-p", "Id"], { timeoutMs: 3000 });
    const match = /^Id=(.+)$/m.exec(stdout.trim());
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Lists databases inside a running DB container via docker exec (no sudo
 * needed — same rationale as dumpDocker: this runs inside the container via
 * dockerode, not a host shell command). Used to populate a real picker
 * instead of asking the admin to type an exact DB name from memory. */
async function listDockerDatabases(
  container: ReturnType<typeof docker.getContainer>,
  engine: DbEngine,
  envVars: Record<string, string>
): Promise<string[]> {
  if (engine !== "postgres" && engine !== "mysql" && engine !== "mariadb") return [];

  const cmd =
    engine === "postgres"
      ? // -d postgres: psql with no -d defaults to a database named after the
        // connecting user (envVars.POSTGRES_USER, e.g. "shan"), which usually
        // doesn't exist — the "postgres" maintenance database always does.
        [
          "psql",
          "-U",
          envVars.POSTGRES_USER ?? "postgres",
          "-d",
          "postgres",
          "-t",
          "-A",
          "-c",
          "SELECT datname FROM pg_database WHERE datistemplate = false;",
        ]
      : ["mysql", "-u", "root", `-p${envVars.MYSQL_ROOT_PASSWORD ?? envVars.MARIADB_ROOT_PASSWORD ?? ""}`, "-N", "-e", "SHOW DATABASES;"];

  try {
    const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
    const stream = await exec.start({ hijack: true, stdin: false });
    if (!stream) throw new Error("docker_exec_stream_null — le conteneur est-il démarré ?");
    let stdout = "";
    const { Writable } = await import("node:stream");
    const stdoutSink = new Writable({
      write(chunk, _enc, cb) {
        stdout += chunk.toString();
        cb();
      },
    });
    const stderrSink = new Writable({ write(_chunk, _enc, cb) { cb(); } });
    await new Promise<void>((resolve, reject) => {
      container.modem.demuxStream(stream, stdoutSink, stderrSink);
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    const inspection = await exec.inspect();
    if (inspection.ExitCode !== 0) return [];
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((name) => name && !SYSTEM_SCHEMAS.has(name));
  } catch {
    return [];
  }
}

async function listNativeDatabases(engine: DbEngine): Promise<string[]> {
  try {
    if (engine === "mariadb" || engine === "mysql") {
      const { stdout } = await runCommand("sudo", ["mysql", "-N", "-e", "SHOW DATABASES;"], { timeoutMs: 5000 });
      return stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((name) => name && !SYSTEM_SCHEMAS.has(name));
    }
    if (engine === "postgres") {
      const { stdout } = await runCommand(
        "sudo",
        ["-u", "postgres", "psql", "-t", "-A", "-c", "SELECT datname FROM pg_database WHERE datistemplate = false;"],
        { timeoutMs: 5000 }
      );
      return stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((name) => name && !SYSTEM_SCHEMAS.has(name));
    }
  } catch {
    return [];
  }
  return [];
}

function parseEnv(envList: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of envList) {
    const idx = entry.indexOf("=");
    if (idx > 0) result[entry.slice(0, idx)] = entry.slice(idx + 1);
  }
  return result;
}

export const DbBackupService = {
  /**
   * Resolves a backup history entry's sourceRef (a display name, e.g. a container
   * name or native service name) back to a live location+ref pair, by matching
   * against currently detected DBs. Used by the restore flow, which only has the
   * historical display name to go on, not the technical ref used at dump time.
   */
  async resolveSourceRef(sourceRef: string): Promise<{ location: "docker" | "native"; ref: string } | null> {
    const detected = await this.detect();
    const match = detected.find((d) => d.displayName === sourceRef || d.ref === sourceRef);
    return match ? { location: match.location, ref: match.ref } : null;
  },

  async detect(): Promise<DetectedDatabase[]> {
    const detected: DetectedDatabase[] = [];

    const containers = await docker.listContainers({ all: false });
    for (const c of containers) {
      const match = DOCKER_ENGINES.find((e) => e.imageMatch.test(c.Image));
      if (match) {
        const envVars = parseEnv((await docker.getContainer(c.Id).inspect()).Config.Env ?? []);
        detected.push({
          location: "docker",
          ref: c.Id,
          displayName: c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12),
          engine: match.engine,
          databases: await listDockerDatabases(docker.getContainer(c.Id), match.engine, envVars),
        });
      }
    }

    const seenUnitIds = new Set<string>();
    for (const { service, engine } of NATIVE_SERVICES) {
      if (!(await isServiceActive(service))) continue;

      // Aliases (mysql.service -> mariadb.service on Debian) resolve to the same
      // canonical unit; only report the underlying instance once.
      const unitId = (await resolveServiceId(service)) ?? service;
      if (seenUnitIds.has(unitId)) continue;
      seenUnitIds.add(unitId);

      detected.push({
        location: "native",
        ref: service,
        displayName: `${service} (host)`,
        engine,
        databases: await listNativeDatabases(engine),
      });
    }

    return detected;
  },

  async dump(location: "docker" | "native", ref: string, targets: BackupTarget[] = ["local"]): Promise<string> {
    return location === "docker" ? this.dumpDocker(ref, targets) : this.dumpNative(ref, targets);
  },

  async dumpDocker(containerId: string, targets: BackupTarget[] = ["local"]): Promise<string> {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    const image = info.Config.Image;
    const engineConfig = DOCKER_ENGINES.find((e) => e.imageMatch.test(image));
    if (!engineConfig) throw new Error("unsupported_db_engine");

    const containerName = info.Name.replace(/^\//, "");
    const envVars = parseEnv(info.Config.Env ?? []);
    const cmd = engineConfig.buildDumpCmd(envVars);

    const runId = BackupHistoryModel.createRun({
      jobId: null,
      type: "backup",
      sourceType: "db",
      sourceRef: containerName,
      target: "local",
    });

    const start = Date.now();
    try {
      const destDir = join(env.BACKUP_LOCAL_ROOT, "db", containerName);
      await mkdir(destDir, { recursive: true });
      const fileName = `${new Date().toISOString().replace(/:/g, "-")}.${engineConfig.extension}.gz`;
      const filePath = join(destDir, fileName);

      // Argv-array Cmd, executed via dockerode exec — never a shell string.
      const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
      const stream = await exec.start({ hijack: true, stdin: false });
      if (!stream) throw new Error("docker_exec_stream_null — le conteneur est-il démarré ?");

      const gzip = createGzip();
      const out = createWriteStream(filePath);

      await new Promise<void>((resolve, reject) => {
        container.modem.demuxStream(stream, gzip as any, gzip as any);
        gzip.pipe(out);
        // demuxStream only forwards data chunks, never end() — without this,
        // gzip/out never finish and the run hangs as "running" forever once
        // the container's dump process closes its stdout.
        stream.on("end", () => gzip.end());
        out.on("finish", resolve);
        out.on("error", reject);
        stream.on("error", reject);
      });

      const stats = await stat(filePath);
      const checksum = await sha256OfFile(filePath);

      let driveFileId: string | undefined;
      if (targets.includes("gdrive") && GDriveService.isEnabled()) {
        const uploaded = await GDriveService.uploadBackupFile(filePath, "db", containerName);
        const verified = await GDriveService.verifyUpload(uploaded.fileId, stats.size);
        if (verified) driveFileId = uploaded.fileId;
      }

      let usbPath: string | undefined;
      if (targets.includes("usb")) {
        try {
          if (await UsbBackupService.isAvailable()) {
            const copied = await UsbBackupService.copyBackupFile(filePath, "db", containerName);
            usbPath = copied.usbPath;
          }
        } catch {
          // Copy started but failed partway (disk full, unplugged mid-copy) —
          // don't fail the whole run over the USB leg specifically.
        }
      }

      BackupHistoryModel.complete(runId, {
        status: "success",
        filePath,
        sizeBytes: stats.size,
        checksumSha256: checksum,
        driveFileId,
        usbPath,
        durationMs: Date.now() - start,
      });

      await BackupService.applyRetention("db", containerName);
      return runId;
    } catch (err) {
      BackupHistoryModel.complete(runId, {
        status: "failed",
        error: (err as Error).message,
        durationMs: Date.now() - start,
      });
      throw err;
    }
  },

  /**
   * Dumps a native (host OS) DB service via sudo. Credentials are never typed by
   * the admin: mysqldump/pg_dump run through sudo using the same unix_socket /
   * peer-auth trust the OS already grants root (Debian's standard debian-sys-maint
   * setup for MariaDB/MySQL, peer auth for postgres' `postgres` OS user).
   */
  async dumpNative(service: string, targets: BackupTarget[] = ["local"]): Promise<string> {
    const engineEntry = NATIVE_SERVICES.find((s) => s.service === service);
    if (!engineEntry) throw new Error("unsupported_native_service");
    const { engine } = engineEntry;

    const runId = BackupHistoryModel.createRun({
      jobId: null,
      type: "backup",
      sourceType: "db",
      sourceRef: service,
      target: "local",
    });

    const start = Date.now();
    try {
      const destDir = join(env.BACKUP_LOCAL_ROOT, "db", service);
      await mkdir(destDir, { recursive: true });
      const extension = engine === "postgres" ? "dump" : "sql";
      const fileName = `${new Date().toISOString().replace(/:/g, "-")}.${extension}.gz`;
      const filePath = join(destDir, fileName);

      const { bin, args } =
        engine === "mariadb" || engine === "mysql"
          ? { bin: "sudo", args: ["mysqldump", "--all-databases"] }
          : engine === "postgres"
            ? { bin: "sudo", args: ["-u", "postgres", "pg_dumpall"] }
            : (() => {
                throw new Error("dump_not_supported_for_native_engine");
              })();

      const child = spawnCommand(bin, args);
      const gzip = createGzip();
      const out = createWriteStream(filePath);
      let stderrOutput = "";
      child.stderr?.on("data", (chunk) => (stderrOutput += chunk.toString()));

      await new Promise<void>((resolve, reject) => {
        child.stdout!.pipe(gzip).pipe(out);
        out.on("finish", resolve);
        out.on("error", reject);
        child.on("error", reject);
        child.on("close", (code) => {
          if (code !== 0) reject(new Error(stderrOutput || `dump command exited with code ${code}`));
        });
      });

      const stats = await stat(filePath);
      const checksum = await sha256OfFile(filePath);

      let driveFileId: string | undefined;
      if (targets.includes("gdrive") && GDriveService.isEnabled()) {
        const uploaded = await GDriveService.uploadBackupFile(filePath, "db", service);
        const verified = await GDriveService.verifyUpload(uploaded.fileId, stats.size);
        if (verified) driveFileId = uploaded.fileId;
      }

      let usbPath: string | undefined;
      if (targets.includes("usb")) {
        try {
          if (await UsbBackupService.isAvailable()) {
            const copied = await UsbBackupService.copyBackupFile(filePath, "db", service);
            usbPath = copied.usbPath;
          }
        } catch {
          // Copy started but failed partway (disk full, unplugged mid-copy) —
          // don't fail the whole run over the USB leg specifically.
        }
      }

      BackupHistoryModel.complete(runId, {
        status: "success",
        filePath,
        sizeBytes: stats.size,
        checksumSha256: checksum,
        driveFileId,
        usbPath,
        durationMs: Date.now() - start,
      });

      await BackupService.applyRetention("db", service);
      return runId;
    } catch (err) {
      BackupHistoryModel.complete(runId, {
        status: "failed",
        error: (err as Error).message,
        durationMs: Date.now() - start,
      });
      throw err;
    }
  },

  async restore(location: "docker" | "native", ref: string, runId: string): Promise<void> {
    return location === "docker" ? this.restoreDocker(ref, runId) : this.restoreNative(ref, runId);
  },

  async restoreDocker(containerId: string, runId: string): Promise<void> {
    const run = BackupHistoryModel.findByRunId(runId);
    if (!run || !run.file_path) throw new Error("backup_run_not_found");

    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    const engineConfig = DOCKER_ENGINES.find((e) => e.imageMatch.test(info.Config.Image));
    if (!engineConfig) throw new Error("unsupported_db_engine");

    const containerName = info.Name.replace(/^\//, "");
    const envVars = parseEnv(info.Config.Env ?? []);

    // Pre-restore safety snapshot — always taken, not skippable, so a bad
    // restore is itself recoverable.
    await this.dumpDocker(containerId);

    const restoreCmd =
      engineConfig.engine === "postgres"
        ? ["pg_restore", "-U", envVars.POSTGRES_USER ?? "postgres", "-c", "-d", envVars.POSTGRES_DB ?? "postgres"]
        : engineConfig.engine === "mysql"
          ? ["mysql", "-u", "root", `-p${envVars.MYSQL_ROOT_PASSWORD ?? ""}`]
          : engineConfig.engine === "mariadb"
            ? ["mysql", "-u", "root", `-p${envVars.MARIADB_ROOT_PASSWORD ?? envVars.MYSQL_ROOT_PASSWORD ?? ""}`]
            : engineConfig.engine === "mongo"
              ? ["mongorestore", "--archive"]
              : (() => {
                  throw new Error("restore_not_supported_for_engine");
                })();

    const exec = await container.exec({ Cmd: restoreCmd, AttachStdin: true, AttachStdout: true, AttachStderr: true });
    const stream = await exec.start({ hijack: true, stdin: true });
    if (!stream) throw new Error("docker_exec_stream_null — le conteneur est-il démarré ?");

    await new Promise<void>((resolve, reject) => {
      const gunzip = createGunzip();
      createReadStream(run.file_path!).pipe(gunzip).pipe(stream as any);
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    BackupHistoryModel.createRun({
      jobId: null,
      type: "restore",
      sourceType: "db",
      sourceRef: containerName,
      target: "local",
    });
  },

  async restoreNative(service: string, runId: string): Promise<void> {
    const run = BackupHistoryModel.findByRunId(runId);
    if (!run || !run.file_path) throw new Error("backup_run_not_found");

    const engineEntry = NATIVE_SERVICES.find((s) => s.service === service);
    if (!engineEntry) throw new Error("unsupported_native_service");

    // Pre-restore safety snapshot — always taken, not skippable.
    await this.dumpNative(service);

    const { bin, args } =
      engineEntry.engine === "mariadb" || engineEntry.engine === "mysql"
        ? { bin: "sudo", args: ["mysql"] }
        : engineEntry.engine === "postgres"
          ? { bin: "sudo", args: ["-u", "postgres", "psql"] }
          : (() => {
              throw new Error("restore_not_supported_for_native_engine");
            })();

    const child = spawnCommandWithStdin(bin, args);
    let stderrOutput = "";
    child.stderr?.on("data", (chunk) => (stderrOutput += chunk.toString()));

    await new Promise<void>((resolve, reject) => {
      const gunzip = createGunzip();
      createReadStream(run.file_path!).pipe(gunzip).pipe(child.stdin!);
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderrOutput || `restore command exited with code ${code}`));
      });
    });

    BackupHistoryModel.createRun({
      jobId: null,
      type: "restore",
      sourceType: "db",
      sourceRef: service,
      target: "local",
    });
  },

  validateDbName(name: string): boolean {
    return DB_NAME_RE.test(name) && name.length <= 64;
  },

  /**
   * Dumps exactly one database (not the whole instance like dumpDocker/dumpNative
   * do) — needed for site duplication, where only the site's own DB should be
   * cloned, not everything running on the same instance. Stored under
   * data/backups/site-duplicates/, separate from the tracked db/<ref> backup
   * history tree, since these are internal scratch dumps for duplication, not
   * user-facing backups.
   */
  async dumpSingleDatabase(location: "docker" | "native", ref: string, dbName: string): Promise<string> {
    if (!this.validateDbName(dbName)) throw new Error("invalid_db_name");

    const destDir = join(env.BACKUP_LOCAL_ROOT, "site-duplicates", location === "docker" ? ref : `native-${ref}`);
    await mkdir(destDir, { recursive: true });

    if (location === "docker") {
      const container = docker.getContainer(ref);
      const info = await container.inspect();
      const engineConfig = DOCKER_ENGINES.find((e) => e.imageMatch.test(info.Config.Image));
      if (!engineConfig) throw new Error("unsupported_db_engine");

      const cmd =
        engineConfig.engine === "postgres"
          ? ["pg_dump", "-U", parseEnv(info.Config.Env ?? []).POSTGRES_USER ?? "postgres", "-Fc", dbName]
          : engineConfig.engine === "mysql" || engineConfig.engine === "mariadb"
            ? ["mysqldump", dbName]
            : (() => {
                throw new Error("single_db_dump_not_supported_for_engine");
              })();

      const filePath = join(destDir, `${dbName}.${engineConfig.extension}.gz`);
      const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
      const stream = await exec.start({ hijack: true, stdin: false });
      if (!stream) throw new Error("docker_exec_stream_null — le conteneur est-il démarré ?");

      // stdout (the actual dump bytes) and stderr (error messages) MUST go to
      // separate sinks — demuxing both into the same gzip stream would splice
      // any stderr text (e.g. "database does not exist") into the binary dump
      // file itself, silently corrupting it instead of surfacing the error.
      const gzip = createGzip();
      const out = createWriteStream(filePath);
      let stderrOutput = "";
      const stderrSink = new (await import("node:stream")).Writable({
        write(chunk, _enc, cb) {
          stderrOutput += chunk.toString();
          cb();
        },
      });
      await new Promise<void>((resolve, reject) => {
        container.modem.demuxStream(stream, gzip as any, stderrSink);
        stream.on("end", () => gzip.end());
        gzip.pipe(out);
        out.on("finish", resolve);
        out.on("error", reject);
        stream.on("error", reject);
      });

      const inspection = await exec.inspect();
      if (inspection.ExitCode !== 0) {
        await unlink(filePath).catch(() => {});
        throw new Error(stderrOutput.trim() || `dump command exited with code ${inspection.ExitCode}`);
      }
      return filePath;
    }

    const engineEntry = NATIVE_SERVICES.find((s) => s.service === ref);
    if (!engineEntry) throw new Error("unsupported_native_service");

    const { bin, args, extension } =
      engineEntry.engine === "mariadb" || engineEntry.engine === "mysql"
        ? { bin: "sudo", args: ["mysqldump", dbName], extension: "sql" }
        : engineEntry.engine === "postgres"
          ? { bin: "sudo", args: ["-u", "postgres", "pg_dump", "-Fc", dbName], extension: "dump" }
          : (() => {
              throw new Error("single_db_dump_not_supported_for_engine");
            })();

    const filePath = join(destDir, `${dbName}.${extension}.gz`);
    const child = spawnCommand(bin, args);
    const gzip = createGzip();
    const out = createWriteStream(filePath);
    let stderrOutput = "";
    child.stderr?.on("data", (chunk) => (stderrOutput += chunk.toString()));

    await new Promise<void>((resolve, reject) => {
      child.stdout!.pipe(gzip).pipe(out);
      out.on("finish", resolve);
      out.on("error", reject);
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) reject(new Error(stderrOutput || `dump command exited with code ${code}`));
      });
    });
    return filePath;
  },

  /**
   * Restores a single-database dump (from dumpSingleDatabase) into a NEW
   * database name — unlike restore()/restoreDocker()/restoreNative(), which
   * always overwrite the same instance/DB names captured in the dump. Creates
   * targetDbName first since a single-DB mysqldump doesn't embed a CREATE
   * DATABASE statement the way --all-databases dumps do.
   */
  async restoreSingleDatabaseAs(
    location: "docker" | "native",
    ref: string,
    dumpFilePath: string,
    targetDbName: string
  ): Promise<void> {
    if (!this.validateDbName(targetDbName)) throw new Error("invalid_db_name");

    if (location === "docker") {
      const container = docker.getContainer(ref);
      const info = await container.inspect();
      const engineConfig = DOCKER_ENGINES.find((e) => e.imageMatch.test(info.Config.Image));
      if (!engineConfig) throw new Error("unsupported_db_engine");
      const envVars = parseEnv(info.Config.Env ?? []);

      if (engineConfig.engine === "postgres") {
        const createExec = await container.exec({
          // -d postgres: psql with no -d defaults to a database named after
          // the connecting user, which usually doesn't exist.
          Cmd: ["psql", "-U", envVars.POSTGRES_USER ?? "postgres", "-d", "postgres", "-c", `CREATE DATABASE "${targetDbName}";`],
          AttachStdout: true,
          AttachStderr: true,
        });
        await runDockerExecToCompletion(container, createExec);

        const restoreExec = await container.exec({
          Cmd: ["pg_restore", "-U", envVars.POSTGRES_USER ?? "postgres", "-d", targetDbName],
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
        });
        const stream = await restoreExec.start({ hijack: true, stdin: true });
        if (!stream) throw new Error("docker_exec_stream_null — le conteneur est-il démarré ?");
        await pipeGunzippedFileToDockerStream(dumpFilePath, stream, restoreExec);
        return;
      }

      if (engineConfig.engine === "mysql" || engineConfig.engine === "mariadb") {
        const pw =
          engineConfig.engine === "mysql"
            ? (envVars.MYSQL_ROOT_PASSWORD ?? "")
            : (envVars.MARIADB_ROOT_PASSWORD ?? envVars.MYSQL_ROOT_PASSWORD ?? "");

        const createExec = await container.exec({
          Cmd: ["mysql", "-u", "root", `-p${pw}`, "-e", `CREATE DATABASE IF NOT EXISTS \`${targetDbName}\`;`],
          AttachStdout: true,
          AttachStderr: true,
        });
        await runDockerExecToCompletion(container, createExec);

        const restoreExec = await container.exec({
          Cmd: ["mysql", "-u", "root", `-p${pw}`, targetDbName],
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
        });
        const stream = await restoreExec.start({ hijack: true, stdin: true });
        if (!stream) throw new Error("docker_exec_stream_null — le conteneur est-il démarré ?");
        await pipeGunzippedFileToDockerStream(dumpFilePath, stream, restoreExec);
        return;
      }

      throw new Error("single_db_restore_not_supported_for_engine");
    }

    const engineEntry = NATIVE_SERVICES.find((s) => s.service === ref);
    if (!engineEntry) throw new Error("unsupported_native_service");

    if (engineEntry.engine === "postgres") {
      await runCommand("sudo", ["-u", "postgres", "psql", "-c", `CREATE DATABASE "${targetDbName}";`], {
        timeoutMs: 10_000,
      });
      const child = spawnCommandWithStdin("sudo", ["-u", "postgres", "pg_restore", "-d", targetDbName]);
      await pipeGunzippedFileToChildStdin(dumpFilePath, child);
      return;
    }

    if (engineEntry.engine === "mariadb" || engineEntry.engine === "mysql") {
      await runCommand("sudo", ["mysql", "-e", `CREATE DATABASE IF NOT EXISTS \`${targetDbName}\`;`], {
        timeoutMs: 10_000,
      });
      const child = spawnCommandWithStdin("sudo", ["mysql", targetDbName]);
      await pipeGunzippedFileToChildStdin(dumpFilePath, child);
      return;
    }

    throw new Error("single_db_restore_not_supported_for_native_engine");
  },
};

/** Runs a docker exec to completion, discarding its output — a hijacked exec
 * stream is Docker's multiplexed stdout/stderr format, not plain text, so it
 * must go through demuxStream (like dumpDocker's real dump path does) even
 * when the output itself isn't needed, or `end` never reliably fires and the
 * caller hangs waiting on a promise that never resolves. */
async function runDockerExecToCompletion(
  container: { modem: { demuxStream: (stream: NodeJS.ReadableStream, stdout: any, stderr: any) => void } },
  exec: { start: (opts: any) => Promise<NodeJS.ReadWriteStream> }
): Promise<void> {
  const { Writable } = await import("node:stream");
  const stream = await exec.start({ hijack: true, stdin: false });
  if (!stream) throw new Error("docker_exec_stream_null — le conteneur est-il démarré ?");
  const sink = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  await new Promise<void>((resolve, reject) => {
    container.modem.demuxStream(stream, sink, sink);
    stream.on("end", resolve);
    stream.on("error", reject);
  });
}

async function pipeGunzippedFileToDockerStream(
  filePath: string,
  stream: NodeJS.ReadWriteStream,
  exec: { inspect: () => Promise<{ ExitCode: number | null }> }
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const gunzip = createGunzip();
    createReadStream(filePath).pipe(gunzip).pipe(stream as any);
    stream.on("end", resolve);
    stream.on("error", reject);
  });

  // The hijacked stream itself carries no exit status — check it via the
  // exec handle so a failed restore (bad dump, permission error, etc.)
  // surfaces as a real error instead of silently "succeeding".
  const inspection = await exec.inspect();
  if (inspection.ExitCode !== 0) {
    throw new Error(`restore command exited with code ${inspection.ExitCode}`);
  }
}

async function pipeGunzippedFileToChildStdin(
  filePath: string,
  child: ReturnType<typeof spawnCommand>
): Promise<void> {
  let stderrOutput = "";
  child.stderr?.on("data", (chunk) => (stderrOutput += chunk.toString()));
  await new Promise<void>((resolve, reject) => {
    const gunzip = createGunzip();
    createReadStream(filePath).pipe(gunzip).pipe(child.stdin!);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderrOutput || `restore command exited with code ${code}`));
    });
  });
}
