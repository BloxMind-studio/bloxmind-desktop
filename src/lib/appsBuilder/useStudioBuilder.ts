import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { useDeveloperReply } from "@/hooks/mutations/useDeveloperReply";
import { useGenerateApp } from "@/hooks/mutations/useGenerateApp";
import {
  type ActivityFeed,
  applyActivityEvent,
  createActivityFeed,
} from "@/lib/appsBuilder/activity";
import type { AgentState, BuildPhase, FileOperation } from "@/lib/appsBuilder/buildProgress";
import { buildPhaseIndex } from "@/lib/appsBuilder/buildProgress";
import type { DeveloperReply } from "@/lib/appsBuilder/developer";
import { isTransientGenerationError, slugify } from "@/lib/appsBuilder/generate";
import type { PreviewCompileStats } from "@/lib/appsBuilder/preview";
import type {
  AppChatMessage,
  AppEngine,
  AppGeneratedFile,
  AppProject,
  AppTarget,
  SavedApp,
} from "@/lib/appsBuilder/types";
import { downloadZip } from "@/lib/appsBuilder/zip";
import { useAppsPreferences, useGamesPreferences } from "@/providers/PreferencesProvider";

let idCounter = 0;
const nextId = () => `id-${++idCounter}`;

export interface StudioBuilderStorage {
  load: () => SavedApp[];
  upsert: (app: SavedApp) => SavedApp[];
  delete: (id: string) => SavedApp[];
}

export interface StudioBuilderConfig {
  kind: "app" | "game";
  storage: StudioBuilderStorage;
  buildStatus: Record<BuildPhase, string>;
  updateStatus: Record<BuildPhase, string>;
  noun: string;
  nounCap: string;
  zipTag: string;
  tipDismissKey: string;
  forceEngine?: AppEngine;
  game?: boolean;
  readyMessage: (name: string, files: number) => string;
  updatedMessage: (name: string, files: number) => string;
}

export interface StudioBuilderMachine {
  project: AppProject | null;
  messages: AppChatMessage[];
  liveReply: string;
  phase: BuildPhase | null;
  prompt: string;
  setPrompt: (value: string) => void;
  agentState: AgentState | null;
  activityFeed: ActivityFeed;
  busyElapsed: number;
  busy: boolean;
  generating: boolean;
  files: AppGeneratedFile[];
  selectedFile: string;
  setSelectedFile: (path: string) => void;
  previewRevision: number;
  exportOpen: boolean;
  setExportOpen: Dispatch<SetStateAction<boolean>>;
  savedList: SavedApp[];
  openProject: SavedApp | null;
  editorOpen: boolean;
  dirty: boolean;
  engine: AppEngine | "auto";
  setEngine: (engine: AppEngine | "auto") => void;
  viewport: AppTarget;
  setViewport: (viewport: AppTarget) => void;
  prefs: ReturnType<typeof useAppsPreferences> | ReturnType<typeof useGamesPreferences>;
  advancePhase: (next: BuildPhase) => void;
  sendMessage: () => void;
  stop: () => void;
  handleSave: () => void;
  handleExport: () => void;
  handleBack: () => void;
  handleNewProject: () => void;
  handleOpenProject: (saved: SavedApp) => void;
  handleDeleteProject: (id: string) => void;
  generate: ReturnType<typeof useGenerateApp>;
  developerReply: ReturnType<typeof useDeveloperReply>;
  /** Ask the AI to fix a preview/runtime error without retyping it. */
  fixFromError: (errorText: string) => void;
  /** Last preview compile metrics (E1), or null before the first mount. */
  compileStats: PreviewCompileStats | null;
  setCompileStats: Dispatch<SetStateAction<PreviewCompileStats | null>>;
}

export function useStudioBuilder(config: StudioBuilderConfig): StudioBuilderMachine {
  const isGame = config.kind === "game";
  const appsPrefs = useAppsPreferences();
  const gamesPrefs = useGamesPreferences();
  const prefs = isGame ? gamesPrefs : appsPrefs;

  const [viewport, setViewport] = useState<AppTarget>(appsPrefs.defaultViewport);
  const [engine, setEngine] = useState<AppEngine | "auto">("auto");

  // Apps reflect the persisted default viewport on mount; games are full-canvas.
  useEffect(() => {
    if (!isGame) setViewport(appsPrefs.defaultViewport);
  }, [appsPrefs.defaultViewport, isGame]);

  const [project, setProject] = useState<AppProject | null>(null);
  const [messages, setMessages] = useState<AppChatMessage[]>([]);
  const [selectedFile, setSelectedFile] = useState("src/App.tsx");
  const [prompt, setPrompt] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [phase, setPhase] = useState<BuildPhase | null>(null);
  const [savedList, setSavedList] = useState<SavedApp[]>(() => config.storage.load());
  const [openProject, setOpenProject] = useState<SavedApp | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [liveReply, setLiveReply] = useState("");
  const [busyElapsed, setBusyElapsed] = useState(0);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [activityFeed, setActivityFeed] = useState<ActivityFeed>(createActivityFeed);
  const [compileStats, setCompileStats] = useState<PreviewCompileStats | null>(null);

  const advancePhase = useCallback((next: BuildPhase) => {
    setPhase((prev) =>
      prev !== null && buildPhaseIndex(next) <= buildPhaseIndex(prev) ? prev : next,
    );
  }, []);

  // Persistent session backing the project, set while a build resolves it.
  const sessionIDRef = useRef<string | null>(null);
  const lastFileOpRef = useRef<FileOperation | null>(null);
  const generate = useGenerateApp({
    onProgress: advancePhase,
    onSessionReady: (sessionID) => {
      sessionIDRef.current = sessionID;
    },
    onFileOperation: (op) => {
      if (
        (op.type === "write" || op.type === "edit") &&
        !(lastFileOpRef.current?.type === op.type && lastFileOpRef.current?.path === op.path)
      ) {
        lastFileOpRef.current = op;
        const label = op.type === "write" ? "creating" : "editing";
        pushMessage({ id: nextId(), role: "assistant", text: `${label} ${op.path}` });
      }
    },
    onAgentState: (state) => setAgentState(state),
    onActivity: (event) =>
      setActivityFeed((feed) => applyActivityEvent(feed, event, sessionIDRef.current ?? "")),
  });
  const developerReply = useDeveloperReply({ onDeltas: setLiveReply, game: isGame });

  const narratedPhaseRef = useRef<BuildPhase | null>(null);

  const files = project?.files ?? [];
  const busy = generate.isPending || developerReply.isPending;
  const generating = generate.isPending;

  // Show how long the current turn has been running so a slow model doesn't
  // look stuck; stops counting as soon as the turn settles.
  useEffect(() => {
    if (!busy) {
      setBusyElapsed(0);
      setAgentState(null);
      setActivityFeed(createActivityFeed());
      return;
    }
    setBusyElapsed(0);
    const timer = window.setInterval(() => setBusyElapsed((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  // Monotonic turn counter; stale async work checks it before touching state.
  const turnRef = useRef(0);
  const stopRequestedRef = useRef(false);
  const queueRef = useRef<string[]>([]);
  const projectRef = useRef<AppProject | null>(null);
  const messagesRef = useRef<AppChatMessage[]>([]);
  const updateModeRef = useRef(false);

  const pushMessage = useCallback((message: AppChatMessage) => {
    messagesRef.current = [...messagesRef.current, message];
    setMessages((prev) => [...prev, message]);
  }, []);

  const stop = () => {
    stopRequestedRef.current = true;
    developerReply.abort();
    generate.abort();
  };

  // Narrate each new build phase into the chat log like a dev reporting in.
  useEffect(() => {
    if (!phase || phase === "finalizing" || narratedPhaseRef.current === phase) return;
    narratedPhaseRef.current = phase;
    const statusMessages = updateModeRef.current ? config.updateStatus : config.buildStatus;
    pushMessage({ id: nextId(), role: "assistant", text: statusMessages[phase] });
  }, [phase, pushMessage, updateModeRef, config]);

  /**
   * Shared handling for both fresh generation and project updates: narrates
   * the phase, runs the mutation, and folds a successful run into the editor.
   */
  function runBuild(
    latestMessage: string,
    turn: number,
    existing: AppProject | null,
    history: readonly AppChatMessage[],
  ): Promise<AppProject | null> {
    const priorUserTexts = history.filter((m) => m.role === "user").map((m) => m.text);
    const context = priorUserTexts.filter((text) => text !== latestMessage);
    const contextPart = context.length
      ? `\n\nCONTEXT FROM OUR CONVERSATION\n${context.map((text) => `- ${text}`).join("\n")}`
      : "";
    const buildRequest = `${latestMessage}${contextPart}`;

    updateModeRef.current = existing !== null;
    setPhase("analyzing");
    narratedPhaseRef.current = null;

    const attempt = () =>
      generate.mutateAsync({
        request: buildRequest,
        existing,
        sessionID: sessionIDRef.current,
        engine: config.forceEngine ?? (engine === "auto" ? undefined : engine),
      });
    const resolveResult = (result: AppProject | null) => {
      if (turnRef.current !== turn) return null;
      if (!result) {
        setPhase(null);
        narratedPhaseRef.current = null;
        if (stopRequestedRef.current) {
          stopRequestedRef.current = false;
          pushMessage({
            id: nextId(),
            role: "assistant",
            text: "Stopped — I'll keep what we have so far. Where should we take it next?",
          });
        }
        return null;
      }
      return result;
    };
    const failTurn = (error: Error) => {
      if (turnRef.current !== turn) return null;
      setPhase(null);
      narratedPhaseRef.current = null;
      pushMessage({
        id: nextId(),
        role: "assistant",
        text: existing
          ? `I couldn't apply that change: ${error.message}`
          : `I couldn't build that ${config.noun}: ${error.message}`,
      });
      toast.error(
        existing ? `${config.nounCap} update failed` : `${config.nounCap} generation failed`,
        {
          description: error.message,
        },
      );
      return null;
    };

    return attempt()
      .then(resolveResult)
      .catch((error: Error) => {
        if (turnRef.current !== turn) return null;
        if (isTransientGenerationError(error) && !stopRequestedRef.current) {
          setPhase("analyzing");
          narratedPhaseRef.current = null;
          pushMessage({ id: nextId(), role: "assistant", text: "Let me try that again…" });
          return attempt().then(resolveResult, failTurn);
        }
        return failTurn(error);
      });
  }

  function startBuild(
    latestMessage: string,
    turn: number,
    history: readonly AppChatMessage[],
  ): Promise<AppProject | null> {
    return runBuild(latestMessage, turn, null, history).then((built) => {
      if (!built) return null;
      projectRef.current = built;
      setProject(built);
      setPreviewRevision((revision) => revision + 1);
      setSelectedFile(
        built.files.some((file) => file.path === "src/App.tsx")
          ? "src/App.tsx"
          : (built.files[0]?.path ?? ""),
      );
      pushMessage({
        id: nextId(),
        role: "assistant",
        text: config.readyMessage(built.name, built.files.length),
      });
      return built;
    });
  }

  function updateProject(
    latestMessage: string,
    turn: number,
    existing: AppProject,
    history: readonly AppChatMessage[],
  ): Promise<AppProject | null> {
    return runBuild(latestMessage, turn, existing, history).then((updated) => {
      if (!updated) return null;
      projectRef.current = updated;
      setProject(updated);
      setPreviewRevision((n) => n + 1);
      if (!updated.files.some((file) => file.path === selectedFile)) {
        setSelectedFile(updated.files[0]?.path ?? "");
      }
      pushMessage({
        id: nextId(),
        role: "assistant",
        text: config.updatedMessage(updated.name, updated.files.length),
      });
      return updated;
    });
  }

  async function runTurn(
    trimmed: string,
    existing: AppProject | null,
    history: readonly AppChatMessage[],
  ) {
    const turn = ++turnRef.current;
    lastFileOpRef.current = null;
    if (developerReply.isPending) {
      stop();
      stopRequestedRef.current = false;
    }
    setDirty(true);
    let reply: DeveloperReply | null;
    try {
      reply = await developerReply.mutateAsync({ message: trimmed, history, existing });
    } catch (error: unknown) {
      if (turnRef.current !== turn) return;
      setLiveReply("");
      pushMessage({
        id: nextId(),
        role: "assistant",
        text: `I hit a snag there: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
    if (turnRef.current !== turn || !reply) {
      if (turnRef.current === turn && stopRequestedRef.current) {
        stopRequestedRef.current = false;
        setLiveReply("");
        pushMessage({
          id: nextId(),
          role: "assistant",
          text: "Stopped — I'll keep what we have so far. Where should we take it next?",
        });
      }
      return;
    }
    setLiveReply("");
    pushMessage({ id: nextId(), role: "assistant", text: reply.response });
    if (!reply.build) return;

    const latest = existing
      ? await updateProject(trimmed, turn, existing, history)
      : await startBuild(trimmed, turn, history);
    if (turnRef.current !== turn) return;

    const next = queueRef.current.shift();
    if (next) void runTurn(next, latest ?? existing, messagesRef.current);
  }

  function sendMessage() {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setPrompt("");
    pushMessage({ id: nextId(), role: "user", text: trimmed });
    if (generate.isPending) {
      queueRef.current = [...queueRef.current, trimmed];
      pushMessage({
        id: nextId(),
        role: "assistant",
        text: "Got it — queued. I'll apply that as soon as the current build finishes.",
      });
      return;
    }
    void runTurn(trimmed, projectRef.current, messagesRef.current);
  }

  /**
   * Runtime self-heal (B1): feed a preview error straight back to the AI as a
   * fix request, without the user having to retype or copy the error text.
   */
  const fixFromError = (errorText: string) => {
    const trimmed = (errorText ?? "").trim();
    if (!trimmed) return;
    const text = `The preview hit an error. Please fix it:\n\n${trimmed}`;
    pushMessage({ id: nextId(), role: "user", text });
    if (generate.isPending) {
      queueRef.current = [...queueRef.current, text];
      pushMessage({
        id: nextId(),
        role: "assistant",
        text: "Got it — queued. I'll apply that as soon as the current build finishes.",
      });
      return;
    }
    void runTurn(text, projectRef.current, messagesRef.current);
  };

  function handleOpenProject(saved: SavedApp) {
    setOpenProject(saved);
    setEditorOpen(true);
    sessionIDRef.current = saved.sessionID ?? null;
    projectRef.current = saved.project;
    setProject(saved.project);
    messagesRef.current = saved.messages;
    setMessages(saved.messages);
    queueRef.current = [];
    setSelectedFile(
      saved.project.files.some((file) => file.path === "src/App.tsx")
        ? "src/App.tsx"
        : (saved.project.files[0]?.path ?? ""),
    );
    // Apps restore the project's own viewport + engine; games stay on 3D.
    if (!isGame) {
      setEngine(saved.project.engine);
      setViewport(saved.project.target ?? "desktop");
    }
    setPhase(null);
    setDirty(false);
  }

  function handleNewProject() {
    setOpenProject(null);
    setEditorOpen(true);
    sessionIDRef.current = null;
    projectRef.current = null;
    setProject(null);
    messagesRef.current = [];
    setMessages([]);
    queueRef.current = [];
    setPrompt("");
    setLiveReply("");
    if (!isGame) setEngine("auto");
    setPhase(null);
    setDirty(false);
  }

  function handleDeleteProject(id: string) {
    if (!window.confirm(`Delete this ${config.noun}? This can't be undone.`)) return;
    setSavedList(config.storage.delete(id));
  }

  function handleSave() {
    if (!project) return;
    const now = Date.now();
    const saved: SavedApp = {
      id: openProject?.id ?? slugify(project.name),
      name: project.name,
      description: project.description,
      status: openProject?.status ?? "in-progress",
      createdAt: openProject?.createdAt ?? now,
      updatedAt: now,
      project,
      messages,
      sessionID: sessionIDRef.current ?? openProject?.sessionID,
    };
    setSavedList(config.storage.upsert(saved));
    setOpenProject(saved);
    setDirty(false);
    toast.success(`${config.nounCap} saved`);
  }

  function handleBack() {
    if (dirty && project) {
      if (window.confirm(`You have unsaved changes. Save the ${config.noun} before leaving?`)) {
        handleSave();
      }
    }
    setOpenProject(null);
    setEditorOpen(false);
  }

  function handleExport() {
    if (!project) return;
    try {
      downloadZip(files, `${slugify(project.name)}${config.zipTag}`);
      if (openProject) {
        const completed: SavedApp = {
          ...openProject,
          status: "completed",
          updatedAt: Date.now(),
          project,
          messages,
        };
        setSavedList(config.storage.upsert(completed));
        setOpenProject(completed);
      }
      toast.success("Project zip exported — ready for npm install");
    } catch {
      toast.error("Export failed");
    }
    setExportOpen(false);
  }

  return {
    project,
    messages,
    liveReply,
    phase,
    prompt,
    setPrompt,
    agentState,
    activityFeed,
    busyElapsed,
    busy,
    generating,
    files,
    selectedFile,
    setSelectedFile,
    previewRevision,
    exportOpen,
    setExportOpen,
    savedList,
    openProject,
    editorOpen,
    dirty,
    viewport,
    setViewport,
    engine,
    setEngine,
    prefs,
    advancePhase,
    sendMessage,
    stop,
    handleSave,
    handleExport,
    handleBack,
    handleNewProject,
    handleOpenProject,
    handleDeleteProject,
    generate,
    developerReply,
    fixFromError,
    compileStats,
    setCompileStats,
  };
}
