/// <reference types="vite/client" />

import type { DesktopApi } from "@/types/desktop";
import type { ElectronAuthApi } from "@/types/license";

declare global {
  interface ImportMetaEnv {
    readonly VITE_POSTHOG_PROJECT_TOKEN?: string;
    readonly NEXT_PUBLIC_CORE_API_URL?: string;
    readonly NEXT_PUBLIC_BLOXMIND_API_TOKEN?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    BloxMind?: DesktopApi;
    electron?: {
      auth?: ElectronAuthApi;
    };
  }
}
