import { NginxService } from "../nginx/nginx.service.js";
import { DockerService } from "../docker/docker.service.js";

export const SitesService = {
  async listSites() {
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
      };
    });
  },

  async getSiteDetail(name: string) {
    const [vhost, cert] = await Promise.all([
      NginxService.getVhostDetail(name),
      NginxService.getCertStatus(name),
    ]);
    const containers = await DockerService.listContainers();
    const matchedContainer = containers.find((c) =>
      c.ports.some((p) => vhost.proxyPassTarget?.includes(String(p.publicPort ?? p.privatePort)))
    );
    return { vhost, cert, linkedContainer: matchedContainer ?? null };
  },
};
