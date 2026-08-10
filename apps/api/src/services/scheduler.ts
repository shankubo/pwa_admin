import cron from "node-cron";
import { BackupJobModel } from "../db/models/backup.js";
import { ApplicationModel } from "../db/models/application.js";
import type { BackupTarget, AppBackupRunKind } from "@pwa-admin/shared";

const scheduledTasks = new Map<number, cron.ScheduledTask>();
const scheduledAppTasks = new Map<string, cron.ScheduledTask>();

function appTaskKey(appId: number, kind: AppBackupRunKind): string {
  return `${appId}:${kind}`;
}

export const SchedulerService = {
  start(): void {
    for (const job of BackupJobModel.list()) {
      if (job.schedule_cron) this.registerBackupJob(job.id, job.schedule_cron);
    }
    for (const application of ApplicationModel.list()) {
      if (application.schedule_full_cron) {
        this.registerAppBackup(application.id, "full", application.schedule_full_cron);
      }
      if (application.schedule_partial_cron) {
        this.registerAppBackup(application.id, "partial", application.schedule_partial_cron);
      }
    }
  },

  registerBackupJob(jobId: number, cronExpression: string): void {
    if (!cron.validate(cronExpression)) return;
    this.unregisterBackupJob(jobId);

    const task = cron.schedule(cronExpression, async () => {
      const job = BackupJobModel.findById(jobId);
      if (!job) return;
      const targets = JSON.parse(job.targets) as BackupTarget[];

      if (job.source_type === "volume") {
        const { BackupService } = await import("../modules/backup/backup.service.js");
        await BackupService.backupVolume(job.source_ref, targets).catch(() => {});
      } else if (job.source_type === "path") {
        const { BackupService } = await import("../modules/backup/backup.service.js");
        const mounts = await BackupService.detectBindMounts();
        if (mounts.some((m) => m.hostPath === job.source_ref)) {
          await BackupService.backupPath(job.source_ref, targets).catch(() => {});
        }
      } else if (job.source_type === "db") {
        // sourceRef for scheduled DB jobs is stored as "location:ref" (e.g.
        // "native:mariadb" or "docker:<containerId>") — see backup.routes.ts's
        // job-creation validation for the corresponding format enforcement.
        const [location, ref] = job.source_ref.split(":");
        if (location === "docker" || location === "native") {
          const { DbBackupService } = await import("../modules/dbbackup/dbbackup.service.js");
          await DbBackupService.dump(location, ref, targets).catch(() => {});
        }
      }
    });
    scheduledTasks.set(jobId, task);
  },

  unregisterBackupJob(jobId: number): void {
    const task = scheduledTasks.get(jobId);
    if (task) {
      task.stop();
      scheduledTasks.delete(jobId);
    }
  },

  registerAppBackup(appId: number, kind: AppBackupRunKind, cronExpression: string): void {
    if (!cron.validate(cronExpression)) return;
    this.unregisterAppBackup(appId, kind);

    const task = cron.schedule(cronExpression, async () => {
      const application = ApplicationModel.findById(appId);
      if (!application) return;
      const { ApplicationService } = await import("../modules/application/application.service.js");
      await ApplicationService.runBackup(application, kind).catch(() => {});
    });
    scheduledAppTasks.set(appTaskKey(appId, kind), task);
  },

  unregisterAppBackup(appId: number, kind: AppBackupRunKind): void {
    const key = appTaskKey(appId, kind);
    const task = scheduledAppTasks.get(key);
    if (task) {
      task.stop();
      scheduledAppTasks.delete(key);
    }
  },
};
