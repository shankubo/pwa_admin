import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";
import { execSync } from "node:child_process";

// Captured at build time (not runtime) so the version shown in About always
// reflects exactly what was deployed — no manual bump to forget, no drift
// between what's running and what's displayed. Works identically whether the
// build ran via the RPi's auto-update.sh or a manual deploy on ubuntu_ext,
// since both just run `npm run build:web` against whatever commit is checked
// out. Falls back to "unknown" if git isn't available (shouldn't happen in
// this repo's deploy flow, but never fail the build over a version string).
function gitInfo(): { commit: string; date: string; buildNumber: string } {
  try {
    const commit = execSync("git rev-parse --short HEAD").toString().trim();
    const date = execSync("git log -1 --format=%cd --date=format:%Y-%m-%d").toString().trim();
    // Total commit count on the current branch — a simple, always-accurate
    // sequential build number with nothing to remember to bump, unlike a
    // version field in package.json that requires a manual edit every deploy.
    const buildNumber = execSync("git rev-list --count HEAD").toString().trim();
    return { commit, date, buildNumber };
  } catch {
    return { commit: "unknown", date: "", buildNumber: "?" };
  }
}

const { commit: GIT_COMMIT, date: GIT_DATE, buildNumber: BUILD_NUMBER } = gitInfo();

export default defineConfig({
  define: {
    __GIT_COMMIT__: JSON.stringify(GIT_COMMIT),
    __GIT_DATE__: JSON.stringify(GIT_DATE),
    __BUILD_NUMBER__: JSON.stringify(BUILD_NUMBER),
  },
  plugins: [
    react(),
    VitePWA({
      // "prompt" (not autoUpdate): the SW waits for explicit confirmation
      // before activating a new version, which is what makes needRefresh
      // actually fire so the app can show an update banner — autoUpdate
      // swaps versions silently in the background with zero UI hook, which
      // is exactly why iOS (where the SW rarely wakes up on its own to even
      // check) could show a stale build with no way to notice or force it.
      registerType: "prompt",
      includeAssets: [
        "favicon.ico",
        "favicon-16x16.png",
        "favicon-32x32.png",
        "icons/**/*.png",
      ],
      manifest: {
        name: "Server Admin",
        short_name: "ServerAdmin",
        description: "Administration mobile complète pour serveur Linux",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "portrait",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "icons/android/ic_launcher-xxxhdpi-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/android/playstore-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8443",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
