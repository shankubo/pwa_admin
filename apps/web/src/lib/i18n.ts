import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import HttpBackend from "i18next-http-backend";

export const SUPPORTED_LANGUAGES = ["fr", "en", "ta"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "fr",
    supportedLngs: [...SUPPORTED_LANGUAGES],
    ns: ["common", "nav", "settings", "login", "pm2", "security", "os", "network"],
    defaultNS: "common",
    backend: {
      loadPath: "/locales/{{lng}}/{{ns}}.json",
    },
    detection: {
      // localStorage checked first so an explicit choice (set by
      // language.store.ts via i18n.changeLanguage) wins on repeat visits;
      // falls through to navigator language only when nothing is stored yet.
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "pwa-admin-i18n-language",
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
