export type WsChannel =
  | "sys.stats"
  | "sys.alerts"
  | "docker.logs"
  | "docker.stats"
  | "nginx.logs"
  | "os.upgrade"
  | "pm2.logs"
  | "migration.snapshot"
  | "migration.restore";

export interface WsSubscribeMessage<TParams = Record<string, unknown>> {
  channel: WsChannel;
  action: "subscribe" | "unsubscribe";
  params?: TParams;
}

export interface WsServerFrame<TData = unknown> {
  channel: WsChannel;
  data: TData;
}
