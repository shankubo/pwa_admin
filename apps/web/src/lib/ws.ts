import { useEffect, useRef } from "react";
import type { WsChannel, WsServerFrame, WsSubscribeMessage } from "@pwa-admin-pi/shared";
import { useAuthStore } from "@/stores/auth.store";

type FrameHandler = (frame: WsServerFrame) => void;

export function useWsChannel(channel: WsChannel, onFrame: FrameHandler, params?: Record<string, unknown>) {
  const socketRef = useRef<WebSocket | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    const token = useAuthStore.getState().accessToken;
    if (!token) return;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${window.location.host}/api/ws?token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(url);
    socketRef.current = socket;

    const subscribe = () => {
      const msg: WsSubscribeMessage = { channel, action: "subscribe", params };
      socket.send(JSON.stringify(msg));
    };

    socket.addEventListener("open", subscribe);
    socket.addEventListener("message", (event) => {
      try {
        const frame = JSON.parse(event.data) as WsServerFrame;
        if (frame.channel === channel) onFrameRef.current(frame);
      } catch {
        // ignore malformed frames
      }
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, JSON.stringify(params)]);
}
