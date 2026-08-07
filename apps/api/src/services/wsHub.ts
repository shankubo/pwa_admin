import type { WebSocket } from "@fastify/websocket";
import type { WsChannel, WsServerFrame, WsSubscribeMessage } from "@pwa-admin-pi/shared";

interface Subscription {
  socket: WebSocket;
  params: Record<string, unknown>;
}

type ChannelHandler = (params: Record<string, unknown>, push: (data: unknown) => void) => () => void;

const channelHandlers = new Map<WsChannel, ChannelHandler>();
const activeSubscriptions = new Map<string, { stop: () => void; subs: Set<WebSocket> }>();

function subscriptionKey(channel: WsChannel, params: Record<string, unknown>): string {
  return `${channel}:${JSON.stringify(params ?? {})}`;
}

export function registerChannel(channel: WsChannel, handler: ChannelHandler) {
  channelHandlers.set(channel, handler);
}

export function attachWsClient(socket: WebSocket) {
  const clientSubs = new Set<string>();

  socket.on("message", (raw: Buffer) => {
    let msg: WsSubscribeMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const handler = channelHandlers.get(msg.channel);
    if (!handler) return;

    const key = subscriptionKey(msg.channel, msg.params ?? {});

    if (msg.action === "subscribe") {
      clientSubs.add(key);
      let entry = activeSubscriptions.get(key);
      if (!entry) {
        const subs = new Set<WebSocket>();
        const push = (data: unknown) => {
          const frame: WsServerFrame = { channel: msg.channel, data };
          const payload = JSON.stringify(frame);
          for (const s of subs) {
            if (s.readyState === s.OPEN) s.send(payload);
          }
        };
        const stop = handler(msg.params ?? {}, push);
        entry = { stop, subs };
        activeSubscriptions.set(key, entry);
      }
      entry.subs.add(socket);
    } else if (msg.action === "unsubscribe") {
      clientSubs.delete(key);
      const entry = activeSubscriptions.get(key);
      if (entry) {
        entry.subs.delete(socket);
        if (entry.subs.size === 0) {
          entry.stop();
          activeSubscriptions.delete(key);
        }
      }
    }
  });

  socket.on("close", () => {
    for (const key of clientSubs) {
      const entry = activeSubscriptions.get(key);
      if (entry) {
        entry.subs.delete(socket);
        if (entry.subs.size === 0) {
          entry.stop();
          activeSubscriptions.delete(key);
        }
      }
    }
  });
}
