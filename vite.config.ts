import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron/simple";

const host = process.env.VITE_DEV_HOST;
// Playwright serves the renderer only; skip the Electron plugin so e2e can
// run without launching Electron.
const isE2E = process.env.E2E === "1";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(isE2E
      ? []
      : [
          electron({
            main: {
              entry: "electron/main.ts",
              vite: {
                build: {
                  outDir: "dist-electron/main",
                },
              },
            },
            preload: {
              input: "electron/preload.ts",
              vite: {
                build: {
                  outDir: "dist-electron/preload",
                },
              },
            },
          }),
        ]),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Keep the renderer port stable so the Electron main process can load it.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: { ignored: ["**/dist-electron/**"] },
  },
});
