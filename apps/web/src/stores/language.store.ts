import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SupportedLanguage } from "@/lib/i18n";

interface LanguageState {
  /** null = aucun choix explicite ; on suit i18next-browser-languagedetector
   * (navigator.language) plutôt que de forcer une langue. */
  language: SupportedLanguage | null;
  setLanguage: (language: SupportedLanguage) => void;
}

/** Préférence de langue — même pattern que uiMode.store.ts : préférence par
 * navigateur/appareil, jamais envoyée au backend, jamais liée à l'identité
 * utilisateur (pas de système de rôles dans cette app). */
export const useLanguageStore = create<LanguageState>()(
  persist(
    (set) => ({
      language: null,
      setLanguage: (language) => set({ language }),
    }),
    { name: "pwa-admin-language" }
  )
);
