/// <reference types="vite/client" />

import type { DesktopApi } from "@/types/desktop";

declare global {
  interface ImportMetaEnv {
    readonly VITE_POSTHOG_PROJECT_TOKEN?: string;
    readonly NEXT_PUBLIC_CORE_API_URL?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    BloxMind?: DesktopApi;
  }
}
