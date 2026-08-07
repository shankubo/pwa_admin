import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import si from "systeminformation";
import { runCommand, isValidPackageName } from "../../utils/exec.js";
import { AptJobRunner } from "./aptJobRunner.js";
import type { OsInfo, InstalledPackage, UpgradablePackage } from "@pwa-admin-pi/shared";

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
    const { stdout } = await runCommand("apt", ["list", "--upgradable"], { timeoutMs: 15000 });
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
