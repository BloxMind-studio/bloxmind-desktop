import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { sseDispatch } from "@/lib/sseDispatch";
import type { OpenCodeStatus } from "@/types";

const SSE_RECONNECT_DELAY = 3000;
const SSE_FAILURE_THRESHOLD = 3;

interface StatusPayload {
  status: OpenCodeStatus;
  port: number;
}

function serverStatusLabel(status: OpenCodeStatus): "starting" | "running" | "stopped" | "error" {
  if (status === "Running") return "running";
  if (status === "Starting") return "starting";
  if (typeof status === "object" && "Error" in status) return "error";
  return "stopped";
}

interface OpenCodeClientContextValue {
  client: OpencodeClient | null;
  status: OpenCodeStatus;
  port: number;
  serverError: string | null;
  ready: boolean;
  initError: string | null;
}

export const OpenCodeClientContext = createContext<OpenCodeClientContextValue>({
  client: null,
  status: "Stopped",
  port: 4096,
  serverError: null,
  ready: false,
  initError: null,
});

export function useOpenCodeClient() {
  return useContext(OpenCodeClientContext);
}

export function OpenCodeClientProvider({
  children,
  activeSessionIdRef,
}: {
  children: ReactNode;
  activeSessionIdRef: React.RefObject<string | null>;
}) {
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<OpenCodeStatus>("Stopped");
  const [port, setPort] = useState(4096);
  const [serverError, setServerError] = useState<string | null>(null);
  const [client, setClient] = useState<OpencodeClient | null>(null);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const prevServerLabel = useRef<string>("stopped");
  const hasBeenReady = useRef(false);
  const sseAbortRef = useRef<AbortController | null>(null);
  const initGenerationRef = useRef(0);

  // ── Tauri event listener for status changes ─────────────────────────
  useEffect(() => {
    console.debug("frontend", "OpenCodeClientProvider mounted, fetching initial status");
    invoke<[OpenCodeStatus, number]>("get_opencode_status")
      .then(([s, p]) => {
        setStatus(s);
        setPort(p);
        const errorMsg = typeof s === "object" && "Error" in s ? s.Error : null;
        setServerError(errorMsg);
      })
      .catch((err) => console.error("Failed to fetch initial OpenCode status:", err));

    const unlisten = listen<StatusPayload>("opencode-status-changed", (event) => {
      const s = event.payload.status;
      const label = typeof s === "object" && "Error" in s ? `Error(${s.Error})` : String(s);
      console.debug("frontend", `Server status changed: ${label} (port ${event.payload.port})`);
      setStatus(event.payload.status);
      setPort(event.payload.port);
      const errorMsg =
        typeof event.payload.status === "object" && "Error" in event.payload.status
          ? event.payload.status.Error
          : null;
      setServerError(errorMsg);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // ── Client creation ─────────────────────────────────────────────────
  useEffect(() => {
    if (status === "Running" && !client) {
      let cancelled = false;
      let retryTimer: ReturnType<typeof setTimeout>;

      const attempt = () => {
        console.debug("frontend", `Creating SDK client for port ${port}`);
        invoke<string>("get_workspace_dir")
          .then((dir) => {
            if (cancelled) return;
            console.debug("frontend", `Workspace dir: ${dir}`);
            setClient(
              createOpencodeClient({
                baseUrl: `http://127.0.0.1:${port}`,
                directory: dir,
              }),
            );
            console.debug("frontend", "SDK client created");
          })
          .catch((err) => {
            if (cancelled) return;
            console.error("Failed to get workspace directory:", err);
            retryTimer = setTimeout(attempt, 2000);
          });
      };
      attempt();

      return () => {
        cancelled = true;
        clearTimeout(retryTimer);
      };
    }
    if (status !== "Running" && client) {
      console.debug("frontend", "Server no longer running, clearing client");
      setClient(null);
      setReady(false);
    }
  }, [status, port, client]);

  // ── Init: fetch all data ────────────────────────────────────────────
  useEffect(() => {
    if (!client || ready) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;
    const generation = ++initGenerationRef.current;

    const attempt = () => {
      console.debug("frontend", "Client available, running init()");
      doInit(client, queryClient, generation, initGenerationRef)
        .then(() => {
          if (cancelled || initGenerationRef.current !== generation) return;
          console.debug("frontend", "init() completed");
          setReady(true);
          setInitError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          console.debug("frontend", `init() failed: ${err}, retrying in 3s`);
          setInitError(typeof err === "string" ? err : String(err));
          retryTimer = setTimeout(attempt, 3000);
        });
    };
    attempt();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [client, ready, queryClient]);

  // ── SSE subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (!client || !ready) return;

    const abortController = new AbortController();
    sseAbortRef.current = abortController;
    let consecutiveFailures = 0;
    let reconnectToastId: string | number | undefined;

    function showReconnectToast() {
      if (reconnectToastId != null) return;
      reconnectToastId = toast.error("Lost connection to OpenCode", {
        description: "Events are no longer being received.",
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Reconnect",
          onClick: () => {
            console.debug("frontend", "User triggered reconnect");
            setClient(null);
            setReady(false);
          },
        },
      });
    }

    function dismissReconnectToast() {
      if (reconnectToastId != null) {
        toast.dismiss(reconnectToastId);
        reconnectToastId = undefined;
      }
    }

    async function subscribe() {
      try {
        if (!client) return;
        console.debug("frontend", "Subscribing to SSE events");
        const sseResult = await client.event.subscribe({});
        if (!sseResult?.stream) {
          console.debug("frontend", "SSE subscribe returned no stream");
          consecutiveFailures++;
          if (consecutiveFailures >= SSE_FAILURE_THRESHOLD) showReconnectToast();
          if (!abortController.signal.aborted) {
            setTimeout(() => {
              if (!abortController.signal.aborted) subscribe();
            }, SSE_RECONNECT_DELAY);
          }
          return;
        }
        console.debug("frontend", "SSE stream connected");
        consecutiveFailures = 0;
        dismissReconnectToast();

        for await (const event of sseResult.stream) {
          if (abortController.signal.aborted) break;
          sseDispatch(queryClient, event, activeSessionIdRef);
        }
        console.debug("frontend", "SSE stream ended");

        if (!abortController.signal.aborted) {
          consecutiveFailures++;
          if (consecutiveFailures >= SSE_FAILURE_THRESHOLD) showReconnectToast();
          setTimeout(() => {
            if (!abortController.signal.aborted) subscribe();
          }, SSE_RECONNECT_DELAY);
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          console.debug("frontend", `SSE stream error: ${err}`);
          console.error("SSE stream error:", err);
          consecutiveFailures++;
          if (consecutiveFailures >= SSE_FAILURE_THRESHOLD) showReconnectToast();
          setTimeout(() => {
            if (!abortController.signal.aborted) subscribe();
          }, SSE_RECONNECT_DELAY);
        }
      }
    }

    subscribe();

    return () => {
      abortController.abort();
      sseAbortRef.current = null;
      dismissReconnectToast();
    };
  }, [client, ready, queryClient, activeSessionIdRef]);

  // ── Track ready state ───────────────────────────────────────────────
  useEffect(() => {
    if (ready) hasBeenReady.current = true;
  }, [ready]);

  // ── Disconnect / reconnect toasts ───────────────────────────────────
  useEffect(() => {
    const label = serverStatusLabel(status);
    const prev = prevServerLabel.current;
    prevServerLabel.current = label;

    if (prev === "running" && label !== "running" && hasBeenReady.current) {
      toast.error("Disconnected from OpenCode", {
        description: "The server stopped unexpectedly.",
        duration: Number.POSITIVE_INFINITY,
      });
    }
    if (prev !== "running" && label === "running") {
      toast.dismiss();
    }
  }, [status]);

  const value: OpenCodeClientContextValue = {
    client,
    status,
    port,
    serverError,
    ready,
    initError,
  };

  return <OpenCodeClientContext.Provider value={value}>{children}</OpenCodeClientContext.Provider>;
}

// ── Init helper ─────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelay?: number } = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelay = 1000 } = opts;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, baseDelay * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError;
}

async function doInit(
  c: OpencodeClient,
  queryClient: QueryClient,
  generation: number,
  generationRef: React.RefObject<number>,
) {
  const { loadOwnSessionIds, loadSessionModels } = await import("@/lib/tauriStore");
  const { loadConfig } = await import("@/lib/config");
  const { qk } = await import("@/lib/queryKeys");

  await withRetry(async () => {
    if (generationRef.current !== generation) return;

    const [sessionRes, providerListRes, statusRes, agentsRes, authMethodsRes] = await Promise.all([
      c.session.list({}),
      c.provider.list({}),
      c.session.status({}),
      c.app.agents({}).catch(() => ({ data: undefined })),
      c.provider.auth({}).catch(() => ({ data: undefined })),
    ]);

    if (generationRef.current !== generation) return;

    // Sessions
    if (sessionRes.data) {
      const sorted = [...sessionRes.data].sort((a, b) => b.time.created - a.time.created);
      queryClient.setQueryData(qk.sessions, sorted);
    }

    // Session statuses
    if (statusRes.data) {
      queryClient.setQueryData(qk.statuses, statusRes.data);
    }

    // Agents
    if (agentsRes.data && Array.isArray(agentsRes.data)) {
      queryClient.setQueryData(qk.agents, agentsRes.data);
    }

    // Providers (we store the full response for the preferences provider to consume)
    let connectedProviders: string[] = [];
    let providerDefaults: Record<string, string> | undefined;
    if (providerListRes.data) {
      const { connected, default: defaults } = providerListRes.data;
      connectedProviders = connected;
      providerDefaults = defaults as Record<string, string> | undefined;
      queryClient.setQueryData(qk.providers, providerListRes.data);
    }

    // Auth methods  - stored within the providers query data as a convention,
    // but also available standalone
    if (authMethodsRes.data) {
      // We'll attach auth methods to the providers data via a merged object
      queryClient.setQueryData(qk.providers, (prev: unknown) => {
        if (prev && typeof prev === "object") {
          return { ...prev, authMethods: authMethodsRes.data };
        }
        return { authMethods: authMethodsRes.data };
      });
    }

    // Load persisted data
    const [ownIds, savedSessionModels, cfg] = await Promise.all([
      loadOwnSessionIds(),
      loadSessionModels(),
      loadConfig(),
    ]);
    if (generationRef.current !== generation) return;

    queryClient.setQueryData(qk.config, {
      hasLaunched: cfg.hasLaunched,
      lastModel: cfg.lastModel,
      hiddenModels: cfg.hiddenModels,
      ownSessionIds: ownIds,
      sessionModels: savedSessionModels,
      connectedProviders,
      providerDefaults,
    });
  });
}
