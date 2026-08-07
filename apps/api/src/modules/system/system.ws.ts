import { registerChannel } from "../../services/wsHub.js";
import { SystemService } from "./system.service.js";

const SAMPLE_INTERVAL_MS = 2000;

registerChannel("sys.stats", (_params, push) => {
  const timer = setInterval(async () => {
    push(await SystemService.getSnapshot());
  }, SAMPLE_INTERVAL_MS);
  return () => clearInterval(timer);
});

registerChannel("sys.alerts", (_params, push) => {
  const timer = setInterval(async () => {
    const snapshot = await SystemService.getSnapshot();
    push(SystemService.evaluateAlerts(snapshot));
  }, SAMPLE_INTERVAL_MS);
  return () => clearInterval(timer);
});
