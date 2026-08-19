import {
  ArrowUp,
  Bot,
  ChevronLeft,
  Download,
  Info,
  Loader2,
  Monitor,
  MonitorSmartphone,
  Save,
  Settings,
  Smartphone,
  Sparkles,
  Square,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ActivityLog } from "@/components/apps/ActivityLog";
import { AppsGallery } from "@/components/apps/AppsGallery";
import { FileTree } from "@/components/apps/FileTree";
import HighlightedCode from "@/components/apps/HighlightedCode";
import { ModelPicker } from "@/components/ModelPicker";
import type { ActivityFeed } from "@/lib/appsBuilder/activity";
import type { AgentState, BuildPhase } from "@/lib/appsBuilder/buildProgress";
import { BUILD_STATUS_MESSAGES, UPDATE_STATUS_MESSAGES } from "@/lib/appsBuilder/buildProgress";
import { mountAppPreview, type PreviewCompileStats } from "@/lib/appsBuilder/preview";
import { deleteSavedApp, loadSavedApps, upsertSavedApp } from "@/lib/appsBuilder/storage";
import type {
  AppChatMessage,
  AppGeneratedFile,
  AppProject,
  AppTarget,
} from "@/lib/appsBuilder/types";
import { type StudioBuilderConfig, useStudioBuilder } from "@/lib/appsBuilder/useStudioBuilder";
import type { AppsPreferences } from "@/providers/PreferencesProvider";

/** Shared builder config applied to the Apps shell (web/3D, app-flavored copy). */
const APP_BUILDER_CONFIG: StudioBuilderConfig = {
  kind: "app",
  storage: { load: loadSavedApps, upsert: upsertSavedApp, delete: deleteSavedApp },
  buildStatus: BUILD_STATUS_MESSAGES,
  updateStatus: UPDATE_STATUS_MESSAGES,
  noun: "app",
  nounCap: "App",
  forceEngine: "web",
  zipTag: "-app.zip",
  tipDismissKey: "BloxMind-apps-studio-generation-tip-dismissed",
  readyMessage: (name, files) =>
    `**${name}** is ready — ${files} files, and the preview is live. Press play, or export the project.`,
  updatedMessage: (name, files) =>
    `**${name}** updated — the changes are applied and the preview rebuilt (${files} files). Anything else to tweak?`,
};

/** Module-level constant to avoid recreating the remark plugin array per render. */
const APP_REMARK_PLUGINS = [remarkGfm];

/**
 * Prompt-driven AI app generator (Replit Agent / v0 style). The AI writes a
 * complete Vite + React + TypeScript project, the live preview actually
 * compiles and runs the generated code in an isolated iframe, and every
 * generated file is exposed in a syntax-highlighted explorer you can export
 * as a zip.
 */
export function AppsBuilder({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const studio = useStudioBuilder(APP_BUILDER_CONFIG);
  const appsPrefs = studio.prefs as AppsPreferences;
  const savedApps = studio.savedList;
  const handleOpenApp = studio.handleOpenProject;
  const handleNewApp = studio.handleNewProject;
  const handleDeleteApp = studio.handleDeleteProject;
  const handleBackToApps = studio.handleBack;
  const handleSave = studio.handleSave;
  const handleExport = studio.handleExport;
  const setExportOpen = studio.setExportOpen;
  const advancePhase = studio.advancePhase;
  const sendMessage = studio.sendMessage;
  const stop = studio.stop;
  // Studio state consumed by the editor UI.
  const project = studio.project;
  const busy = studio.busy;
  const generateApp = studio.generate;
  const viewport = studio.viewport;
  const setViewport = studio.setViewport;
  const agentState = studio.agentState;
  const busyElapsed = studio.busyElapsed;
  const messages = studio.messages;
  const liveReply = studio.liveReply;
  const phase = studio.phase;
  const prompt = studio.prompt;
  const setPrompt = studio.setPrompt;
  const activityFeed = studio.activityFeed;
  const files = studio.files;
  const selectedFile = studio.selectedFile;
  const setSelectedFile = studio.setSelectedFile;
  const previewRevision = studio.previewRevision;
  const exportOpen = studio.exportOpen;
  const editorOpen = studio.editorOpen;

  const editing = editorOpen;
  if (!editing) {
    return (
      <AppsGallery
        apps={savedApps}
        onOpen={handleOpenApp}
        onNew={handleNewApp}
        onDelete={handleDeleteApp}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-card px-3">
        <button
          type="button"
          data-testid="back-to-apps"
          onClick={handleBackToApps}
          title="Back to your apps"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover/12 hover:text-foreground"
        >
          <ChevronLeft aria-hidden="true" size={14} />
        </button>
        <span className="flex min-w-0 shrink items-center gap-1.5 text-[11px] font-semibold text-foreground">
          <Sparkles aria-hidden="true" size={13} className="shrink-0 text-accent" />
          <span className="shrink-0">Apps Studio</span>
          {project && (
            <span className="min-w-0 truncate font-normal text-muted-foreground">
              · {project.name}
            </span>
          )}
          {busy && (
            <span className="flex min-w-0 items-center gap-1 font-normal text-muted-foreground">
              <Loader2 aria-hidden="true" size={11} className="shrink-0 animate-spin" />
              <span className="truncate">
                {generateApp.isPending
                  ? (agentState?.label ?? (project ? "updating your app…" : "generating…"))
                  : "talking it through…"}{" "}
                {busyElapsed}s
              </span>
              <button
                type="button"
                data-testid="stop-app"
                onClick={stop}
                title="Stop"
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-hover/12 hover:text-foreground"
              >
                <Square aria-hidden="true" size={8} className="fill-current" />
              </button>
            </span>
          )}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ModelPicker size="sm" align="end" placement="down" />
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              title="Apps mode settings"
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover/12 hover:text-foreground"
            >
              <Settings aria-hidden="true" size={13} />
            </button>
          )}
          <button
            type="button"
            data-testid="save-app"
            onClick={handleSave}
            disabled={!project}
            className="flex h-6 items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-hover/12 disabled:opacity-40"
            title="Save this app to your apps"
          >
            <Save aria-hidden="true" size={12} />
            Save App
          </button>
          <div className="relative">
            <button
              type="button"
              data-testid="export-app"
              onClick={() => setExportOpen((prev) => !prev)}
              disabled={!project}
              className="flex h-6 items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-hover/12 disabled:opacity-40"
              title="Export the generated app"
            >
              <Download aria-hidden="true" size={12} />
              Export App
            </button>
            {exportOpen && (
              <div
                role="menu"
                data-testid="export-menu"
                className="animate-fade-in-up absolute right-0 top-8 z-50 w-72 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  data-testid="export-project-zip"
                  onClick={handleExport}
                  className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-hover/12"
                >
                  <span className="text-[11px] font-medium">Export Project Zip</span>
                  <span className="text-[10px] text-muted-foreground">
                    Runnable Vite + React + TypeScript project
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 w-full flex-1 overflow-hidden" data-testid="apps-workspace-grid">
        <ChatPane
          messages={messages}
          liveReply={liveReply}
          generating={busy}
          updating={project !== null}
          phase={phase}
          prompt={prompt}
          elapsed={busyElapsed}
          agentState={agentState}
          activityFeed={activityFeed}
          onPromptChange={setPrompt}
          onGenerate={sendMessage}
          onCancel={stop}
        />
        <PreviewPane
          project={project}
          generating={generateApp.isPending}
          revision={previewRevision}
          viewport={viewport}
          onViewportChange={setViewport}
          onPhase={advancePhase}
          onCompile={studio.setCompileStats}
          onFixError={studio.fixFromError}
        />
        {appsPrefs.showFileTree && (
          <FilesPane
            files={files}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            showLineNumbers={appsPrefs.showLineNumbers}
          />
        )}
      </div>
    </div>
  );
}

/** Markdown renderers that match the app chat's look inside the chat pane. */
const appMarkdownComponents: Components = {
  p({ children }) {
    return <p className="mb-1.5 last:mb-0">{children}</p>;
  },
  ul({ children }) {
    return <ul className="mb-1.5 ml-4 list-disc space-y-0.5 last:mb-0">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="mb-1.5 ml-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>;
  },
  li({ children }) {
    return <li className="pl-0.5">{children}</li>;
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-accent"
      >
        {children}
      </a>
    );
  },
  code({ className, children }) {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      const code = String(children).replace(/\n$/, "");
      return (
        <pre className="mb-1.5 overflow-x-auto rounded-md bg-muted/40 px-2 py-1.5 font-mono text-[11px] leading-relaxed last:mb-0">
          {code}
        </pre>
      );
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10.5px] text-foreground">
        {children}
      </code>
    );
  },
  pre({ children }) {
    return <>{children}</>;
  },
  strong({ children }) {
    return <strong className="font-semibold">{children}</strong>;
  },
};

/** Left pane — AI chat history + prompt input. */
function ChatPane({
  messages,
  liveReply,
  generating,
  updating,
  phase,
  prompt,
  elapsed,
  agentState,
  activityFeed,
  onPromptChange,
  onGenerate,
  onCancel,
}: {
  messages: AppChatMessage[];
  /** Assistant text streaming in for the current turn, or "" when idle. */
  liveReply: string;
  generating: boolean;
  /** True when a change request is being applied to an existing app. */
  updating: boolean;
  phase: BuildPhase | null;
  prompt: string;
  elapsed: number;
  /** Live label for what the agent is doing right now, or null when idle. */
  agentState: AgentState | null;
  /** Live feed of the agent's real tool calls while generating. */
  activityFeed: ActivityFeed;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  onCancel: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length === 0 && !liveReply) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, liveReply]);

  return (
    <div
      data-testid="apps-chat-pane"
      className="flex min-w-0 shrink-0 basis-[clamp(19rem,24%,26rem)] flex-col border-r bg-card"
    >
      <div className="flex h-9 items-center justify-between border-b px-3">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Bot aria-hidden="true" size={12} />
          AI Agent
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {messages.length} {messages.length === 1 ? "message" : "messages"}
        </span>
      </div>

      <div ref={scrollRef} className="app-scrollbar flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Bot aria-hidden="true" size={22} className="text-muted-foreground/60" />
            <p className="text-xs font-medium text-foreground">Describe an app to build</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              e.g. “Build a dark-mode weather app for mobile”. I'll talk it through with you first,
              then write the full React + TypeScript project and run it in the preview.
            </p>
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            data-testid={message.role === "user" ? "chat-message-user" : "chat-message-assistant"}
            className={`px-3 py-2 ${message.role === "assistant" ? "bg-hover/6" : ""}`}
          >
            <div
              className={`rounded-lg text-[11px] leading-relaxed ${
                message.role === "user"
                  ? "ml-6 bg-accent/15 px-2.5 py-1.5 text-foreground"
                  : "mr-6 text-foreground/90"
              }`}
            >
              {message.role === "user" ? (
                message.text
              ) : (
                <Markdown remarkPlugins={APP_REMARK_PLUGINS} components={appMarkdownComponents}>
                  {message.text}
                </Markdown>
              )}
            </div>
          </div>
        ))}
        {generating && phase === null && (
          <div className="px-3 py-2" data-testid="chat-thinking">
            {liveReply ? (
              <div className="mr-6 rounded-lg bg-hover/6 px-2.5 py-2 text-[11px] leading-relaxed text-foreground/90">
                <Markdown remarkPlugins={APP_REMARK_PLUGINS} components={appMarkdownComponents}>
                  {liveReply}
                </Markdown>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block h-3 w-1.5 animate-pulse rounded-sm bg-accent"
                  />
                  <button
                    type="button"
                    data-testid="stop-thinking"
                    onClick={onCancel}
                    title="Stop"
                    className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-hover/12 hover:text-foreground"
                  >
                    <Square aria-hidden="true" size={8} className="fill-current" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="mr-6 flex items-center gap-1.5 rounded-lg bg-hover/6 px-2.5 py-2">
                <Loader2
                  aria-hidden="true"
                  size={11}
                  className="shrink-0 animate-spin text-accent"
                />
                <span
                  className="min-w-0 truncate text-[11px] text-foreground/90"
                  data-testid="agent-state-label"
                >
                  {agentState?.label ?? `Thinking…`} {elapsed}s
                </span>
                <button
                  type="button"
                  data-testid="stop-thinking"
                  onClick={onCancel}
                  title="Stop"
                  className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-hover/12 hover:text-foreground"
                >
                  <Square aria-hidden="true" size={8} className="fill-current" />
                </button>
              </div>
            )}
          </div>
        )}
        {phase !== null && phase !== "finalizing" && (
          <ActivityLog
            entries={activityFeed.entries}
            updating={updating}
            currentLabel={agentState?.label}
          />
        )}
        {generating && !updating && <GenerationTip />}
      </div>

      <div className="flex items-end gap-1.5 border-t p-2">
        <input
          data-testid="app-prompt-input"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onGenerate();
          }}
          placeholder={
            generating
              ? updating
                ? "Type another message — it'll apply after this update…"
                : "Type another message — it'll apply after this build…"
              : "Describe the app you want to build…"
          }
          className="h-8 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <button
          type="button"
          data-testid="generate-app"
          onClick={onGenerate}
          disabled={prompt.trim().length === 0}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground transition-opacity disabled:opacity-40"
          title={
            generating
              ? updating
                ? "Queue this — I'll apply it after the current update"
                : "Queue this — I'll apply it after the current build"
              : "Generate app"
          }
        >
          {generating ? (
            <Loader2 aria-hidden="true" size={14} className="animate-spin" />
          ) : (
            <ArrowUp aria-hidden="true" size={14} />
          )}
        </button>
      </div>
    </div>
  );
}

/** Persistent storage key for the one-time generation-time estimate notice. */
const GENERATION_TIP_DISMISS_KEY = "BloxMind-apps-studio-generation-tip-dismissed";

/** Subtle expectation-setting notice shown while an app is being generated. */
function GenerationTip() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(GENERATION_TIP_DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(GENERATION_TIP_DISMISS_KEY, "1");
    } catch {
      // Storage may be unavailable; hide for this session only.
    }
  };

  return (
    <div className="px-3 py-2" data-testid="generation-tip">
      <div className="mr-6 flex items-start gap-2 rounded-xl border border-accent/20 bg-accent/5 px-2.5 py-2 backdrop-blur-md">
        <Info aria-hidden="true" size={12} className="mt-px shrink-0 text-accent" />
        <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-muted-foreground">
          Estimated time: around 7–10 minutes to build your full, fully-featured app.
        </p>
        <button
          type="button"
          data-testid="generation-tip-dismiss"
          onClick={dismiss}
          title="Don't show this again"
          className="shrink-0 rounded bg-hover/12 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-hover/20 hover:text-foreground"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/** Center pane — the real generated app, full-canvas by default with an optional device view. */
function PreviewPane({
  project,
  generating,
  revision,
  viewport,
  onViewportChange,
  onPhase,
  onCompile,
  onFixError,
}: {
  project: AppProject | null;
  generating: boolean;
  /** Bumped whenever the project is replaced or updated, to remount the preview. */
  revision: number;
  viewport: AppTarget;
  onViewportChange: (target: AppTarget) => void;
  onPhase: (phase: BuildPhase) => void;
  onCompile?: (stats: PreviewCompileStats) => void;
  onFixError?: (errorText: string) => void;
}) {
  const [deviceView, setDeviceView] = useState(false);

  return (
    <div data-testid="apps-preview-pane" className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-9 items-center justify-between border-b px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Live Preview
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="device-view-toggle"
            onClick={() => setDeviceView((value) => !value)}
            aria-pressed={deviceView}
            className={`flex h-6 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-colors ${
              deviceView
                ? "border-accent/30 bg-accent/15 text-foreground"
                : "border-border/60 bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            <MonitorSmartphone aria-hidden="true" size={12} />
            Responsive Device View
          </button>
          {deviceView && (
            <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5">
              <button
                type="button"
                data-testid="viewport-mobile"
                onClick={() => onViewportChange("mobile")}
                className={`flex h-6 items-center gap-1 rounded px-2.5 text-[11px] font-medium transition-colors ${
                  viewport === "mobile" ? "bg-accent/20 text-foreground" : "text-muted-foreground"
                }`}
              >
                <Smartphone aria-hidden="true" size={12} />
                Mobile
              </button>
              <button
                type="button"
                data-testid="viewport-desktop"
                onClick={() => onViewportChange("desktop")}
                className={`flex h-6 items-center gap-1 rounded px-2.5 text-[11px] font-medium transition-colors ${
                  viewport === "desktop" ? "bg-accent/20 text-foreground" : "text-muted-foreground"
                }`}
              >
                <Monitor aria-hidden="true" size={12} />
                Desktop
              </button>
            </div>
          )}
        </div>
      </div>

      {!project ? (
        <div className="app-scrollbar flex-1 overflow-y-auto p-6">
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            {generating ? (
              <>
                <Loader2 aria-hidden="true" size={26} className="animate-spin text-accent" />
                <p className="text-xs font-medium text-foreground">Generating your app…</p>
                <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
                  The AI is writing real source files. The preview will compile and run them as soon
                  as they're ready.
                </p>
              </>
            ) : (
              <>
                <Monitor aria-hidden="true" size={26} className="text-muted-foreground/60" />
                <p className="text-xs font-medium text-foreground">No app yet</p>
                <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
                  Describe the app you want in the AI agent chat and the real generated app will run
                  right here.
                </p>
              </>
            )}
          </div>
        </div>
      ) : deviceView ? (
        <div className="flex flex-1 flex-col p-6">
          <DeviceFrame viewport={viewport}>
            <AppPreview
              project={project}
              revision={revision}
              onPhase={onPhase}
              onCompile={onCompile}
              onFixError={onFixError}
            />
          </DeviceFrame>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <AppPreview
            project={project}
            revision={revision}
            onPhase={onPhase}
            onCompile={onCompile}
            onFixError={onFixError}
          />
        </div>
      )}
    </div>
  );
}

/** Compiles and mounts the generated app into an isolated iframe. */
function AppPreview({
  project,
  revision,
  onPhase,
  onCompile,
  onFixError,
}: {
  project: AppProject;
  revision: number;
  onPhase: (phase: BuildPhase) => void;
  onCompile?: (stats: PreviewCompileStats) => void;
  onFixError?: (errorText: string) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"building" | "ready" | "error">("building");
  const [error, setError] = useState<string | null>(null);
  const [compileInfo, setCompileInfo] = useState<PreviewCompileStats | null>(null);

  const handleLoad = useCallback(() => {
    const frame = frameRef.current;
    if (!frame?.contentWindow || !frame.contentDocument) return;
    const doc = frame.contentDocument;
    const root = doc.getElementById("root") ?? doc.body;

    setStatus("building");
    setError(null);
    onPhase("transpiling");
    mountAppPreview({
      files: project.files,
      entry: project.entry,
      container: root,
      targetWindow: frame.contentWindow,
      onCompile: (stats) => {
        setCompileInfo(stats);
        onCompile?.(stats);
      },
    })
      .then(() => {
        setStatus("ready");
        onPhase("finalizing");
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus("error");
      });
  }, [project, onPhase]);

  // Surface runtime errors thrown asynchronously by the generated app.
  useEffect(() => {
    const frame = frameRef.current;
    const win = frame?.contentWindow;
    if (!win) return;
    const onError = (event: ErrorEvent) => {
      setError(`${project.name}: ${event.message || "the app crashed at runtime."}`);
      setStatus("error");
    };
    win.addEventListener("error", onError);
    return () => win.removeEventListener("error", onError);
  }, [project]);

  return (
    <div className="relative h-full w-full" data-testid="live-preview">
      <iframe
        key={`${project.name}-${revision}`}
        ref={frameRef}
        title={`${project.name} preview`}
        className="h-full w-full border-0 bg-white"
        srcDoc='<!doctype html><html><head><meta charset="utf-8" /><style>html,body,#root{height:100%;margin:0}body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif}</style></head><body><div id="root"></div></body></html>'
        onLoad={handleLoad}
      />
      {status === "building" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40">
          <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-[11px] text-muted-foreground shadow-lg">
            <Loader2 aria-hidden="true" size={12} className="animate-spin" />
            Compiling…
          </div>
        </div>
      )}
      {compileInfo && status !== "error" && (
        <div className="pointer-events-none absolute right-2 top-2 rounded border bg-background/85 px-2 py-1 font-mono text-[9px] text-muted-foreground">
          compiled {compileInfo.compiled} · cached {compileInfo.cacheHits} ·{" "}
          {Math.round(compileInfo.elapsedMs)}ms
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/95 p-6 text-center">
          <TriangleAlert aria-hidden="true" size={22} className="text-red-500" />
          <p className="text-xs font-semibold text-foreground">
            This app couldn't run in the preview
          </p>
          <p className="max-h-32 max-w-md overflow-y-auto text-[11px] leading-relaxed text-muted-foreground">
            {error}
          </p>
          <p className="text-[10px] text-muted-foreground/80">
            You can still browse the code and export the project.
          </p>
          {onFixError && (
            <button
              type="button"
              onClick={() => onFixError(error ?? "")}
              data-testid="fix-with-ai"
              className="mt-1 inline-flex h-7 items-center gap-1.5 rounded-md bg-foreground px-3 text-[11px] font-medium text-background transition-opacity hover:opacity-85"
            >
              Fix with AI
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DeviceFrame({ viewport, children }: { viewport: AppTarget; children: React.ReactNode }) {
  if (viewport === "mobile") {
    return (
      <div className="mx-auto flex w-[min(27rem,100%)] flex-1 flex-col overflow-hidden rounded-[2rem] border border-border/70 bg-background shadow-xl">
        <div className="flex h-6 shrink-0 items-center justify-center border-b border-border/40 bg-background/80">
          <div className="h-1.5 w-14 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="min-h-0 flex-1 text-left">{children}</div>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-background shadow-lg">
      <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border/40 bg-background/80 px-3">
        <span className="h-2 w-2 rounded-full bg-[#ff5f57]" />
        <span className="h-2 w-2 rounded-full bg-[#febc2e]" />
        <span className="h-2 w-2 rounded-full bg-[#28c840]" />
        <span className="ml-2 flex-1 truncate rounded bg-hover/12 px-2 py-0.5 text-[9px] font-mono text-muted-foreground">
          http://localhost:5173
        </span>
      </div>
      <div className="min-h-0 flex-1 text-left">{children}</div>
    </div>
  );
}

/** Right pane — generated file explorer + read-only code preview. */
function FilesPane({
  files,
  selectedFile,
  onSelectFile,
  showLineNumbers = true,
}: {
  files: AppGeneratedFile[];
  selectedFile: string;
  onSelectFile: (path: string) => void;
  showLineNumbers?: boolean;
}) {
  const active = files.find((file) => file.path === selectedFile) ?? files[0];

  return (
    <div
      data-testid="apps-explorer-pane"
      className="flex min-w-0 shrink-0 basis-[clamp(17rem,18%,20rem)] flex-col border-l bg-card"
    >
      <div className="flex h-9 items-center justify-between border-b px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Explorer
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {files.length} {files.length === 1 ? "file" : "files"} · read-only
        </span>
      </div>
      <FileTree files={files} selectedPath={active?.path ?? ""} onSelect={onSelectFile} />
      <div className="flex min-h-0 flex-1 flex-col border-t">
        <div className="flex h-9 shrink-0 items-center justify-between border-b px-3">
          <span className="text-[11px] font-medium text-foreground">{active?.path}</span>
        </div>
        {active ? (
          <HighlightedCode
            path={active.path}
            code={active.content}
            showLineNumbers={showLineNumbers}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
            Generate an app to explore its project files.
          </div>
        )}
      </div>
    </div>
  );
}
