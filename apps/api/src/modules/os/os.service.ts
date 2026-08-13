import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import si from "systeminformation";
import { runCommand, isValidPackageName, isValidPackageVersion } from "../../utils/exec.js";
import { AptJobRunner } from "./aptJobRunner.js";
import { env } from "../../config/env.js";
import type { OsInfo, InstalledPackage, UpgradablePackage } from "@pwa-admin/shared";

export const OsService = {
  async getInfo(): Promise<OsInfo> {
    const [osInfo, time] = await Promise.all([si.osInfo(), si.time()]);

    const rebootRequired = existsSync("/var/run/reboot-required");
    let rebootRequiredPackages: string[] = [];
    if (rebootRequired && existsSync("/var/run/reboot-required.pkgs")) {
      const content = await readFile("/var/run/reboot-required.pkgs", "utf8").catch(() => "");
      rebootRequiredPackages = content.split("\n").map((l) => l.trim()).filter(Boolean);
    }

    return {
      distro: osInfo.distro,
      release: osInfo.release,
      kernel: osInfo.kernel,
      arch: osInfo.arch,
      hostname: osInfo.hostname,
      uptimeSeconds: time.uptime,
      rebootRequired,
      rebootRequiredPackages,
    };
  },

  async listInstalledPackages(): Promise<InstalledPackage[]> {
    const { stdout } = await runCommand(
      "dpkg-query",
      ["-W", "-f=${Package}\\t${Version}\\t${Architecture}\\t${Installed-Size}\\n"],
      { timeoutMs: 15000 }
    );
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, version, architecture, sizeKb] = line.split("\t");
        return { name, version, architecture, sizeKb: Number(sizeKb) || 0 };
      });
  },

  async listUpgradablePackages(): Promise<UpgradablePackage[]> {
    // LC_ALL=C forces apt's own output to English regardless of the system's
    // configured locale — a server with e.g. LANG=fr_FR.UTF-8 prints
    // "[pouvant être mis à jour depuis: ...]" instead of "[upgradable
    // from: ...]", which silently made this parser match zero lines (still
    // exit code 0, no error — the admin just saw "0 paquets" on a server
    // that genuinely had updates). Same idiom apt/dpkg tooling itself
    // recommends for scripting against their output.
    const { stdout } = await runCommand("apt", ["list", "--upgradable"], {
      timeoutMs: 15000,
      env: { LC_ALL: "C" },
    });
    const results: UpgradablePackage[] = [];
    for (const line of stdout.split("\n")) {
      const match = /^([^/]+)\/\S+\s+(\S+)\s+\S+\s+\[upgradable from:\s*([^\]]+)\]/.exec(line);
      if (match) {
        results.push({ name: match[1], availableVersion: match[2], currentVersion: match[3] });
      }
    }
    return results;
  },

  async listHeldPackages(): Promise<string[]> {
    const { stdout } = await runCommand("apt-mark", ["showhold"], { timeoutMs: 10000 });
    return stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  },

  async startUpdateCheck(): Promise<string> {
    return AptJobRunner.start("update-check", "sudo", ["apt-get", "update"]);
  },

  async startUpgrade(mode: "upgrade" | "full-upgrade"): Promise<string> {
    const subcommand = mode === "full-upgrade" ? "full-upgrade" : "upgrade";
    return AptJobRunner.start("upgrade", "sudo", ["apt-get", subcommand, "-y"]);
  },

  /** Installs several packages in one apt-get invocation — used by the
   * migration restore flow's "installer les paquets manquants" step, where
   * re-running the single-package install route once per package would mean
   * re-running `apt-get update` implicitly N times over. Every name is
   * validated the same way the single-package route already does. Enforces
   * APT_ALLOW_INSTALL_REMOVE itself (not just at the route layer) so every
   * caller — including MigrationService's restore orchestrator — is bound
   * by the same admin-configured policy. */
  async installPackages(names: string[]): Promise<string> {
    if (!env.APT_ALLOW_INSTALL_REMOVE) throw new Error("install_remove_disabled");
    if (names.length === 0) throw new Error("no_packages_given");
    for (const name of names) {
      if (!isValidPackageName(name)) throw new Error(`invalid_package_name: ${name}`);
    }
    return AptJobRunner.start("install-batch", "sudo", ["apt-get", "install", "-y", ...names]);
  },

  /**
   * Migration restore's package step: installs whatever from `targets` isn't
   * currently installed, and upgrades whatever IS installed but at an older
   * version than the manifest recorded — a plain install/AptJobRunner batch
   * only covers the first half. Runs synchronously (not through AptJobRunner,
   * which only tracks one fire-and-forget job at a time) because each
   * package needs its own version-pin-then-fallback attempt, not a single
   * shared apt-get invocation.
   *
   * For each outdated package, tries `apt-get install <pkg>=<version>` first
   * (exact version from the old server) — if that exact version isn't in
   * this machine's repos (common after an OS upgrade, or a different
   * Debian/Ubuntu point release), falls back to `apt-get install
   * --only-upgrade <pkg>` (whatever's newest available) rather than failing
   * the whole restore over one unpinned package.
   */
  async installOrUpgradePackages(
    targets: { name: string; version: string }[]
  ): Promise<{ installed: string[]; upgraded: string[]; upToDate: string[]; failed: { name: string; error: string }[] }> {
    if (!env.APT_ALLOW_INSTALL_REMOVE) throw new Error("install_remove_disabled");

    await runCommand("sudo", ["apt-get", "update"], { timeoutMs: 60_000 }).catch(() => {});

    const installedByName = new Map((await this.listInstalledPackages()).map((p) => [p.name, p.version]));
    const installed: string[] = [];
    const upgraded: string[] = [];
    const upToDate: string[] = [];
    const failed: { name: string; error: string }[] = [];

    for (const target of targets) {
      // target.version comes from a migration manifest's os-packages.json —
      // a file read off a USB drive, not admin-typed input — so it needs
      // the same argv-injection guard as the package name before ever
      // reaching a sudo apt-get invocation.
      if (!isValidPackageName(target.name) || !isValidPackageVersion(target.version)) {
        failed.push({ name: target.name, error: "invalid_package_name_or_version" });
        continue;
      }
      const currentVersion = installedByName.get(target.name);
      if (currentVersion === target.version) {
        upToDate.push(target.name);
        continue;
      }

      try {
        if (!currentVersion) {
          await runCommand("sudo", ["apt-get", "install", "-y", `${target.name}=${target.version}`], {
            timeoutMs: 120_000,
          }).catch(() =>
            // Exact version not available on this machine's repos — install
            // whatever's current rather than failing the whole restore.
            runCommand("sudo", ["apt-get", "install", "-y", target.name], { timeoutMs: 120_000 })
          );
          installed.push(target.name);
        } else {
          await runCommand("sudo", ["apt-get", "install", "-y", `${target.name}=${target.version}`], {
            timeoutMs: 120_000,
          }).catch(() =>
            runCommand("sudo", ["apt-get", "install", "--only-upgrade", "-y", target.name], { timeoutMs: 120_000 })
          );
          upgraded.push(target.name);
        }
      } catch (err) {
        failed.push({ name: target.name, error: (err as Error).message });
      }
    }

    return { installed, upgraded, upToDate, failed };
  },

  async holdPackage(name: string): Promise<void> {
    if (!isValidPackageName(name)) throw new Error("invalid_package_name");
    const installed = await this.listInstalledPackages();
    if (!installed.some((p) => p.name === name)) throw new Error("package_not_installed");
    await runCommand("sudo", ["apt-mark", "hold", name], { timeoutMs: 10000 });
  },

  async unholdPackage(name: string): Promise<void> {
    if (!isValidPackageName(name)) throw new Error("invalid_package_name");
    await runCommand("sudo", ["apt-mark", "unhold", name], { timeoutMs: 10000 });
  },

  isJobRunning(): boolean {
    return AptJobRunner.isRunning();
  },
};

export { AptJobRunner };
