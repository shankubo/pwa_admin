import { registerChannel } from "../../services/wsHub.js";
import { docker } from "../../services/docker.client.js";
import { DockerService } from "./docker.service.js";

registerChannel("docker.logs", (params, push) => {
  const id = params.id as string;
  let stream: NodeJS.ReadableStream | null = null;
  let stopped = false;

  docker
    .getContainer(id)
    .logs({ follow: true, stdout: true, stderr: true, tail: 100, timestamps: true })
    .then((s: any) => {
      if (stopped) {
        s.destroy?.();
        return;
      }
      stream = s;
      s.on("data", (chunk: Buffer) => {
        push(chunk.toString("utf8"));
      });
    })
    .catch(() => {});

  return () => {
    stopped = true;
    (stream as any)?.destroy?.();
  };
});

registerChannel("docker.stats", (params, push) => {
  const id = params.id as string;
  const timer = setInterval(async () => {
    try {
      push(await DockerService.getStats(id));
    } catch {
      // container may have stopped; skip this tick
    }
  }, 2000);
  return () => clearInterval(timer);
});
