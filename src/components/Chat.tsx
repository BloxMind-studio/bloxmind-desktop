import { Box, Boxes, FolderTree, Map as MapIcon, Play, Swords } from "lucide-react";
import posthog from "posthog-js/dist/module.full.no-external.js";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AnimationPanel from "@/components/AnimationPanel";
import { BloxMindLogo } from "@/components/BloxMindLogo";
import ChatInput from "@/components/ChatInput";
import ChatMessages from "@/components/ChatMessages";
import ChatSidebar from "@/components/ChatSidebar";
import { ReconnectBanner } from "@/components/chat/ReconnectBanner";
import Explorer from "@/components/Explorer";
import LoadingScreen from "@/components/LoadingScreen";
import MapPanel from "@/components/MapPanel";
import MeshPanel from "@/components/MeshPanel";
import PlaytestPanel from "@/components/PlaytestPanel";
import StudioSetup from "@/components/StudioSetup";
import StudioTargetPicker from "@/components/StudioTargetPicker";
import { useCreateSession } from "@/hooks/mutations/useCreateSession";
import { useSessionStatus } from "@/hooks/useSessionStatuses";
import { useSessions } from "@/hooks/useSessions";
import { useStudioConnection } from "@/hooks/useStudioConnection";
import { analyticsProperties, POSTHOG_PROJECT_TOKEN } from "@/lib/analytics";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import {
  SIDE_PANEL_EXIT_MS,
  TOOLTIP_DURATION_MS,
  useOpenCodeClient,
} from "@/providers/OpenCodeClientProvider";
import { useUIPreferences } from "@/providers/PreferencesProvider";
import { useProjectIndexContext } from "@/providers/ProjectIndexProvider";
import { useStudioTargetOptional } from "@/providers/StudioTargetProvider";

const Settings = lazy(() => import("@/components/Settings"));

type ActiveTab = "explorer" | "animation" | "map" | "mesh" | "play" | "skills" | null;

/**
 * Compact button that shows the project index state and triggers a re-index.
 * Placed next to the Explorer/Playtest buttons in the header toolbar.
 */
function ProjectIndexButton() {
  const { skeleton, isLoading, error, refresh } = useProjectIndexContext();
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout>>();

  const indexed = skeleton !== null;
  const scriptCount = skeleton?.totalScripts ?? 0;
  const moduleCount = skeleton?.totalModuleScripts ?? 0;
  const circularCount = skeleton?.circularDependencies.length ?? 0;
  const hubCount = skeleton?.modules.filter((m) => m.dependentsCount >= 3).length ?? 0;

  const handleClick = useCallback(() => {
    refresh();
    setShowTooltip(true);
    clearTimeout(tooltipTimer.current);
    tooltipTimer.current = setTimeout(() => setShowTooltip(false), TOOLTIP_DURATION_MS);
  }, [refresh]);

  useEffect(() => () => clearTimeout(tooltipTimer.current), []);

  const summary = `${scriptCount} scripts · ${moduleCount} modules${circularCount > 0 ? ` · ${circularCount} cycles` : ""}`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        aria-label={indexed ? summary : "Index project structure"}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground transition-colors hover:bg-hover/12 disabled:opacity-50"
        title={indexed ? summary : (error ?? "Index project structure")}
      >
        <div className="relative">
          <FolderTree aria-hidden="true" size={13} />
          {indexed && (
            <span
              className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${circularCount > 0 ? "bg-amber-500" : "bg-emerald-500"}`}
            />
          )}
          {isLoading && (
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 animate-ping rounded-full bg-amber-400" />
          )}
        </div>
      </button>

      {showTooltip && indexed && (
        <div className="animate-fade-in-up absolute right-0 top-9 z-50 whitespace-nowrap rounded-md border bg-popover px-3 py-1.5 text-[11px] text-popover-foreground shadow-lg">
          Indexed: {scriptCount} scripts · {moduleCount} modules
          {hubCount > 0 && ` · ${hubCount} hubs`}
          {circularCount > 0 && ` · ${circularCount} cycles`}
        </div>
      )}
      {showTooltip && !indexed && !isLoading && !error && (
        <div className="animate-fade-in-up absolute right-0 top-9 z-50 whitespace-nowrap rounded-md border bg-popover px-3 py-1.5 text-[11px] text-popover-foreground shadow-lg">
          No scripts found
        </div>
      )}
    </div>
  );
}

function Chat() {
  const { ready, initError, sseConnected, sseFailureCount } = useOpenCodeClient();
  const { activeSessionId, clearSession } = useActiveSession();
  const sessionStatus = useSessionStatus(activeSessionId);
  const isBusy = sessionStatus !== undefined && sessionStatus.type !== "idle";
  const createSession = useCreateSession();
  const { data: allSessions } = useSessions();
  const studioConnection = useStudioConnection();
  const studioTarget = useStudioTargetOptional();
  const hasStudioTarget = studioTarget?.selected !== null && studioTarget?.status === "ready";

  // Get active session title from the sessions list
  const activeSessionTitle = allSessions?.find((s) => s.id === activeSessionId)?.title ?? null;

  const { sidebarCollapsed, setSidebarCollapsed, explorerCollapsed, setExplorerCollapsed } =
    useUIPreferences();
  const [showSettings, setShowSettings] = useState(false);
  const [showStudioSetup, setShowStudioSetup] = useState(false);
  const [showAnimation, setShowAnimation] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showPlaytest, setShowPlaytest] = useState(false);
  const [showMesh, setShowMesh] = useState(false);
  const desiredSidePanel = showPlaytest
    ? "playtest"
    : showMesh
      ? "mesh"
      : showAnimation
        ? "animation"
        : showMap
          ? "map"
          : hasStudioTarget && !explorerCollapsed
            ? "explorer"
            : null;
  const [renderedSidePanel, setRenderedSidePanel] = useState<
    "explorer" | "playtest" | "mesh" | "animation" | "map" | null
  >(null);
  const [sidePanelExiting, setSidePanelExiting] = useState(false);
  const sidePanelTimerRef = useRef<number | null>(null);

  const appScreen =
    showStudioSetup || studioConnection.state === "waiting"
      ? "studio-setup"
      : studioConnection.state === "checking"
        ? "studio-checking"
        : showSettings
          ? "settings"
          : !ready
            ? "loading"
            : activeSessionId
              ? "chat"
              : "home";

  // ── Single Source of Truth for Active Tab (exclusive highlight) ──
  // Only the button matching currentActiveTab receives the active CSS class.
  // When a modal/top screen (Map, Play, Settings, StudioSetup, etc.) covers Explorer,
  // the Explorer highlight is cleared — no two tabs are active simultaneously.
  const activeTab: ActiveTab = useMemo(() => {
    // Any full-screen overlay deactivates navigation highlights
    if (showSettings || showStudioSetup) return null;
    if (studioConnection.state === "waiting" || studioConnection.state === "checking") return null;
    if (!ready || !activeSessionId) return null;
    // Exclusive side-panel precedence (play > mesh > animation > map > explorer)
    if (showPlaytest) return "play";
    if (showMesh) return "mesh";
    if (showAnimation) return "animation";
    if (showMap) return "map";
    if (hasStudioTarget && !explorerCollapsed) return "explorer";
    return null;
  }, [
    showSettings,
    showStudioSetup,
    studioConnection.state,
    ready,
    activeSessionId,
    showPlaytest,
    showMesh,
    showAnimation,
    showMap,
    hasStudioTarget,
    explorerCollapsed,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // Cmd/Ctrl+, → Open settings
      if (e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
        return;
      }

      // Cmd/Ctrl+N → New session (when available)
      if (e.key === "n" && ready) {
        e.preventDefault();
        createSession.mutate();
        return;
      }

      // Cmd/Ctrl+E → Toggle explorer
      if (
        e.key === "e" &&
        hasStudioTarget &&
        !showPlaytest &&
        !showMesh &&
        !showAnimation &&
        !showMap
      ) {
        e.preventDefault();
        setExplorerCollapsed(!explorerCollapsed);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    ready,
    hasStudioTarget,
    showPlaytest,
    showMesh,
    showAnimation,
    showMap,
    createSession,
    setExplorerCollapsed,
    explorerCollapsed,
  ]);

  useEffect(() => {
    if (!import.meta.env.PROD || !POSTHOG_PROJECT_TOKEN) return;

    const screenProperties = {
      $current_url: `BloxMind://app/${appScreen}`,
      $host: "app",
      $pathname: `/${appScreen}`,
      app_screen: appScreen,
    };
    posthog.register(screenProperties);
    posthog.capture("$pageview", analyticsProperties("navigation", screenProperties));
  }, [appScreen]);

  useEffect(() => {
    if (studioConnection.state === "waiting") setShowStudioSetup(true);
  }, [studioConnection.state]);

  useEffect(() => {
    if (
      activeSessionId &&
      allSessions &&
      !allSessions.some((session) => session.id === activeSessionId)
    ) {
      clearSession();
    }
  }, [activeSessionId, allSessions, clearSession]);

  useEffect(() => {
    if (sidePanelTimerRef.current !== null) {
      window.clearTimeout(sidePanelTimerRef.current);
      sidePanelTimerRef.current = null;
    }
    if (desiredSidePanel === renderedSidePanel) {
      setSidePanelExiting(false);
      return;
    }
    if (renderedSidePanel !== null) {
      setSidePanelExiting(true);
      sidePanelTimerRef.current = window.setTimeout(() => {
        setRenderedSidePanel(desiredSidePanel);
        setSidePanelExiting(false);
        sidePanelTimerRef.current = null;
      }, SIDE_PANEL_EXIT_MS);
      return;
    }
    setRenderedSidePanel(desiredSidePanel);
    setSidePanelExiting(false);
  }, [desiredSidePanel, renderedSidePanel]);

  useEffect(
    () => () => {
      if (sidePanelTimerRef.current !== null) window.clearTimeout(sidePanelTimerRef.current);
    },
    [],
  );

  const handleToggleSidebar = useCallback(
    () => setSidebarCollapsed(!sidebarCollapsed),
    [sidebarCollapsed, setSidebarCollapsed],
  );
  const handleSessionSelect = useCallback(() => {
    setShowSettings(false);
  }, []);
  const handleOpenGeneralSettings = useCallback(() => {
    setShowSettings(true);
  }, []);
  const handleToggleExplorer = useCallback(() => {
    if (showPlaytest) {
      posthog.capture("playtest_closed", analyticsProperties("playtest"));
      setShowPlaytest(false);
      setExplorerCollapsed(false);
      return;
    }

    if (showMesh) {
      posthog.capture("mesh_closed", analyticsProperties("mesh"));
      setShowMesh(false);
      setExplorerCollapsed(false);
      return;
    }

    if (showAnimation) {
      setShowAnimation(false);
      setExplorerCollapsed(false);
      return;
    }

    if (showMap) {
      setShowMap(false);
      setExplorerCollapsed(false);
      return;
    }

    setExplorerCollapsed(!explorerCollapsed);
  }, [showPlaytest, showMesh, showAnimation, showMap, explorerCollapsed, setExplorerCollapsed]);
  const handleOpenAnimation = useCallback(() => {
    if (!hasStudioTarget) return;
    // active tab → animation (exclusive, Explorer deactivates when covered)
    setShowMap(false);
    setShowMesh(false);
    setShowPlaytest(false);
    setShowAnimation(true);
    posthog.capture("animation_opened", analyticsProperties("animation"));
  }, [hasStudioTarget]);
  const handleCloseAnimation = useCallback(() => {
    posthog.capture("animation_closed", analyticsProperties("animation"));
    setShowAnimation(false);
  }, []);
  const handleOpenMap = useCallback(() => {
    if (!hasStudioTarget) return;
    // active tab → map (exclusive, Explorer deactivates when covered)
    setShowAnimation(false);
    setShowMesh(false);
    setShowPlaytest(false);
    setShowMap(true);
    posthog.capture("map_opened", analyticsProperties("map"));
  }, [hasStudioTarget]);
  const handleCloseMap = useCallback(() => {
    posthog.capture("map_closed", analyticsProperties("map"));
    setShowMap(false);
  }, []);
  const handleOpenPlaytest = useCallback(() => {
    if (!hasStudioTarget) return;
    // active tab → play (exclusive, Explorer deactivates when covered)
    setExplorerCollapsed(true);
    setShowAnimation(false);
    setShowMap(false);
    setShowMesh(false);
    setShowPlaytest(true);
    posthog.capture("playtest_opened", analyticsProperties("playtest"));
  }, [hasStudioTarget, setExplorerCollapsed]);
  const handleClosePlaytest = useCallback(() => {
    posthog.capture("playtest_closed", analyticsProperties("playtest"));
    setShowPlaytest(false);
  }, []);
  const handleOpenMesh = useCallback(() => {
    if (!hasStudioTarget) return;
    // active tab → mesh (exclusive, Explorer deactivates when covered)
    setExplorerCollapsed(true);
    setShowAnimation(false);
    setShowMap(false);
    setShowPlaytest(false);
    setShowMesh(true);
    posthog.capture("mesh_opened", analyticsProperties("mesh"));
  }, [hasStudioTarget, setExplorerCollapsed]);
  const handleCloseMesh = useCallback(() => {
    posthog.capture("mesh_closed", analyticsProperties("mesh"));
    setShowMesh(false);
  }, []);

  // Main chat UI
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <ChatSidebar
        collapsed={sidebarCollapsed}
        onToggle={handleToggleSidebar}
        onSessionSelect={handleSessionSelect}
        onOpenSettings={handleOpenGeneralSettings}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <ReconnectBanner sseConnected={sseConnected} consecutiveFailures={sseFailureCount} />
        {showStudioSetup || studioConnection.state === "waiting" ? (
          <StudioSetup
            connected={studioConnection.state === "connected"}
            checking={studioConnection.checking}
            onCheck={() => studioConnection.checkAgain()}
            onContinue={() => setShowStudioSetup(false)}
          />
        ) : studioConnection.state === "checking" ? (
          <LoadingScreen message="Finding Roblox Studio" animation="dots" />
        ) : showSettings ? (
          <Suspense fallback={<LoadingScreen message="Loading settings..." />}>
            <Settings onClose={handleSessionSelect} />
          </Suspense>
        ) : !ready ? (
          <LoadingScreen message="Initializing..." />
        ) : !activeSessionId ? (
          <div className="app-scrollbar flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8">
            <div className="animate-fade-in-up w-full max-w-lg text-center">
              <div className="mb-4 flex justify-center">
                <BloxMindLogo size={44} className="text-foreground/90" />
              </div>
              <h2 className="font-serif text-2xl italic text-foreground">
                What would you like to build?
              </h2>
              <p className="mt-2 max-w-md text-xs text-muted-foreground">
                Create a new session or pick one from the sidebar to continue where you left off.
              </p>
              <button
                type="button"
                onClick={() => createSession.mutate()}
                className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New Session
              </button>

              {/* Capability teaser cards — informational only. */}
              <div className="mt-8 grid grid-cols-1 gap-2 text-left sm:grid-cols-3">
                <div className="rounded-lg border bg-card/60 p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                    <Swords aria-hidden="true" size={12} className="text-muted-foreground" />
                    Animations
                  </div>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
                    Pro combat combos, dances, and emotes for R15 and R6 rigs.
                  </p>
                </div>
                <div className="rounded-lg border bg-card/60 p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                    <MapIcon aria-hidden="true" size={12} className="text-muted-foreground" />
                    Whole maps
                  </div>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
                    Structured plans first, then complete zones, terrain, and lighting.
                  </p>
                </div>
                <div className="rounded-lg border bg-card/60 p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                    <Box aria-hidden="true" size={12} className="text-muted-foreground" />
                    AI meshes
                  </div>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
                    Turn a short description into a generated 3D model in Studio.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="grid h-10 shrink-0 grid-cols-[minmax(6rem,2fr)_minmax(0,3fr)] items-center border-b px-3">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate text-xs font-semibold">
                  {activeSessionTitle || "Untitled"}
                </h3>
                {isBusy && (
                  <span className="flex max-w-[42%] shrink items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                    <span className="truncate">
                      {sessionStatus?.type === "retry" ? "Waiting to retry" : "Working"}
                    </span>
                  </span>
                )}
              </div>
              <div className="ml-2 flex min-w-0 items-center justify-end gap-1.5">
                <StudioTargetPicker />
                {hasStudioTarget ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <ProjectIndexButton />
                    <button
                      type="button"
                      onClick={handleOpenAnimation}
                      disabled={isBusy}
                      className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors disabled:opacity-40 ${activeTab === "animation" ? "border-border bg-hover/12 text-foreground" : "border-border/60 bg-background text-muted-foreground hover:bg-hover/12"}`}
                      aria-pressed={activeTab === "animation"}
                      title={isBusy ? "Wait for the agent to finish" : "Create an animation"}
                    >
                      <Swords aria-hidden="true" size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenMap}
                      disabled={isBusy}
                      className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors disabled:opacity-40 ${activeTab === "map" ? "border-border bg-hover/12 text-foreground" : "border-border/60 bg-background text-muted-foreground hover:bg-hover/12"}`}
                      aria-pressed={activeTab === "map"}
                      title={isBusy ? "Wait for the agent to finish" : "Plan a map"}
                    >
                      <MapIcon aria-hidden="true" size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={handleToggleExplorer}
                      className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${activeTab === "explorer" ? "border-border bg-hover/12 text-foreground" : "border-border/60 bg-background text-muted-foreground hover:bg-hover/12"}`}
                      aria-pressed={activeTab === "explorer"}
                      title={activeTab === "explorer" ? "Close Explorer" : "Open Explorer"}
                    >
                      <Boxes aria-hidden="true" size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenMesh}
                      disabled={isBusy}
                      className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors disabled:opacity-40 ${activeTab === "mesh" ? "border-border bg-hover/12 text-foreground" : "border-border/60 bg-background text-muted-foreground hover:bg-hover/12"}`}
                      aria-pressed={activeTab === "mesh"}
                      title={isBusy ? "Wait for the agent to finish" : "Generate a mesh"}
                    >
                      <Box aria-hidden="true" size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenPlaytest}
                      disabled={isBusy}
                      className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors disabled:opacity-40 ${activeTab === "play" ? "border-transparent bg-foreground text-background hover:opacity-85" : "border-border/60 bg-background text-muted-foreground hover:bg-hover/12"}`}
                      aria-pressed={activeTab === "play"}
                      title={isBusy ? "Wait for the agent to finish" : "Create a playtest plan"}
                    >
                      <Play aria-hidden="true" size={13} fill="currentColor" />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <ChatMessages />
            <ChatInput />
          </>
        )}

        {initError && (
          <div className="shrink-0 border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
            {initError}
          </div>
        )}
      </div>
      {renderedSidePanel && activeSessionId && !showSettings && !showStudioSetup ? (
        <div
          className={`flex w-72 shrink-0 overflow-hidden ${sidePanelExiting ? "animate-side-panel-out" : "animate-side-panel-in"}`}
        >
          {renderedSidePanel === "animation" ? (
            <AnimationPanel onClose={handleCloseAnimation} />
          ) : renderedSidePanel === "map" ? (
            <MapPanel onClose={handleCloseMap} />
          ) : renderedSidePanel === "explorer" ? (
            <Explorer
              key={`${activeSessionId}:${studioTarget?.selected?.key ?? "unselected"}`}
              collapsed={false}
              sessionBusy={isBusy}
              onToggle={() => setExplorerCollapsed(true)}
            />
          ) : renderedSidePanel === "mesh" ? (
            <MeshPanel onClose={handleCloseMesh} />
          ) : (
            <PlaytestPanel onClose={handleClosePlaytest} />
          )}
        </div>
      ) : null}
    </div>
  );
}

export default Chat;
