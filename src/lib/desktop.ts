import type { AppConfig, DesktopApi } from "@/types/desktop";

const CONFIG_KEY = "bloxbot-config";
const DEFAULT_CONFIG: AppConfig = { lastModel: null, hiddenModels: [] };

function loadBrowserConfig(): AppConfig {
  try {
    const stored = window.localStorage.getItem(CONFIG_KEY);
    return stored ? { ...DEFAULT_CONFIG, ...JSON.parse(stored) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

const browserFallback: DesktopApi = {
  async getOpenCodeInfo() {
    throw new Error("The desktop service is unavailable. Start BloxBot with pnpm dev.");
  },
  async getVersion() {
    return "0.5.2";
  },
  async openUrl(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  },
  async loadConfig() {
    return loadBrowserConfig();
  },
  async patchConfig(patch) {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...loadBrowserConfig(), ...patch }));
  },
  async checkForUpdate() {
    return null;
  },
  async installUpdate() {
    throw new Error("Updates are only available in the desktop app.");
  },
  async relaunch() {
    window.location.reload();
  },
};

export const desktop = window.bloxbot ?? browserFallback;
