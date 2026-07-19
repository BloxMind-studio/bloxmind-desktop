import { desktop } from "@/lib/desktop";
import type { AppConfig } from "@/types/desktop";

export type { AppConfig } from "@/types/desktop";

export async function loadConfig(): Promise<AppConfig> {
  return desktop.loadConfig();
}

export async function patchConfig(patch: Partial<AppConfig>): Promise<void> {
  await desktop.patchConfig(patch);
}
