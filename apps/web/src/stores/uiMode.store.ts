import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UiMode = "advanced" | "easy";

interface UiModeState {
  mode: UiMode;
  setMode: (mode: UiMode) => void;
  toggleMode: () => void;
}

/** Easy/Advanced nav mode — purely a per-browser display preference (which
 * drawer items are shown), never sent to or read from the backend, and never
 * tied to user identity (this app has no role/permission system). Persisted
 * to localStorage for the same reason serverConnections.store.ts is: a
 * per-device preference the backend doesn't need to know about. Defaults to
 * "advanced" so existing users see zero change until they opt in. */
export const useUiModeStore = create<UiModeState>()(
  persist(
    (set, get) => ({
      mode: "advanced",
      setMode: (mode) => set({ mode }),
      toggleMode: () => set({ mode: get().mode === "advanced" ? "easy" : "advanced" }),
    }),
    { name: "pwa-admin-ui-mode" }
  )
);
