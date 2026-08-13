import type { OpenCodeInfo } from "@/types/desktop";

/**
 * Base URL of the private BloxMind Core Engine API.
 *
 * The public Desktop App talks to the private engine in cloud mode when this
 * variable is set at build time. When unset, the app talks to the local OpenCode
 * engine spawned by the Electron main process.
 *
 * Injected statically by Vite (see `envPrefix: ["VITE_", "NEXT_PUBLIC_"]`).
 */
export const CORE_API_URL = import.meta.env.NEXT_PUBLIC_CORE_API_URL?.trim() ?? null;

export interface ApiEndpoint {
  /** True when talking to the hosted BloxMind Core Engine instead of the local engine. */
  isCloud: boolean;
  /** Base URL handed to the OpenCode SDK client. */
  baseUrl: string;
  /** Authorization header value for the local engine; cloud endpoints may not need one. */
  authorization: string | null;
}

/**
 * Resolves the active engine endpoint the renderer should communicate with.
 *
 * - **Cloud mode** (`NEXT_PUBLIC_CORE_API_URL` is set): talk to the private
 *   Core Engine API. No local subprocess is required.
 * - **Desktop mode**: fall back to the local OpenCode engine resolved by the
 *   Electron main process on `127.0.0.1:<port>`.
 */
export function resolveApiEndpoint(info: OpenCodeInfo): ApiEndpoint {
  if (CORE_API_URL) {
    return {
      isCloud: true,
      baseUrl: CORE_API_URL.replace(/\/+$/, ""),
      authorization: null,
    };
  }

  return {
    isCloud: false,
    baseUrl: `http://127.0.0.1:${info.port}`,
    authorization: info.authorization,
  };
}
