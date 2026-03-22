import { invoke } from "@tauri-apps/api/core";

export interface AppConfig {
  hasLaunched: boolean;
  lastModel: string | null;
  hiddenModels: string[];
}

export async function loadConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("get_config");
}

export async function patchConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  return invoke<AppConfig>("set_config", { patch });
}
