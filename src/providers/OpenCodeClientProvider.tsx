import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import LoadingScreen from "@/components/LoadingScreen";
import { loadConfig } from "@/lib/config";
import { getOpenCodePort, getWorkspaceDir } from "@/lib/env";
import { qk } from "@/lib/queryKeys";
import { sseDispatch } from "@/lib/sseDispatch";
import { loadSessionModels } from "@/lib/tauriStore";

const SSE_RECONNECT_DELAY = 3000;
const SSE_FAILURE_THRESHOLD = 3;

type AppStatus = "waiting" | "ready" | "error";

interface OpenCodeClientContextValue {
  client: OpencodeClient | null;
  status: AppStatus;
  port: number;
  ready: boolean;
  initError: string | null;
}

const initialPort = getOpenCodePort() ?? 0;
const initialClient = initialPort
  ? createOpencodeClient({
      baseUrl: `http://127.0.0.1:${initialPort}`,
      directory: getWorkspaceDir(),
    })
  : null;

export const OpenCodeClientContext = createContext<OpenCodeClientContextValue>({
  client: null,
  status: "waiting",
  port: 0,
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

  const [status, setStatus] = useState<AppStatus>(initialClient ? "waiting" : "error");
  const [port] = useState(initialPort);
  const [client] = useState<OpencodeClient | null>(initialClient);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(
    initialClient ? null : "No port provided — OpenCode may not have started.",
  );

  const sseAbortRef = useRef<AbortController | null>(null);

  // ── Fetch server state + load local preferences into the query cache ─
  useEffect(() => {
    if (!client || ready) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;

    const attempt = () => {
      fetchServerStateAndPreferences(client, queryClient)
        .then(() => {
          if (cancelled) return;
          setReady(true);
          setStatus("ready");
          setInitError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          console.error("Failed to fetch initial state, retrying in 3s:", err);
          setInitError(String(err));
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
          onClick: () => window.location.reload(),
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
        const sseResult = await client.event.subscribe({});
        if (!sseResult?.stream) {
          consecutiveFailures++;
          if (consecutiveFailures >= SSE_FAILURE_THRESHOLD) showReconnectToast();
          if (!abortController.signal.aborted) {
            setTimeout(() => {
              if (!abortController.signal.aborted) subscribe();
            }, SSE_RECONNECT_DELAY);
          }
          return;
        }
        consecutiveFailures = 0;
        dismissReconnectToast();

        for await (const event of sseResult.stream) {
          if (abortController.signal.aborted) break;
          sseDispatch(queryClient, event, activeSessionIdRef);
        }

        if (!abortController.signal.aborted) {
          consecutiveFailures++;
          if (consecutiveFailures >= SSE_FAILURE_THRESHOLD) showReconnectToast();
          setTimeout(() => {
            if (!abortController.signal.aborted) subscribe();
          }, SSE_RECONNECT_DELAY);
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
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

  const value: OpenCodeClientContextValue = {
    client,
    status,
    port,
    ready,
    initError,
  };

  if (!ready) {
    return (
      <OpenCodeClientContext.Provider value={value}>
        <LoadingScreen
          message={initError ? "Failed to connect to OpenCode" : "Starting up..."}
          detail={initError ?? undefined}
          error={!!initError}
          onRetry={initError ? () => window.location.reload() : undefined}
        />
      </OpenCodeClientContext.Provider>
    );
  }

  return <OpenCodeClientContext.Provider value={value}>{children}</OpenCodeClientContext.Provider>;
}

// ── Fetch all server state and local preferences into the query cache ──

async function fetchServerStateAndPreferences(client: OpencodeClient, queryClient: QueryClient) {
  const [sessionRes, providerRes, statusRes, agentsRes, authRes] = await Promise.all([
    client.session.list({}),
    client.provider.list({}),
    client.session.status({}),
    client.app.agents({}).catch(() => ({ data: undefined })),
    client.provider.auth({}).catch(() => ({ data: undefined })),
  ]);

  // Server state → query cache
  if (sessionRes.data) {
    const sorted = [...sessionRes.data].sort((a, b) => b.time.created - a.time.created);
    queryClient.setQueryData(qk.sessions, sorted);
  }

  if (statusRes.data) {
    queryClient.setQueryData(qk.statuses, statusRes.data);
  }

  if (agentsRes.data && Array.isArray(agentsRes.data)) {
    queryClient.setQueryData(qk.agents, agentsRes.data);
  }

  let connectedProviders: string[] = [];
  let providerDefaults: Record<string, string> | undefined;

  if (providerRes.data) {
    const providerData = authRes.data
      ? { ...providerRes.data, authMethods: authRes.data }
      : providerRes.data;
    queryClient.setQueryData(qk.providers, providerData);
    connectedProviders = providerRes.data.connected;
    providerDefaults = providerRes.data.default as Record<string, string> | undefined;
  }

  // Local preferences (localStorage) → query cache
  const cfg = loadConfig();
  queryClient.setQueryData(qk.config, {
    lastModel: cfg.lastModel,
    hiddenModels: cfg.hiddenModels,
    sessionModels: loadSessionModels(),
    connectedProviders,
    providerDefaults,
  });
}
