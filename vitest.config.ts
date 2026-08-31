import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/test/**/*.test.{ts,tsx}"],
    deps: {
      inline: [/better-sqlite3/, /sqlite-vec/, /@huggingface\/transformers/],
    },
    server: {
      deps: {
        external: [/better-sqlite3/, /sqlite-vec/, /@huggingface\/transformers/],
      },
    },
  },
});
