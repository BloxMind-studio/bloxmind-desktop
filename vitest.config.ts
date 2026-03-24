import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

function mock(path: string) {
  return fileURLToPath(new URL(`./src/__mocks__/${path}`, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@tauri-apps/api/app": mock("@tauri-apps/api/app.ts"),
      "@tauri-apps/api/core": mock("@tauri-apps/api/core.ts"),
      "@tauri-apps/plugin-opener": mock("@tauri-apps/plugin-opener.ts"),
      "@tauri-apps/plugin-process": mock("@tauri-apps/plugin-process.ts"),
      "@tauri-apps/plugin-store": mock("@tauri-apps/plugin-store.ts"),
      "@tauri-apps/plugin-updater": mock("@tauri-apps/plugin-updater.ts"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/test/**/*.test.{ts,tsx}"],
  },
});
