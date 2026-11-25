import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import posthog from "posthog-js/dist/module.full.no-external.js";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import LoadingScreen, { type StartupProgress } from "@/components/LoadingScreen";
import { aiTracer, captureDetailedAnalytics } from "@/lib/analytics";
import { loadConfig } from "@/lib/config";
import { desktop } from "@/lib/desktop";
import { createOpencodeClient, type OpencodeClient } from "@/lib/opencode";
import { qk } from "@/lib/queryKeys";
import { isVisibleSession } from "@/lib/sessionVisibility";
import { sseDispatch } from "@/lib/sseDispatch";
import type { OpenCodeStartupProgress } from "@/types/desktop";

export const SSE_RECONNECT_DELAY = 3_000;
export const SSE_FAILURE_THRESHOLD = 3;
export const SSE_HEARTBEAT_TIMEOUT = 30_000; // No events for 30s → probe server, reconnect only if it's dead
export const SSE_HEARTBEAT_INTERVAL = 5_000; // Check every 5s
export const SSE_POLL_INTERVAL = 1_000; // Server health-check poll interval
export const SSE_POLL_TIMEOUT = 3_000; // Per-poll request timeout
/** The engine can start and then never serve; don't leave the loading screen waiting forever. */
export const SERVER_WAIT_MS = 60_000;
export const SIDE_PANEL_EXIT_MS = 180; // Side panel exit animation duration

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
  /** A folder the person needs, such as one to exclude from antivirus scans. */
  detailPath?: string;
  technicalDetail: string;
}

/** The `(reason: …)` the desktop service adds when installing OpenCode fails. */
export function getInstallFailureReason(technicalDetail: string): string | null {
  return /\(reason: ([a-z_]+)\)/.exec(technicalDetail)?.[1] ?? null;
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

export function getStartupErrorPresentation(
  error: unknown,
  installFolder: string | null = null,
): StartupErrorPresentation {
  const technicalDetail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const normalized = technicalDetail.toLowerCase();
  const reason = getInstallFailureReason(technicalDetail);

  if (reason === "blocked_by_security") {
    return {
      message: "Setup couldn't finish",
      detail:
        "Windows security software blocked OpenCode, the engine BloxMind runs on. Allow BloxMind in your antivirus, or add its folder as an exclusion, then retry.",
      detailPath: installFolder ?? undefined,
      technicalDetail,
    };
  }

  if (reason === "disk_full") {
    return {
      message: "Setup couldn't finish",
      detail: "Your drive is nearly full. Free up at least 500 MB, then retry.",
      technicalDetail,
    };
  }

  if (reason === "database_locked") {
    return {
      message: "BloxMind couldn't start",
      detail:
        "Another copy of BloxMind is still open and using your chats. Close it, or restart your computer, then try again.",
      technicalDetail,
    };
  }

  if (reason === "database_io") {
    return {
      message: "BloxMind couldn't start",
      detail:
        "BloxMind couldn't open your saved chats. Check that your computer has free space, then restart it and try again. If it keeps happening, your antivirus may be blocking the BloxMind folder.",
      detailPath: installFolder ?? undefined,
      technicalDetail,
    };
  }

  if (reason === "folder_blocked") {
    const windows =
      typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("windows");
    return {
      message: "BloxMind couldn't start",
      // Neither OneDrive nor Controlled folder access covers the user folder
      // itself unless someone set them up to, so the usual cause is security
      // software or a school or work policy.
      detail: windows
        ? "Something on this computer stopped BloxMind from saving files in the BloxMind folder in your user folder. That's usually antivirus, or a setting from your school or workplace. Allow BloxMind in your antivirus, or ask whoever looks after this computer, then try again."
        : "BloxMind isn't allowed to save files in the BloxMind folder in your home folder. Make sure your account can change that folder, then try again.",
      detailPath: installFolder ?? undefined,
      technicalDetail,
    };
  }

  if (reason === "other") {
    return {
      message: "Setup couldn't finish",
      detail:
        "BloxMind couldn't set up OpenCode, the engine it runs on. Restart setup, and if it keeps failing, copy the technical details and send them to us.",
      technicalDetail,
    };
  }

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

interface OpenCodeClientContextValue {
  client: OpencodeClient | null;
  status: AppStatus;
  port: number;
  ready: boolean;
  initError: string | null;
}

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
  const [installFolder, setInstallFolder] = useState<string | null>(null);

  const sseAbortRef = useRef<AbortController | null>(null);

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

    // Step 2: Poll the HTTP server until it responds.
    async function waitForServer(baseUrl: string, authorization: string): Promise<void> {
      const deadline = Date.now() + SERVER_WAIT_MS;
      while (!cancelled) {
        if (Date.now() > deadline) {
          throw new Error(
            `BloxMind's engine did not become healthy within ${SERVER_WAIT_MS / 1000} seconds after it started`,
          );
        }
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
      throw new Error("cancelled");
    }

    async function init() {
      try {
        setStatus("waiting");
        setInitError(null);
        setStartupPhase("engine");
        setEngineProgress(DEFAULT_ENGINE_PROGRESS);
        const { port: ocPort, workspace, authorization } = await getServerInfo();
        if (cancelled) return;

        setStartupPhase("connection");
        const baseUrl = `http://127.0.0.1:${ocPort}`;
        await waitForServer(baseUrl, authorization);
        if (cancelled) return;

        const newClient = createOpencodeClient({
          baseUrl,
          directory: workspace,
          headers: { Authorization: authorization },
        });
        setStartupPhase("workspace");
        await prefetchServerState(newClient, queryClient);
        if (cancelled) return;

        setPort(ocPort);
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

  // AI traces read session history and tool definitions from the local server.
  useEffect(() => {
    if (!client) return;
    aiTracer.configure({
      loadHistory: async (sessionID) =>
        (await client.session.messages({ sessionID }, { throwOnError: true })).data,
      loadTools: async (provider, model) =>
        (await client.tool.list({ provider, model }, { throwOnError: true })).data,
      loadInstructions: async () => {
        // The engine runs with project-config isolation, so only the engine-global
        // AGENTS.md is actually in effect. Don't snapshot ~/.claude/CLAUDE.md or
        // ancestor project files — users didn't opt in to sharing personal files.
        const content = await desktop.getInstructions();
        if (!content.trim()) return [];
        return [
          {
            path: "(engine-global AGENTS.md)",
            scope: "global" as const,
            chars: content.length,
            content,
          },
        ];
      },
    });
    return () => aiTracer.configure({});
  }, [client]);

  // ── SSE subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (!client || !ready) return;

    const abortController = new AbortController();
    sseAbortRef.current = abortController;
    let consecutiveFailures = 0;
    let reconnectToastId: string | number | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let lastEventTime = Date.now();
    let streamAbortController: AbortController | null = null;

    function showReconnectToast() {
      if (reconnectToastId != null) return;
      reconnectToastId = toast.error("Lost connection to OpenCode", {
        description: "Events are no longer being received.",
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Reconnect",
          onClick: () => {
            // A reload only reaches a living engine; a dead one needs an app relaunch.
            desktop.getOpenCodeInfo().then(
              () => window.location.reload(),
              () => {
                desktop.relaunch().catch(() => window.location.reload());
              },
            );
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
      const backoff = Math.min(sseReconnectDelay * 2 ** Math.min(consecutiveFailures, 5), 30_000);
      const delay = consecutiveFailures === 0 ? sseReconnectDelay : backoff;
      reconnectTimer = setTimeout(() => {
        if (!abortController.signal.aborted) void subscribe();
      }, delay);
    }

    // Heartbeat: the server does not emit periodic keep-alive events — it is
    // silent whenever the session is idle, and a half-open/dead TCP connection
    // can look "fine" forever from the client's side. So when the watchdog trips
    // we probe the server first. Alive → resubscribe anyway (a silent refresh of
    // the stream, cheap, and the only way a dead-but-quiet connection recovers),
    // but never count it as a failure or show the toast. Dead → failure + abort +
    // backoff reconnect, and only then the toast.
    let probeInFlight = false;
    async function probeServer(): Promise<boolean> {
      if (!client) return false;
      try {
        await client.session.status({}, { throwOnError: true });
        return true;
      } catch {
        return false;
      }
    }

    function startHeartbeat() {
      clearInterval(heartbeatTimer);
      lastEventTime = Date.now();
      heartbeatTimer = setInterval(() => {
        if (abortController.signal.aborted) return;
        const elapsed = Date.now() - lastEventTime;
        if (elapsed < sseHeartbeatTimeout || probeInFlight) return;
        probeInFlight = true;
        void probeServer().then((alive) => {
          probeInFlight = false;
          if (abortController.signal.aborted) return;
          if (alive) {
            // Server reachable: refresh the stream quietly. Do not count a
            // failure — an idle session is not an error.
            lastEventTime = Date.now();
            streamAbortController?.abort();
            scheduleReconnect();
            return;
          }
          console.warn(
            `SSE heartbeat timeout: no events for ${elapsed}ms and server probe failed, forcing reconnect`,
          );
          consecutiveFailures++;
          if (consecutiveFailures >= SSE_FAILURE_THRESHOLD) showReconnectToast();
          // Abort the current stream so the for-await loop breaks.
          // The outer abortController stays alive so scheduleReconnect can still fire.
          streamAbortController?.abort();
          scheduleReconnect();
        });
      }, SSE_HEARTBEAT_INTERVAL);
    }

    function stopHeartbeat() {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }

    async function subscribe() {
      // A stream is already active. The reconnect timer must not start a
      // second, overlapping loop; the active loop reschedules on exit. But an
      // ABORTED controller is stale — the aborted for-await may never wake up
      // to clear it, which would make every reconnect a no-op and leave the
      // feed frozen forever. A fresh stream must be allowed to take over.
      if (streamAbortController && !streamAbortController.signal.aborted) return;
      if (!client) return;
      // A fresh per-stream abort controller lets the heartbeat kill a stuck
      // stream without killing the outer reconnect loop. Passing its signal
      // to the SDK is what actually unblocks a dead connection: without it
      // the for-await loop could hang forever and every heartbeat tick would
      // pile another subscribe loop on top of the stuck one.
      const streamController = new AbortController();
      streamAbortController = streamController;
      try {
        const sseResult = await client.event.subscribe(
          {},
          { throwOnError: true, signal: streamController.signal },
        );
        if (streamAbortController !== streamController) return;
        if (!sseResult?.stream) {
          consecutiveFailures++;
          if (consecutiveFailures >= SSE_FAILURE_THRESHOLD) showReconnectToast();
          if (!abortController.signal.aborted) scheduleReconnect();
          return;
        }
        await reconcileServerState(queryClient, activeSessionIdRef.current);
        if (streamAbortController !== streamController) return;
        consecutiveFailures = 0;
        dismissReconnectToast();
        startHeartbeat();

        for await (const event of sseResult.stream) {
          if (abortController.signal.aborted || streamController.signal.aborted) break;
          lastEventTime = Date.now();
          sseDispatch(queryClient, event, activeSessionIdRef, (usage) => {
            captureDetailedAnalytics(posthog, "model_usage", usage);
          });
          try {
            aiTracer.handleEvent(event);
          } catch (error) {
            console.warn("AI trace capture failed:", error);
          }
        }

        // The stream ended on its own (server or network closed it). A
        // deliberate abort — unmount (outer controller) or heartbeat (stream
        // controller) — is already handled by whoever aborted it, so only the
        // surprise case counts a failure and reschedules.
        if (!abortController.signal.aborted && !streamController.signal.aborted) {
          consecutiveFailures++;
          if (consecutiveFailures >= SSE_FAILURE_THRESHOLD) showReconnectToast();
          scheduleReconnect();
        }
      } catch (err) {
        if (!abortController.signal.aborted && !streamController.signal.aborted) {
          console.error("SSE stream error:", err);
          consecutiveFailures++;
          if (consecutiveFailures >= SSE_FAILURE_THRESHOLD) showReconnectToast();
          scheduleReconnect();
        }
      } finally {
        // Only tear down the shared heartbeat when this loop still owns the
        // current stream; a stale loop must not kill a newer one's stream.
        if (streamAbortController === streamController) {
          stopHeartbeat();
          streamAbortController = null;
        }
      }
    }

    subscribe();

    return () => {
      abortController.abort();
      streamAbortController?.abort();
      clearTimeout(reconnectTimer);
      stopHeartbeat();
      sseAbortRef.current = null;
      dismissReconnectToast();
    };
  }, [client, ready, queryClient, activeSessionIdRef, sseReconnectDelay, sseHeartbeatTimeout]);

  // Shown on screen only, so antivirus exclusions can target it. Never sent to analytics.
  useEffect(() => {
    if (!initError || getInstallFailureReason(initError) !== "blocked_by_security") return;
    let cancelled = false;
    desktop
      .getOpenCodeInstallFolder()
      .then((folder) => {
        if (!cancelled) setInstallFolder(folder);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initError]);

  const value = useMemo<OpenCodeClientContextValue>(
    () => ({ client, status, port, ready, initError }),
    [client, status, port, ready, initError],
  );

  if (!ready) {
    const startup = getStartupPresentation(startupPhase, engineProgress);
    const startupError = initError ? getStartupErrorPresentation(initError, installFolder) : null;
    return (
      <OpenCodeClientContext.Provider value={value}>
        <LoadingScreen
          message={startupError?.message ?? startup.message}
          detail={startupError?.detail ?? startup.detail}
          detailPath={startupError?.detailPath}
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
    // OC2 `archived: true` filters to archived sessions only; omit to list all.
    client.experimental.session.list({}, { throwOnError: true }),
    client.provider.list({}, { throwOnError: true }),
    client.session.status({}, { throwOnError: true }),
    client.app.agents({}, { throwOnError: true }),
    client.provider.auth({}, { throwOnError: true }),
  ]);
  if (results.every((result) => result.status === "rejected")) {
    throw new Error("OpenCode server state is unavailable");
  }
  const [sessionResult, providerResult, statusResult, agentsResult, authResult] = results;
  const sessionRes = sessionResult.status === "fulfilled" ? sessionResult.value : undefined;
  const providerRes = providerResult.status === "fulfilled" ? providerResult.value : undefined;
  const statusRes = statusResult.status === "fulfilled" ? statusResult.value : undefined;
  const agentsRes = agentsResult.status === "fulfilled" ? agentsResult.value : undefined;
  const authRes = authResult.status === "fulfilled" ? authResult.value : undefined;

  if (sessionRes?.data) {
    const sorted = (sessionRes.data as Array<{ id: string; time: { created: number } }>)
      .filter(isVisibleSession as (s: unknown) => boolean)
      .sort((a, b) => b.time.created - a.time.created) as unknown as typeof sessionRes.data;
    queryClient.setQueryData(qk.sessions, sorted);
  }

  if (statusRes?.data) {
    queryClient.setQueryData(qk.statuses, statusRes.data);
  }

  if (agentsRes?.data && Array.isArray(agentsRes.data)) {
    queryClient.setQueryData(
      qk.agents,
      (agentsRes.data as Array<Record<string, unknown>>).map((agent) => ({
        ...agent,
        id: typeof agent.id === "string" ? agent.id : agent.name,
      })),
    );
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
