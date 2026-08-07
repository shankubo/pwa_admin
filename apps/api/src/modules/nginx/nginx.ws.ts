import { watch, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { registerChannel } from "../../services/wsHub.js";
import { env } from "../../config/env.js";
import { resolveVhostLogPath } from "./nginx.service.js";

registerChannel("nginx.logs", (params, push) => {
  const name = params.name as string;
  const type = (params.type as string) === "access" ? "access" : "error";

  let watcher: ReturnType<typeof watch> | null = null;
  let stopped = false;

  function startWatching(path: string) {
    let lastSize = statSync(path).size;
    watcher = watch(path, { persistent: false }, () => {
      try {
        const stats = statSync(path);
        if (stats.size <= lastSize) {
          lastSize = stats.size;
          return;
        }
        const fd = openSync(path, "r");
        const length = stats.size - lastSize;
        const buffer = Buffer.alloc(length);
        readSync(fd, buffer, 0, length, lastSize);
        closeSync(fd);
        lastSize = stats.size;
        push(buffer.toString("utf8"));
      } catch {
        // file may have rotated; next tick will resync via statSync
      }
    });
  }

  resolveVhostLogPath(name, type).then((resolved) => {
    if (stopped) return;
    const path = resolved ?? join(env.NGINX_LOG_DIR, `${type}.log`);
    if (!existsSync(path)) return;
    startWatching(path);
  });

  return () => {
    stopped = true;
    watcher?.close();
  };
});
