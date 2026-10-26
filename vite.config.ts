import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron/simple";

const host = process.env.VITE_DEV_HOST;

/**
 * Vendor packages that stay byte-identical across app releases, split into
 * their own chunks so an app update only invalidates the small app chunk.
 *
 * Deliberately not a catch-all: Rollup would then fold lazy-only dependencies
 * (Shiki languages, Settings' panels) into the eagerly loaded bundle and undo
 * the dynamic imports.
 */
const VENDOR_CHUNKS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["react-vendor", ["react", "react-dom", "scheduler"]],
  ["query-vendor", ["@tanstack/"]],
  ["effect-vendor", ["effect", "@effect/"]],
  ["analytics-vendor", ["posthog-js"]],
  ["icons-vendor", ["lucide-react"]],
  ["editor-vendor", ["lexical", "@lexical/"]],
];

function vendorChunkFor(id: string): string | undefined {
  const marker = "/node_modules/";
  const normalized = id.replace(/\\/g, "/");
  const index = normalized.lastIndexOf(marker);
  if (index === -1) return undefined;
  const packagePath = normalized.slice(index + marker.length);
  for (const [chunk, prefixes] of VENDOR_CHUNKS) {
    const matches = prefixes.some((prefix) =>
      prefix.endsWith("/")
        ? packagePath.startsWith(prefix)
        : packagePath === prefix || packagePath.startsWith(`${prefix}/`),
    );
    if (matches) return chunk;
  }
  return undefined;
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: vendorChunkFor,
      },
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
