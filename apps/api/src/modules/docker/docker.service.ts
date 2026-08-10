import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { docker } from "../../services/docker.client.js";
import { env } from "../../config/env.js";
import { GDriveService } from "../../services/gdrive.client.js";
import type {
  ContainerSummary,
  ContainerDetail,
  ImageSummary,
  VolumeSummary,
  NetworkSummary,
  DockerSystemDf,
} from "@pwa-admin/shared";

function calcCpuPercent(stats: any): number {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const cpuCount = stats.cpu_stats.online_cpus || 1;
  if (systemDelta > 0 && cpuDelta > 0) {
    return Math.round((cpuDelta / systemDelta) * cpuCount * 1000) / 10;
  }
  return 0;
}

export const DockerService = {
  async listContainers(): Promise<ContainerSummary[]> {
    const containers = await docker.listContainers({ all: true });
    return containers.map((c) => ({
      id: c.Id,
      name: c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12),
      image: c.Image,
      state: c.State,
      status: c.Status,
      ports: c.Ports.filter((p) => p.PrivatePort).map((p) => ({
        privatePort: p.PrivatePort,
        publicPort: p.PublicPort,
        type: p.Type,
      })),
      createdAt: new Date(c.Created * 1000).toISOString(),
    }));
  },

  async getContainerDetail(id: string): Promise<ContainerDetail> {
    const container = docker.getContainer(id);
    const info = await container.inspect();
    return {
      id: info.Id,
      name: info.Name.replace(/^\//, ""),
      image: info.Config.Image,
      state: info.State.Status,
      status: info.State.Status,
      ports: Object.entries(info.NetworkSettings.Ports ?? {}).flatMap(([key, bindings]) => {
        const [privatePort, type] = key.split("/");
        return (bindings ?? []).map((b: any) => ({
          privatePort: Number(privatePort),
          publicPort: b.HostPort ? Number(b.HostPort) : undefined,
          type,
        }));
      }),
      createdAt: info.Created,
      command: info.Config.Cmd?.join(" ") ?? "",
      env: (info.Config.Env ?? []).map((e) => e.split("=")[0]),
      mounts: (info.Mounts ?? []).map((m: any) => ({
        source: m.Source,
        destination: m.Destination,
        mode: m.Mode,
      })),
      networkMode: info.HostConfig.NetworkMode ?? "default",
      restartPolicy: info.HostConfig.RestartPolicy?.Name ?? "no",
    };
  },

  async startContainer(id: string): Promise<void> {
    await docker.getContainer(id).start();
  },

  async stopContainer(id: string): Promise<void> {
    await docker.getContainer(id).stop();
  },

  async restartContainer(id: string): Promise<void> {
    await docker.getContainer(id).restart();
  },

  async removeContainer(id: string): Promise<void> {
    await docker.getContainer(id).remove({ force: false });
  },

  async getLogs(id: string, tail = 200): Promise<string> {
    const container = docker.getContainer(id);
    const buffer = (await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
    })) as unknown as Buffer;
    return stripDockerLogHeaders(buffer);
  },

  async listImages(): Promise<ImageSummary[]> {
    const images = await docker.listImages();
    return images.map((img) => ({
      id: img.Id,
      tags: img.RepoTags ?? [],
      sizeBytes: img.Size,
      createdAt: new Date(img.Created * 1000).toISOString(),
    }));
  },

  async removeImage(id: string): Promise<void> {
    await docker.getImage(id).remove();
  },

  /**
   * Exports an image to a local .tar (docker save), optionally uploading it to
   * Drive too — lets an image be restored even without registry access.
   */
  async exportImage(
    id: string,
    label: string,
    targets: ("local" | "gdrive")[]
  ): Promise<{ filePath: string; sizeBytes: number; driveFileId: string | null }> {
    const destDir = join(env.BACKUP_LOCAL_ROOT, "images", label);
    await mkdir(destDir, { recursive: true });
    const archivePath = join(destDir, `${Date.now()}.tar`);

    const image = docker.getImage(id);
    const stream = (await image.get()) as NodeJS.ReadableStream;
    await pipeline(stream, createWriteStream(archivePath));

    const stats = await stat(archivePath);

    let driveFileId: string | null = null;
    if (targets.includes("gdrive") && GDriveService.isEnabled()) {
      const uploaded = await GDriveService.uploadBackupFile(archivePath, "paths", `image-${label}`);
      driveFileId = uploaded.fileId;
    }

    if (!targets.includes("local")) {
      await unlink(archivePath).catch(() => {});
    }

    return { filePath: archivePath, sizeBytes: stats.size, driveFileId };
  },

  /** Imports an image from a local .tar archive (docker load) — the counterpart to exportImage. */
  async importImage(archivePath: string): Promise<void> {
    const stream = createReadStream(archivePath);
    await new Promise<void>((resolve, reject) => {
      docker.loadImage(stream, {}, (err: Error | null, output?: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        if (!output) return resolve();
        output.on("data", () => {});
        output.on("end", () => resolve());
        output.on("error", reject);
      });
    });
  },

  async listVolumes(): Promise<VolumeSummary[]> {
    const { Volumes } = await docker.listVolumes();
    return (Volumes ?? []).map((v) => ({
      name: v.Name,
      driver: v.Driver,
      mountpoint: v.Mountpoint,
    }));
  },

  async removeVolume(name: string): Promise<void> {
    await docker.getVolume(name).remove();
  },

  async listNetworks(): Promise<NetworkSummary[]> {
    const networks = await docker.listNetworks();
    return networks.map((n) => ({
      id: n.Id,
      name: n.Name,
      driver: n.Driver,
      scope: n.Scope,
    }));
  },

  async systemDf(): Promise<DockerSystemDf> {
    const df = await docker.df();
    const containersSize = (df.Containers ?? []).reduce((sum: number, c: any) => sum + (c.SizeRw ?? 0), 0);
    const imagesSize = (df.Images ?? []).reduce((sum: number, i: any) => sum + (i.Size ?? 0), 0);
    const volumesSize = (df.Volumes ?? []).reduce((sum: number, v: any) => sum + (v.UsageData?.Size ?? 0), 0);
    const reclaimable = (df.Images ?? [])
      .filter((i: any) => i.Containers === 0)
      .reduce((sum: number, i: any) => sum + (i.Size ?? 0), 0);
    return {
      containersSizeBytes: containersSize,
      imagesSizeBytes: imagesSize,
      volumesSizeBytes: volumesSize,
      reclaimableBytes: reclaimable,
    };
  },

  async prune(): Promise<{ containersDeleted: string[]; imagesDeleted: string[]; spaceReclaimed: number }> {
    const containerResult = await docker.pruneContainers();
    const imageResult = await docker.pruneImages();
    return {
      containersDeleted: containerResult.ContainersDeleted ?? [],
      imagesDeleted: (imageResult.ImagesDeleted ?? []).map((i: any) => i.Deleted ?? i.Untagged ?? ""),
      spaceReclaimed: (containerResult.SpaceReclaimed ?? 0) + (imageResult.SpaceReclaimed ?? 0),
    };
  },

  async getStats(id: string): Promise<{ cpuPercent: number; memUsageBytes: number; memLimitBytes: number }> {
    const container = docker.getContainer(id);
    const stats = await container.stats({ stream: false });
    return {
      cpuPercent: calcCpuPercent(stats),
      memUsageBytes: stats.memory_stats.usage ?? 0,
      memLimitBytes: stats.memory_stats.limit ?? 0,
    };
  },
};

function stripDockerLogHeaders(buffer: Buffer): string {
  // Docker multiplexes stdout/stderr with an 8-byte header per frame when no TTY is attached.
  const lines: string[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break;
    const size = buffer.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) break;
    lines.push(buffer.subarray(start, end).toString("utf8"));
    offset = end;
  }
  return lines.length > 0 ? lines.join("") : buffer.toString("utf8");
}
