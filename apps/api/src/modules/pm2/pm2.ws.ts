import { registerChannel } from "../../services/wsHub.js";
import { spawnCommand } from "../../utils/exec.js";

const PROCESS_NAME_RE = /^[a-zA-Z0-9_-]+$/;

registerChannel("pm2.logs", (params, push) => {
  const name = params.name as string;
  if (!PROCESS_NAME_RE.test(name)) return () => {};

  // `pm2 logs <name>` (no --nostream) follows the process's out/error logs
  // live and never exits on its own — matches the docker.logs channel's
  // long-lived-process pattern.
  const child = spawnCommand("pm2", ["logs", name, "--raw"]);

  const onData = (chunk: Buffer) => push(chunk.toString("utf8"));
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);

  return () => {
    child.kill();
  };
});
