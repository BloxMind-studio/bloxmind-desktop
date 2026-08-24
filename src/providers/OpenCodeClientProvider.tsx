import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import posthog from "posthog-js/dist/module.full.no-external.js";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import LoadingScreen, { type StartupProgress } from "@/components/LoadingScreen";
import { captureDetailedAnalytics } from "@/lib/analytics";
import { resolveDesktopEndpoint } from "@/lib/apiConfig";
import { loadConfig } from "@/lib/config";
import { desktop } from "@/lib/desktop";
import { qk } from "@/lib/queryKeys";
import { sseDispatch } from "@/lib/sseDispatch";
import type { OpenCodeStartupProgress } from "@/types/desktop";

export const SSE_RECONNECT_DELAY = 3_000;
export const SSE_FAILURE_THRESHOLD = 3;
export const SSE_HEARTBEAT_TIMEOUT = 30_000; // No events for 30s → force reconnect
export const SSE_HEARTBEAT_INTERVAL = 5_000; // Check every 5s
export const SSE_POLL_INTERVAL = 1_000; // Server health-check poll interval
export const SSE_POLL_TIMEOUT = 3_000; // Per-poll request timeout
export const SSE_MAX_RECONNECT_ATTEMPTS = 10; // Stop retrying after this many consecutive failures
export const SSE_STARTUP_POLL_TIMEOUT = 60_000; // Max time to wait for server during startup
export const SIDE_PANEL_EXIT_MS = 180; // Side panel exit animation duration
export const TOOLTIP_DURATION_MS = 2_500; // Project index tooltip display duration

type AppStatus = "waiting" | "ready" | "error";
export type StartupPhase = "engine" | "connection" | "workspace";

interface StartupPresentation {
  message: string;
  detail: string;
  startup: StartupProgress;
}

interface StartupErrorPresentation {
  message: string;
  detail: string;
  technicalDetail: string;
}

const DEFAULT_ENGINE_PROGRESS: OpenCodeStartupProgress = { phase: "checking" };

const STARTUP_COPY: Record<Exclude<StartupPhase, "engine">, StartupPresentation> = {
  connection: {
    message: "Connecting the dots",
    detail: "Making sure everything can talk",
    startup: { step: 2, label: "Connecting" },
  },
  workspace: {
    message: "Setting the stage",
    detail: "Loading your workspace and preferences",
    startup: { step: 3, label: "Opening" },
  },
};

export function formatTransferSpeed(bytesPerSecond: number): string {
  const speed = Number.isFinite(bytesPerSecond) ? Math.max(0, bytesPerSecond) : 0;
  if (speed < 1024) return `${Math.round(speed)} B/s`;
  if (speed < 1024 ** 2) return `${(speed / 1024).toFixed(1)} KB/s`;
  return `${(speed / 1024 ** 2).toFixed(1)} MB/s`;
}

function getEnginePresentation(progress: OpenCodeStartupProgress): StartupPresentation {
  if (progress.phase === "downloading") {
    const fraction =
      progress.totalBytes && progress.totalBytes > 0
        ? Math.min(progress.downloadedBytes / progress.totalBytes, 1)
        : undefined;
    const percentage = fraction === undefined ? null : `${Math.round(fraction * 100)}%`;
    return {
      message: "Downloading a one-time setup",
      detail: "Future launches will use the saved copy",
      startup: {
        step: 1,
        label: "Preparing",
        progress: fraction,
        meta: [percentage, formatTransferSpeed(progress.bytesPerSecond)]
          .filter(Boolean)
          .join(" · "),
      },
    };
  }

  if (progress.phase === "verifying") {
    return {
      message: "Checking the download",
      detail: "Making sure everything arrived safely",
      startup: { step: 1, label: "Preparing", progress: 1 },
    };
  }

  if (progress.phase === "installing") {
    return {
      message: "Finishing setup",
      detail: "Unpacking the local engine",
      startup: { step: 1, label: "Preparing", progress: 1 },
    };
  }

  if (progress.phase === "starting") {
    return {
      message: "Starting your workspace",
      detail: "Launching the local engine",
      startup: { step: 1, label: "Preparing", progress: 1 },
    };
  }

  return {
    message: "Getting things ready",
    detail: "Checking what this computer needs",
    startup: { step: 1, label: "Preparing" },
  };
}

export function getStartupPresentation(
  phase: StartupPhase,
  engineProgress: OpenCodeStartupProgress = DEFAULT_ENGINE_PROGRESS,
): StartupPresentation {
  return phase === "engine" ? getEnginePresentation(engineProgress) : STARTUP_COPY[phase];
}

export function getStartupErrorPresentation(error: unknown): StartupErrorPresentation {
  const technicalDetail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const normalized = technicalDetail.toLowerCase();

  if (
    normalized.includes("github release lookup") ||
    normalized.includes("opencode download") ||
    normalized.includes("verified opencode")
  ) {
    return {
      message: "Setup couldn't finish",
      detail:
        "BloxMind couldn't download its setup files. Check your internet connection, VPN, or firewall, then restart setup.",
      technicalDetail,
    };
  }

  if (normalized.includes("does not provide a supported binary")) {
    return {
      message: "This computer isn't supported yet",
      detail:
        "BloxMind couldn't find a compatible setup package for this system. Check for an app update or contact support.",
      technicalDetail,
    };
  }

  return {
    message: "Setup couldn't finish",
    detail:
      "BloxMind hit a problem while preparing its local engine. Restart setup, or check for an app update if it happens again.",
    technicalDetail,
  };
}

export interface OpenCodeClientContextValue {
  client: OpencodeClient | null;
  status: AppStatus;
  port: number;
  ready: boolean;
  initError: string | null;
  sseConnected: boolean;
  sseFailureCount: number;
}

export const OpenCodeClientContext = createContext<OpenCodeClientContextValue>({
  client: null,
  status: "waiting",
  port: 0,
  ready: false,
  initError: null,
  sseConnected: false,
  sseFailureCount: 0,
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
  const { data: configData } = useQuery({
    queryKey: qk.config,
    queryFn: loadConfig,
  });
  const sseReconnectDelay = configData?.sseReconnectDelay ?? SSE_RECONNECT_DELAY;
  const sseHeartbeatTimeout = configData?.sseHeartbeatTimeout ?? SSE_HEARTBEAT_TIMEOUT;

  const [status, setStatus] = useState<AppStatus>("waiting");
  const [startupPhase, setStartupPhase] = useState<StartupPhase>("engine");
  const [engineProgress, setEngineProgress] =
    useState<OpenCodeStartupProgress>(DEFAULT_ENGINE_PROGRESS);
  const [port, setPort] = useState(0);
  const [client, setClient] = useState<OpencodeClient | null>(null);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [sseFailureCount, setSseFailureCount] = useState(0);

  // Get port from Electron, wait for the server, then create the client.
  useEffect(() => {
    if (ready) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;
    const unsubscribeProgress = desktop.onOpenCodeStartupProgress((progress) => {
      if (!cancelled) setEngineProgress(progress);
    });

    // The desktop service owns startup, its deadline, and process cleanup.
    async function getServerInfo() {
      return desktop.getOpenCodeInfo();
    }

    // Step 2: Poll the HTTP server until it responds (bounded timeout).
    async function waitForServer(baseUrl: string, authorization: string): Promise<void> {
      const deadline = Date.now() + SSE_STARTUP_POLL_TIMEOUT;
      while (!cancelled && Date.now() < deadline) {
        try {
          const res = await fetch(`${baseUrl}/session`, {
            headers: { Authorization: authorization },
            method: "GET",
            signal: AbortSignal.timeout(SSE_POLL_TIMEOUT),
          });
          if (res.ok || res.status >= 400) return;
        } catch {
          // Connection refused or timeout - keep polling.
        }
        await new Promise((r) => {
          retryTimer = setTimeout(r, SSE_POLL_INTERVAL);
        });
      }
      if (cancelled) throw new Error("cancelled");
      throw new Error(`Server did not respond within ${SSE_STARTUP_POLL_TIMEOUT / 1000}s`);
    }

    async function init() {
      try {
        setStatus("waiting");
        setInitError(null);
        setStartupPhase("engine");
        setEngineProgress(DEFAULT_ENGINE_PROGRESS);
        const info = await getServerInfo();
        if (cancelled) return;

        // Resolve the active engine endpoint: a hosted Core Engine
        // (NEXT_PUBLIC_CORE_API_URL) when configured, otherwise the local
        // OpenCode engine spawned by the Electron main process.
        const endpoint = resolveDesktopEndpoint(info);

        setStartupPhase("connection");
        // Only poll a local engine for readiness. A hosted Cloud Backend is
        // assumed reachable and connection errors surface through the client
        // during prefetch below.
        if (!endpoint.isCloud) {
          await waitForServer(endpoint.baseUrl, info.authorization);
          if (cancelled) return;
        }

        const headers = endpoint.authorization
          ? { Authorization: endpoint.authorization }
          : undefined;
        const newClient = createOpencodeClient({
          baseUrl: endpoint.baseUrl,
          directory: info.workspace,
          headers,
        });
        setStartupPhase("workspace");
        await prefetchServerState(newClient, queryClient);
        if (cancelled) return;

        setPort(info.port);
        setClient(newClient);
        setReady(true);
        setStatus("ready");
        setInitError(null);
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to initialize OpenCode:", err);
        setStatus("error");
        setInitError(String(err));
      }
    }

    init();

    return () => {
      cancelled = true;
      unsubscribeProgress();
      clearTimeout(retryTimer);
    };
  }, [ready, queryClient]);

  // ── SSE subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (!client || !ready) return;

    const abortController = new AbortController();
    let consecutiveFailures = 0;
    let reconnectToastId: string | number | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let lastEventTime = Date.now();
    let streamAbortController: AbortController | null = null;
    let permanentlyDisconnected = false;

    const bumpFailures = () => {
      consecutiveFailures += 1;
      setSseFailureCount(consecutiveFailures);
    };
    const resetFailures = () => {
      consecutiveFailures = 0;
      permanentlyDisconnected = false;
      setSseFailureCount(0);
    };

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

    function showPermanentlyDisconnectedToast() {
      if (reconnectToastId != null) return;
      reconnectToastId = toast.error("Connection lost", {
        description: `Couldn't reconnect after ${SSE_MAX_RECONNECT_ATTEMPTS} attempts.`,
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Try again",
          onClick: () => {
            resetFailures();
            permanentlyDisconnected = false;
            dismissReconnectToast();
            scheduleReconnect();
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

    function scheduleReconnect() {
      clearTimeout(reconnectTimer);
      if (consecutiveFailures >= SSE_MAX_RECONNECT_ATTEMPTS) {
        permanentlyDisconnected = true;
        showPermanentlyDisconnectedToast();
        return;
      }
      const backoff = Math.min(sseReconnectDelay * 2 ** Math.min(consecutiveFailures, 5), 30_000);
      const delay = consecutiveFailures === 0 ? sseReconnectDelay : backoff;
      reconnectTimer = setTimeout(() => {
        if (!abortController.signal.aborted && !permanentlyDisconnected) void subscribe();
      }, delay);
    }

    // Heartbeat: if no SSE events arrive for SSE_HEARTBEAT_TIMEOUT,
    // the connection is likely dead (e.g. network dropped). Force a reconnect.
    function startHeartbeat() {
      clearInterval(heartbeatTimer);
      lastEventTime = Date.now();
      heartbeatTimer = setInterval(() => {
        if (abortController.signal.aborted) return;
        const elapsed = Date.now() - lastEventTime;
        if (elapsed >= sseHeartbeatTimeout) {
          console.debug(`SSE heartbeat timeout: no events for ${elapsed}ms, forcing reconnect`);
          bumpFailures();
          if (consecutiveFailures >= SSE_FAILURE_THRESHOLD) showReconnectToast();
          // Abort the current stream so the for-await loop breaks.
          // The outer abortController stays alive so scheduleReconnect can still fire.
          streamAbortController?.abort();
          scheduleReconnect();
        }
      }, SSE_HEARTBEAT_INTERVAL);
    }

    function stopHeartbeat() {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }

    async function subscribe() {
      try {
        if (!client) return;
        // Create a fresh per-stream abort controller so the heartbeat can
        // kill a stuck stream without killing the outer reconnect loop.
        streamAbortController = new AbortController();
        const sseResult = await client.event.subscribe({}, { throwOnError: true });
        if (!sseResult?.stream) {
          bumpFailures();
          if (consecutiveFailures >= SSE_FAILURE_THRESHOLD) showReconnectToast();
          if (!abortController.signal.aborted) scheduleReconnect();
          return;
        }
        await reconcileServerState(queryClient, activeSessionIdRef.current);
        resetFailures();
        setSseConnected(true);
        dismissReconnectToast();
        startHeartbeat();

        for await (const event of sseResult.stream) {
          if (abortController.signal.aborted || streamAbortController.signal.aborted) break;
          lastEventTime = Date.now();
          sseDispatch(queryClient, event, activeSessionIdRef, (usage) => {
            captureDetailedAnalytics(posthog, "model_usage", usage);
          });
        }

        stopHeartbeat();
        streamAbortController = null;
        setSseConnected(false);

        if (!abortController.signal.aborted) {
          bumpFailures();
          if (consecutiveFailures >= SSE_FAILURE_THRESHOLD) showReconnectToast();
          scheduleReconnect();
        }
      } catch (err) {
        stopHeartbeat();
        streamAbortController = null;
        setSseConnected(false);
        if (!abortController.signal.aborted) {
          console.debug("SSE stream error, reconnecting automatically:", err);
          bumpFailures();
          if (consecutiveFailures >= SSE_FAILURE_THRESHOLD) showReconnectToast();
          scheduleReconnect();
        }
      }
    }

    subscribe();

    return () => {
      setSseConnected(false);
      abortController.abort();
      streamAbortController?.abort();
      clearTimeout(reconnectTimer);
      stopHeartbeat();
      dismissReconnectToast();
    };
  }, [client, ready, queryClient, activeSessionIdRef, sseReconnectDelay, sseHeartbeatTimeout]);

  // ── Crash recovery on app load: if persisted status is stuck in
  // "thinking"/"generating"/"busy", reset to idle/interrupted so the UI never
  // stays locked. This covers the case where the app was killed mid-generation.
  useEffect(() => {
    if (!ready || !client) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      const statuses = queryClient.getQueryData<Record<string, { type: string }>>(qk.statuses);
      if (!statuses) return;
      let hasStuck = false;
      const next: Record<string, { type: string }> = { ...statuses };
      for (const [id, st] of Object.entries(statuses)) {
        if (st.type !== "idle") {
          hasStuck = true;
          next[id] = { type: "idle" };
          try {
            localStorage.setItem(`BloxMind:interrupted:${id}`, String(Date.now()));
          } catch {
            // ignore
          }
          void client.session.abort({ sessionID: id } as never).catch(() => undefined);
        }
      }
      if (hasStuck && !cancelled) {
        queryClient.setQueryData(qk.statuses, next);
      }
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, client, queryClient]);

  const value = useMemo<OpenCodeClientContextValue>(
    () => ({ client, status, port, ready, initError, sseConnected, sseFailureCount }),
    [client, status, port, ready, initError, sseConnected, sseFailureCount],
  );

  if (!ready) {
    const startup = getStartupPresentation(startupPhase, engineProgress);
    const startupError = initError ? getStartupErrorPresentation(initError) : null;
    return (
      <OpenCodeClientContext.Provider value={value}>
        <LoadingScreen
          message={startupError?.message ?? startup.message}
          detail={startupError?.detail ?? startup.detail}
          technicalDetail={startupError?.technicalDetail}
          startup={startupError ? undefined : startup.startup}
          error={!!startupError}
          onRetry={startupError ? () => desktop.relaunch() : undefined}
        />
      </OpenCodeClientContext.Provider>
    );
  }

  return <OpenCodeClientContext.Provider value={value}>{children}</OpenCodeClientContext.Provider>;
}

// ── Pre-warm query cache with server state ──
// Hooks have their own queryFn as fallback, but seeding the cache here
// avoids extra round-trips on first render.

export async function prefetchServerState(client: OpencodeClient, queryClient: QueryClient) {
  const results = await Promise.allSettled([
    client.provider.list({}, { throwOnError: true }),
    client.session.status({}, { throwOnError: true }),
    client.app.agents({}, { throwOnError: true }),
    client.provider.auth({}, { throwOnError: true }),
  ]);

  const failures = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => {
      const cause = r.reason as { cause?: { status?: number }; message?: string } | undefined;
      const status = cause?.cause?.status;
      return status ? `HTTP ${status}` : String(cause?.message ?? r.reason);
    });

  if (results.every((result) => result.status === "rejected")) {
    throw new Error(
      `OpenCode server state is unavailable. ${failures.length}/${results.length} requests failed: ${failures.join(", ")}`,
    );
  }

  const [providerResult, statusResult, agentsResult, authResult] = results;
  const providerRes = providerResult.status === "fulfilled" ? providerResult.value : undefined;
  const statusRes = statusResult.status === "fulfilled" ? statusResult.value : undefined;
  const agentsRes = agentsResult.status === "fulfilled" ? agentsResult.value : undefined;
  const authRes = authResult.status === "fulfilled" ? authResult.value : undefined;

  if (statusRes?.data) {
    // ── Crash recovery: if the app was killed while the agent was
    // "thinking"/"generating" (busy/retry), the server may still report that
    // status on the next launch. Reset any non-idle entries to idle so the UI
    // never stays stuck, and mark them as interrupted so the Continue button
    // can appear.
    const raw = statusRes.data as Record<string, { type: string }>;
    const hasStuck = Object.values(raw).some((s) => s.type !== "idle");
    if (hasStuck) {
      const cleaned: Record<string, { type: string }> = {};
      for (const [id, st] of Object.entries(raw)) {
        if (st.type !== "idle") {
          cleaned[id] = { type: "idle" };
          try {
            localStorage.setItem(`BloxMind:interrupted:${id}`, String(Date.now()));
          } catch {
            // ignore
          }
        } else {
          cleaned[id] = st;
        }
      }
      queryClient.setQueryData(qk.statuses, cleaned);
      // Best-effort: also ask the server to abort the stuck sessions so its
      // MCP loops are killed, not just the UI state.
      for (const [id, st] of Object.entries(raw)) {
        if (st.type !== "idle") {
          void client.session.abort({ sessionID: id } as never).catch(() => undefined);
        }
      }
    } else {
      queryClient.setQueryData(qk.statuses, statusRes.data);
    }
  }

  if (agentsRes?.data && Array.isArray(agentsRes.data)) {
    queryClient.setQueryData(qk.agents, agentsRes.data);
  }

  if (providerRes?.data) {
    const providerData = authRes?.data
      ? { ...providerRes.data, authMethods: authRes.data }
      : providerRes.data;
    queryClient.setQueryData(qk.providers, providerData);
  }
}

export async function reconcileServerState(
  queryClient: QueryClient,
  activeSessionId: string | null,
) {
  const queryKeys: readonly (readonly unknown[])[] = [
    qk.sessions,
    qk.statuses,
    qk.providers,
    qk.agents,
    ...(activeSessionId
      ? [
          qk.messages(activeSessionId),
          qk.todos(activeSessionId),
          qk.questions(activeSessionId),
          qk.permissions(activeSessionId),
        ]
      : []),
  ];

  await Promise.all(
    queryKeys.map((queryKey) =>
      queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "active" }),
    ),
  );
}
