import { db } from "../../db/index.js";
import { NginxService } from "../nginx/nginx.service.js";
import { DockerService } from "../docker/docker.service.js";
import { SiteDuplicateService } from "./siteDuplicate.service.js";
import type { SiteSummary, SiteDetail } from "@pwa-admin/shared";

export const SitesService = {
  async listSites(): Promise<SiteSummary[]> {
    const [vhosts, containers] = await Promise.all([
      NginxService.listVhosts(),
      DockerService.listContainers(),
    ]);

    return vhosts.map((vhost) => {
      const matchedContainer = containers.find((c) =>
        c.ports.some((p) => vhost.proxyPassTarget?.includes(String(p.publicPort ?? p.privatePort)))
      );
      return {
        ...vhost,
        linkedContainer: matchedContainer
          ? { id: matchedContainer.id, name: matchedContainer.name, state: matchedContainer.state }
          : null,
        hasDuplicate: hasDuplicateSync(vhost.name),
        failoverActive: NginxService.isSwitchedToDuplicate(vhost.name),
      };
    });
  },

  async getSiteDetail(name: string): Promise<SiteDetail> {
    const [vhost, cert, duplicate] = await Promise.all([
      NginxService.getVhostDetail(name),
      NginxService.getCertStatus(name),
      SiteDuplicateService.getDuplicateStatus(name),
    ]);
    const containers = await DockerService.listContainers();
    const matchedContainer = containers.find((c) =>
      c.ports.some((p) => vhost.proxyPassTarget?.includes(String(p.publicPort ?? p.privatePort)))
    );
    return {
      vhost,
      cert,
      linkedContainer: matchedContainer ?? null,
      duplicate,
      failoverActive: NginxService.isSwitchedToDuplicate(name),
    };
  },
};

function hasDuplicateSync(vhostName: string): boolean {
  return !!db.prepare("SELECT 1 FROM site_duplicates WHERE vhost_name = ?").get(vhostName);
}
