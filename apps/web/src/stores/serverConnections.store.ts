import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ServerConnection } from "@pwa-admin/shared";

interface ServerConnectionsState {
  servers: ServerConnection[];
  addServer: (server: ServerConnection) => void;
  removeServer: (id: string) => void;
}

/** Registered servers this browser can switch between — each is a fully
 * independent pwa-admin deployment (own DB, own auth, own Tailscale
 * identity). Persisted to localStorage since it's a per-device preference,
 * not something the backend needs to know about. */
export const useServerConnectionsStore = create<ServerConnectionsState>()(
  persist(
    (set) => ({
      servers: [],
      addServer: (server) => set((state) => ({ servers: [...state.servers, server] })),
      removeServer: (id) => set((state) => ({ servers: state.servers.filter((s) => s.id !== id) })),
    }),
    { name: "pwa-admin-server-connections" }
  )
);
