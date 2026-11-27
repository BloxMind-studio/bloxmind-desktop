import { Boxes, Combine, FolderTree, Play } from "lucide-react";
import posthog from "posthog-js/dist/module.full.no-external.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import ChatInput from "@/components/ChatInput";
import ChatMessages from "@/components/ChatMessages";
import ChatSidebar from "@/components/ChatSidebar";
import CompactionStatus from "@/components/CompactionStatus";
import Explorer from "@/components/Explorer";
import LoadingScreen from "@/components/LoadingScreen";
import PlaytestPanel from "@/components/PlaytestPanel";
import Settings from "@/components/Settings";
import StudioNotice from "@/components/StudioNotice";
import StudioSetup from "@/components/StudioSetup";
import StudioTargetPicker from "@/components/StudioTargetPicker";
import StudioUseReporter from "@/components/StudioUseReporter";
import { useCompactSession } from "@/hooks/mutations/useCompactSession";
import { useCreateSession } from "@/hooks/mutations/useCreateSession";
import { useChatStudioUse } from "@/hooks/useMessages";
import { isSessionWorking, useSessionStatus } from "@/hooks/useSessionStatuses";
import { useSessions } from "@/hooks/useSessions";
import { useStarCalloutForReturningUsers } from "@/hooks/useStarCalloutForReturningUsers";
import { useStudioConnection } from "@/hooks/useStudioConnection";
import { analyticsProperties, POSTHOG_PROJECT_TOKEN } from "@/lib/analytics";
import { desktop } from "@/lib/desktop";
import { setChatOnScreen, setSessionOpener } from "@/lib/sessionNotifications";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useExplorerReference } from "@/providers/ExplorerReferenceProvider";
import { SIDE_PANEL_EXIT_MS, useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";
import { useProjectIndexContext } from "@/providers/ProjectIndexProvider";
import { useStudioTargetOptional } from "@/providers/StudioTargetProvider";

/**
 * Project index status marker. A compact icon with a colored dot that shows
 * whether the index is working (green ok, amber partial, red failed); the button
 * shows only the icon and dot and reveals the indexed-script count on hover.
 * The native tooltip carries the details. Clicking triggers a re-index.
 */
function ProjectIndexButton() {
  const { skeleton, isLoading, isFetching, error, refresh } = useProjectIndexContext();

  const indexed = skeleton !== null;
  const busy = isLoading || isFetching;
  const total = (skeleton?.totalScripts ?? 0) + (skeleton?.totalModuleScripts ?? 0);
  const partial =
    skeleton?.partial === true ||
    (skeleton?.circularDependencies.length ?? 0) > 0 ||
    (skeleton?.unreadableScripts ?? 0) > 0;

  const title = error
    ? `Index failed: ${error}. Click to retry.`
    : busy
      ? "Reading the script map from Studio..."
      : indexed
        ? `${total} ${total === 1 ? "script" : "scripts"} indexed${partial ? " with issues" : ""}. Click to refresh.`
        : "Index project";

  return (
    <button
      type="button"
      onClick={() => refresh()}
      disabled={busy}
      title={title}
      className={`group inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2 text-[11px] font-medium tabular-nums transition-[background-color,color] hover:bg-accent hover:text-foreground disabled:opacity-50 ${
        error ? "text-red-500" : "text-muted-foreground"
      }`}
    >
      <span className="relative flex items-center" aria-hidden="true">
        <FolderTree size={13} />
        <span
          className={`absolute -right-1 -top-1 rounded-full ${
            busy
              ? "h-1.5 w-1.5 animate-ping bg-amber-400"
              : partial
                ? "h-1.5 w-1.5 bg-amber-500"
                : "h-1.5 w-1.5 bg-emerald-500"
          }`}
        />
        {error && <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-red-500" />}
      </span>
      {indexed && total > 0 && (
        <span className="inline-flex max-w-0 overflow-hidden whitespace-nowrap opacity-0 tabular-nums transition-[max-width,opacity] duration-200 group-hover:max-w-[6rem] group-hover:opacity-100">
          {total}
        </span>
      )}
    </button>
  );
}

/**
 * Summarize the current conversation through OpenCode's compaction endpoint.
 * Sits beside the Studio controls so it is available in any session, not only
 * when a Studio place is connected.
 */
function CompactButton({ disabled }: { disabled: boolean }) {
  const compactSession = useCompactSession();
  const { selectedModel, autoCompaction } = usePreferences();
  const compacting = compactSession.isPending;
  const blocked = disabled || !selectedModel;

  const handleClick = useCallback(() => {
    compactSession.mutate(undefined, {
      onSuccess: () => toast.success("Conversation compacted"),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : "Could not compact the conversation"),
    });
  }, [compactSession]);

  // Automatic compaction already covers this session. Showing both would offer
  // the same action twice, so the manual button belongs to the opt-out mode.
  if (autoCompaction) return null;

  const title = !selectedModel
    ? "Select a model before compacting"
    : disabled
      ? "Wait for the agent to finish"
      : "Summarize older messages to free context";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={blocked || compacting}
      className="inline-flex h-7 items-center rounded-md border bg-background px-2 text-[11px] font-medium text-muted-foreground transition-[background-color,color] hover:bg-accent hover:text-foreground disabled:opacity-40"
      aria-label="Compact conversation"
      title={title}
    >
      <Combine aria-hidden="true" size={13} />
      <span className="ml-1.5 whitespace-nowrap">{compacting ? "Compacting..." : "Compact"}</span>
    </button>
  );
}

function Chat() {
  const { ready, initError } = useOpenCodeClient();
  const { activeSessionId, clearSession, selectSession } = useActiveSession();
  const sessionStatus = useSessionStatus(activeSessionId);
  const isBusy = isSessionWorking(sessionStatus);
  const createSession = useCreateSession();
  const { data: allSessions } = useSessions();
  const studioConnection = useStudioConnection();
  const studioTarget = useStudioTargetOptional();
  const hasStudioTarget = Boolean(studioTarget?.selected) && studioTarget?.status === "ready";
  const studioUse = useChatStudioUse();

  // Get active session title from the sessions list
  const activeSessionTitle = allSessions?.find((s) => s.id === activeSessionId)?.title ?? null;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showStudioSetup, setShowStudioSetup] = useState(false);
  const [pickerRequest, setPickerRequest] = useState(0);
  const [showPlaytest, setShowPlaytest] = useState(false);
  const sidePanelOpen = showPlaytest || (hasStudioTarget && !explorerCollapsed);
  const desiredSidePanel = showPlaytest
    ? "playtest"
    : hasStudioTarget && !explorerCollapsed
      ? "explorer"
      : null;
  const [renderedSidePanel, setRenderedSidePanel] = useState<"explorer" | "playtest" | null>(null);
  const [sidePanelExiting, setSidePanelExiting] = useState(false);
  const sidePanelTimerRef = useRef<number | null>(null);

  // A click on an object name in the chat asks the Explorer to show it, which
  // means the panel has to be open, even if Playtest had taken its place.
  const { focusRequest } = useExplorerReference();
  useEffect(() => {
    if (!focusRequest) return;
    setShowPlaytest(false);
    setExplorerCollapsed(false);
  }, [focusRequest]);

  // When the place closes, the Explorer disappears with focus inside it. Say so.
  const previousPanelRef = useRef(renderedSidePanel);
  const [panelNote, setPanelNote] = useState("");
  useEffect(() => {
    const previous = previousPanelRef.current;
    previousPanelRef.current = renderedSidePanel;
    if (hasStudioTarget) {
      setPanelNote("");
      return;
    }
    if (previous === "explorer" && renderedSidePanel === null) setPanelNote("Explorer closed.");
  }, [renderedSidePanel, hasStudioTarget]);

  // Finishing setup is a decision to start, so it shouldn't need a second click.
  const [setupSkipped, setSetupSkipped] = useState<boolean | null>(null);
  const everConnectedRef = useRef(false);
  if (studioConnection.state === "connected") everConnectedRef.current = true;
  const needsSetup =
    studioConnection.state === "waiting" && setupSkipped !== true && !everConnectedRef.current;

  useEffect(() => {
    void desktop.loadConfig().then(
      (config) => setSetupSkipped(config.studioSetupSkipped === true),
      () => setSetupSkipped(false),
    );
  }, []);

  const startFirstChat = useCallback(() => {
    if (!activeSessionId) createSession.mutate();
  }, [activeSessionId, createSession]);

  const finishSetup = useCallback(() => {
    setShowStudioSetup(false);
    startFirstChat();
  }, [startFirstChat]);

  const skipSetup = useCallback(() => {
    setSetupSkipped(true);
    void desktop.patchConfig({ studioSetupSkipped: true });
    setShowStudioSetup(false);
    startFirstChat();
    document.querySelector<HTMLElement>('[aria-label="Message"]')?.focus();
  }, [startFirstChat]);

  // Picking a Studio after skipping means the guidance is welcome again.
  const studioChoices = studioTarget?.studioChoices ?? 0;
  useEffect(() => {
    if (studioChoices === 0) return;
    setSetupSkipped((skipped) => {
      if (skipped) void desktop.patchConfig({ studioSetupSkipped: false });
      return false;
    });
  }, [studioChoices]);

  const appScreen =
    showStudioSetup || needsSetup
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

  useStarCalloutForReturningUsers();

  // Settings and setup cover the chat, so notifications for it must still be offered.
  useEffect(() => {
    setChatOnScreen(appScreen === "chat");
  }, [appScreen]);

  useEffect(() => {
    setSessionOpener((sessionID) => {
      if (sessionID !== activeSessionId) void selectSession(sessionID);
      setShowSettings(false);
    });
  }, [activeSessionId, selectSession]);

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
      if (e.key === "e" && hasStudioTarget && !showPlaytest) {
        e.preventDefault();
        setExplorerCollapsed((c) => !c);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [ready, hasStudioTarget, showPlaytest, createSession]);

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

  // /connect asks the shell to open Settings.
  useEffect(() => {
    const openSettings = () => setShowSettings(true);
    window.addEventListener("bloxmind:open-settings", openSettings);
    return () => window.removeEventListener("bloxmind:open-settings", openSettings);
  }, []);

  // A chat's Playtest belongs to that chat, so switching chats closes it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the chat change matters.
  useEffect(() => {
    setShowPlaytest(false);
  }, [activeSessionId]);

  useEffect(() => {
    if (studioConnection.state === "waiting" && setupSkipped !== true) setShowStudioSetup(true);
  }, [setupSkipped, studioConnection.state]);

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

  const handleToggleSidebar = useCallback(() => setSidebarCollapsed((c) => !c), []);
  const handleSessionSelect = useCallback(() => setShowSettings(false), []);
  const handleOpenSettings = useCallback(() => setShowSettings(true), []);
  const handleToggleExplorer = useCallback(() => {
    if (showPlaytest) {
      posthog.capture("playtest_closed", analyticsProperties("playtest"));
      setShowPlaytest(false);
      setExplorerCollapsed(false);
      return;
    }

    setExplorerCollapsed((collapsed) => !collapsed);
  }, [showPlaytest]);
  const handleOpenPlaytest = useCallback(() => {
    if (!hasStudioTarget) return;
    posthog.capture("playtest_opened", analyticsProperties("playtest"));
    setExplorerCollapsed(true);
    setShowPlaytest(true);
  }, [hasStudioTarget]);
  const handleClosePlaytest = useCallback(() => {
    posthog.capture("playtest_closed", analyticsProperties("playtest"));
    setShowPlaytest(false);
  }, []);

  // Main chat UI
  return (
    <div className="flex min-h-0 flex-1">
      <ChatSidebar
        collapsed={sidebarCollapsed}
        onToggle={handleToggleSidebar}
        onSessionSelect={handleSessionSelect}
        onOpenSettings={handleOpenSettings}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {showStudioSetup || needsSetup ? (
          <StudioSetup
            connected={studioConnection.state === "connected"}
            checking={studioConnection.checking}
            placeOpen={hasStudioTarget}
            problem={studioConnection.problem}
            onCheck={() => studioConnection.checkAgain()}
            onContinue={finishSetup}
            onSkip={skipSetup}
          />
        ) : studioConnection.state === "checking" ? (
          <LoadingScreen message="Finding Roblox Studio" animation="dots" />
        ) : showSettings ? (
          <Settings onClose={handleSessionSelect} />
        ) : !ready ? (
          <LoadingScreen message="Initializing..." />
        ) : !activeSessionId ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <div className="animate-fade-in-up text-center">
              <h2 className="font-serif text-2xl italic text-foreground">
                What would you like to build?
              </h2>
              <p className="mt-2 max-w-md text-xs text-muted-foreground">
                Create a new session or pick one from the sidebar to continue where you left off.
              </p>
              <button
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
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New Session
              </button>
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
                <CompactButton disabled={isBusy} />
                <StudioTargetPicker
                  openRequest={pickerRequest}
                  onOpenSetup={() => setShowStudioSetup(true)}
                />
                {hasStudioTarget ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <ProjectIndexButton />
                    <button
                      type="button"
                      onClick={handleToggleExplorer}
                      className="inline-flex h-7 items-center rounded-md border bg-background px-2 text-[11px] font-medium text-muted-foreground transition-[background-color,color] hover:bg-accent hover:text-foreground"
                      aria-pressed={!explorerCollapsed}
                      title={explorerCollapsed ? "Open Explorer" : "Close Explorer"}
                    >
                      <Boxes aria-hidden="true" size={13} />
                      <span
                        className={`overflow-hidden whitespace-nowrap transition-[max-width,margin,opacity] duration-200 ${sidePanelOpen ? "ml-0 max-w-0 opacity-0" : "ml-1.5 max-w-16 opacity-100"}`}
                      >
                        Explorer
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenPlaytest}
                      disabled={isBusy}
                      className="inline-flex h-7 items-center rounded-md bg-foreground px-2 text-[11px] font-semibold text-background transition-opacity hover:opacity-85 disabled:opacity-40"
                      title={isBusy ? "Wait for the agent to finish" : "Create a playtest plan"}
                    >
                      <Play aria-hidden="true" size={13} fill="currentColor" />
                      <span
                        className={`overflow-hidden whitespace-nowrap transition-[max-width,margin,opacity] duration-200 ${sidePanelOpen ? "ml-0 max-w-0 opacity-0" : "ml-1.5 max-w-16 opacity-100"}`}
                      >
                        Playtest
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <CompactionStatus />
            <ChatMessages />
            <StudioUseReporter />
            <StudioNotice
              quiet={studioUse?.started === true}
              onOpenSetup={() => setShowStudioSetup(true)}
              onOpenPicker={() => setPickerRequest((request) => request + 1)}
              onWorkedWithoutStudio={skipSetup}
            />
            <ChatInput onOpenSettings={handleOpenSettings} />
          </>
        )}

        {initError && (
          <div className="shrink-0 border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
            {initError}
          </div>
        )}
        <output className="sr-only">{panelNote}</output>
      </div>
      {renderedSidePanel && activeSessionId && !showSettings && !showStudioSetup ? (
        <div
          className={`flex w-72 shrink-0 overflow-hidden ${sidePanelExiting ? "animate-side-panel-out" : "animate-side-panel-in"}`}
        >
          {renderedSidePanel === "explorer" ? (
            <Explorer
              key={`${activeSessionId}:${studioTarget?.selected?.key ?? "unselected"}`}
              collapsed={false}
              sessionBusy={isBusy}
              onToggle={() => setExplorerCollapsed(true)}
            />
          ) : (
            <PlaytestPanel onClose={handleClosePlaytest} />
          )}
        </div>
      ) : null}
    </div>
  );
}

export default Chat;
