import type {
  Part,
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
  SessionStatus,
  Todo,
} from "@opencode-ai/sdk/v2/client";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { HighlightLanguage } from "@/components/SyntaxHighlightedOutput";
import { RobloxInstanceCard } from "@/components/RobloxInstanceCard";

/** Module-level constant to avoid creating a new array on every render. */
const REMARK_PLUGINS = [remarkGfm];
const INSTANCE_REFERENCE_PATTERN = /<Instance reference="([^"]+)">([^<]+)<\/Instance>/g;
const SyntaxHighlightedOutput = lazy(() => import("@/components/SyntaxHighlightedOutput"));
const HIGHLIGHT_LANGUAGE_ALIASES: Record<string, HighlightLanguage> = {
  bash: "bash",
  sh: "bash",
  shell: "bash",
  diff: "diff",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  lua: "lua",
  luau: "lua",
  shellsession: "shellsession",
  console: "shellsession",
  typescript: "typescript",
  ts: "typescript",
  tsx: "tsx",
  jsx: "tsx",
};

import { useAnswerQuestion, useRejectQuestion } from "@/hooks/mutations/useAnswerQuestion";
import { useReplyPermission } from "@/hooks/mutations/useReplyPermission";
import { useMessage, useMessageIds } from "@/hooks/useMessages";
import { useActivePermission } from "@/hooks/usePermissions";
import { useActiveQuestion } from "@/hooks/useQuestions";
import { useSessionError } from "@/hooks/useSessionError";
import { useSessionStatus } from "@/hooks/useSessionStatuses";
import { useTodos } from "@/hooks/useTodos";
import { type ModelError, presentModelError } from "@/lib/modelError";
import { getOpenCodeUsageAction, type OpenCodeUsageAction } from "@/lib/usageLimit";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import type { MessageWithParts } from "@/types";

// ── Image lightbox ───────────────────────────────────────────────────────

interface LightboxState {
  urls: string[];
  index: number;
}

/** Module-level lightbox setter  - avoids prop drilling through memoized bubbles. */
let setLightboxState: ((state: LightboxState | null) => void) | null = null;

function openLightbox(urls: string[], index: number) {
  setLightboxState?.({ urls, index });
}

const ImageLightbox = memo(function ImageLightbox() {
  const [state, setState] = useState<LightboxState | null>(null);
  const [slideDir, setSlideDir] = useState<"left" | "right" | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const isOpen = state !== null;

  useEffect(() => {
    setLightboxState = setState;
    return () => {
      setLightboxState = null;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setState(null);
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        setState((s) => {
          if (!s || s.urls.length <= 1) return s;
          setSlideDir("left");
          setAnimKey((k) => k + 1);
          return { ...s, index: (s.index + 1) % s.urls.length };
        });
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        setState((s) => {
          if (!s || s.urls.length <= 1) return s;
          setSlideDir("right");
          setAnimKey((k) => k + 1);
          return { ...s, index: (s.index - 1 + s.urls.length) % s.urls.length };
        });
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  if (!state) return null;

  const { urls, index } = state;
  const hasMultiple = urls.length > 1;

  function goNext(e: React.MouseEvent) {
    e.stopPropagation();
    setSlideDir("left");
    setAnimKey((k) => k + 1);
    setState((s) => s && { ...s, index: (s.index + 1) % s.urls.length });
  }

  function goPrev(e: React.MouseEvent) {
    e.stopPropagation();
    setSlideDir("right");
    setAnimKey((k) => k + 1);
    setState((s) => s && { ...s, index: (s.index - 1 + s.urls.length) % s.urls.length });
  }

  const slideClass =
    slideDir === "left"
      ? "animate-lightbox-slide-left"
      : slideDir === "right"
        ? "animate-lightbox-slide-right"
        : "animate-lightbox-image";

  return (
    <div
      className="animate-lightbox-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={() => setState(null)}
    >
      <button
        onClick={() => setState(null)}
        className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {hasMultiple && (
        <button
          onClick={goPrev}
          className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:scale-110 hover:bg-white/20"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}

      <img
        key={animKey}
        src={urls[index]}
        alt={`Attachment ${index + 1} of ${urls.length}`}
        className={`max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl ${slideClass}`}
        onClick={(e) => e.stopPropagation()}
      />

      {hasMultiple && (
        <button
          onClick={goNext}
          className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:scale-110 hover:bg-white/20"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {hasMultiple && (
        <div className="animate-fade-in-up absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur-sm">
          {index + 1} / {urls.length}
        </div>
      )}
    </div>
  );
});

// ── Inline BloxMind thinking indicator ────────────────────────────────────

function BloxMindThinking({ label = "Thinking..." }: { label?: string }) {
  return (
    <div className="flex min-h-[21px] items-center gap-2 text-[13px] leading-relaxed text-muted-foreground">
      <svg
        width="20"
        height="20"
        viewBox="0 0 512 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="BloxMind-face-think shrink-0"
        aria-hidden="true"
      >
        <rect
          x="32"
          y="32"
          width="448"
          height="448"
          rx="112"
          fill="currentColor"
          className="text-foreground"
        />
        <rect
          className="BloxMind-eye"
          x="144"
          y="176"
          width="72"
          height="72"
          rx="24"
          fill="var(--background)"
        />
        <rect
          className="BloxMind-eye"
          x="296"
          y="176"
          width="72"
          height="72"
          rx="24"
          fill="var(--background)"
        />
        <path
          d="M168 328C168 328 204.8 376 256 376C307.2 376 344 328 344 328"
          stroke="var(--background)"
          strokeWidth="32"
          strokeLinecap="round"
        />
      </svg>
      <span>{label}</span>
      <span className="flex gap-0.5">
        <span className="BloxMind-dot h-1 w-1 rounded-full bg-foreground/20" />
        <span className="BloxMind-dot h-1 w-1 rounded-full bg-foreground/20 [animation-delay:150ms]" />
        <span className="BloxMind-dot h-1 w-1 rounded-full bg-foreground/20 [animation-delay:300ms]" />
      </span>
    </div>
  );
}

// ── Constants ───────────────────────────────────────────────────────────

// ── Helpers ─────────────────────────────────────────────────────────────

function baseToolName(tool: string): string {
  return tool.replace(/^mcp_[^_]+_/, "");
}

function inputField(input: Record<string, unknown>, key: string): string {
  const val = input[key];
  if (typeof val === "string") return val;
  if (val !== undefined && val !== null) return JSON.stringify(val);
  return "";
}

// ── Tool-specific renderers ─────────────────────────────────────────────
// (These are unchanged from the original  - they don't use the store)

const BashToolView = memo(function BashToolView({
  input,
  output,
  status,
}: {
  input: Record<string, unknown>;
  output?: string;
  status: string;
}) {
  const command = inputField(input, "command");
  const description = inputField(input, "description");
  return (
    <div>
      {description && <div className="mb-1 text-[11px] text-muted-foreground">{description}</div>}
      {command && (
        <Suspense fallback={<span className="block truncate">$ {command}</span>}>
          <span className="sr-only">{command}</span>
          <SyntaxHighlightedOutput code={`$ ${command}`} language="shellsession" />
        </Suspense>
      )}
      {status === "completed" && output && (
        <InlineDisclosure
          text={output.slice(0, 3000)}
          tone="output"
          previewLines={3}
          language="shellsession"
        />
      )}
      {status === "running" && (
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400">
          <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-amber-400" />
          Running...
        </div>
      )}
    </div>
  );
});

const DiffBlock = memo(function DiffBlock({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  const oldLines = oldStr ? oldStr.split("\n") : [];
  const newLines = newStr ? newStr.split("\n") : [];
  const diffText = [
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ].join("\n");
  return <InlineDisclosure text={diffText} tone="output" previewLines={3} language="diff" />;
});

const EditToolView = memo(function EditToolView({
  input,
  output,
  status,
}: {
  input: Record<string, unknown>;
  output?: string;
  status: string;
}) {
  const filePath = inputField(input, "filePath");
  const oldStr = inputField(input, "oldString");
  const newStr = inputField(input, "newString");
  const shortPath = filePath.split("/").slice(-3).join("/");
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px]">
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted-foreground"
        >
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
        <span className="font-mono text-muted-foreground" title={filePath}>
          {shortPath}
        </span>
      </div>
      {(oldStr || newStr) && <DiffBlock oldStr={oldStr} newStr={newStr} />}
      {status === "completed" && output && (
        <InlineDisclosure text={output} tone="output" previewLines={3} />
      )}
    </div>
  );
});

const ReadToolView = memo(function ReadToolView({
  input,
  status,
}: {
  input: Record<string, unknown>;
  status: string;
}) {
  const filePath = inputField(input, "filePath");
  const shortPath = filePath.split("/").slice(-3).join("/");
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-muted-foreground"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <span className="font-mono text-muted-foreground" title={filePath}>
        {shortPath}
      </span>
      {status === "running" && (
        <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-amber-400" />
      )}
    </div>
  );
});

const WriteToolView = memo(function WriteToolView({
  input,
  status,
}: {
  input: Record<string, unknown>;
  status: string;
}) {
  const filePath = inputField(input, "filePath");
  const shortPath = filePath.split("/").slice(-3).join("/");
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-emerald-600"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="12" y1="18" x2="12" y2="12" />
        <line x1="9" y1="15" x2="15" y2="15" />
      </svg>
      <span className="font-mono text-muted-foreground" title={filePath}>
        {shortPath}
      </span>
      {status === "running" && (
        <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-amber-400" />
      )}
    </div>
  );
});

const GlobToolView = memo(function GlobToolView({
  input,
  status,
}: {
  input: Record<string, unknown>;
  status: string;
}) {
  const pattern = inputField(input, "pattern");
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-muted-foreground"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <span className="font-mono text-muted-foreground">{pattern}</span>
      {status === "running" && (
        <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-amber-400" />
      )}
    </div>
  );
});

const GrepToolView = memo(function GrepToolView({
  input,
  status,
}: {
  input: Record<string, unknown>;
  status: string;
}) {
  const pattern = inputField(input, "pattern");
  const include = inputField(input, "include");
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-muted-foreground"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <span className="font-mono text-muted-foreground">
        /{pattern}/{include ? ` in ${include}` : ""}
      </span>
      {status === "running" && (
        <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-amber-400" />
      )}
    </div>
  );
});

const TaskToolView = memo(function TaskToolView({
  input,
  status,
}: {
  input: Record<string, unknown>;
  status: string;
}) {
  const description = inputField(input, "description");
  const agentType = inputField(input, "subagent_type");
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-violet-500"
      >
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
      <span className="text-muted-foreground">
        {description || "Subtask"}
        {agentType && <span className="ml-1 text-[10px] text-violet-500">({agentType})</span>}
      </span>
      {status === "running" && (
        <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-violet-400" />
      )}
    </div>
  );
});

const WebFetchToolView = memo(function WebFetchToolView({
  input,
  status,
}: {
  input: Record<string, unknown>;
  status: string;
}) {
  const url = inputField(input, "url");
  let displayUrl = url;
  try {
    const parsed = new URL(url);
    displayUrl = parsed.hostname + (parsed.pathname !== "/" ? parsed.pathname : "");
  } catch {
    /* use raw */
  }
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-muted-foreground"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      <span className="font-mono text-muted-foreground" title={url}>
        {displayUrl}
      </span>
      {status === "running" && (
        <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-amber-400" />
      )}
    </div>
  );
});

const TodoWriteToolView = memo(function TodoWriteToolView({
  input,
}: {
  input: Record<string, unknown>;
}) {
  const rawTodos = input.todos;
  if (!Array.isArray(rawTodos)) return null;
  const items = rawTodos as Todo[];
  return (
    <div className="space-y-0.5">
      {items.map((todo, idx) => (
        <div key={idx} className="flex items-start gap-1.5 text-[11px]">
          <span className="mt-px shrink-0">
            {todo.status === "completed" ? (
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-emerald-500"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : todo.status === "in_progress" ? (
              <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full border-2 border-amber-400" />
            ) : todo.status === "cancelled" ? (
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-muted-foreground"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-muted-foreground/40" />
            )}
          </span>
          <span
            className={
              todo.status === "completed"
                ? "text-muted-foreground line-through"
                : todo.status === "cancelled"
                  ? "text-muted-foreground/50 line-through"
                  : "text-foreground"
            }
          >
            {todo.content}
          </span>
        </div>
      ))}
    </div>
  );
});

const DefaultToolView = memo(function DefaultToolView({
  tool,
  input,
  output,
  status,
}: {
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  status: string;
}) {
  const title = "title" in input ? inputField(input, "title") : "";
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5 text-[13px] leading-relaxed">
        <span className="min-w-0 break-all font-medium text-muted-foreground/75 transition-colors hover:text-muted-foreground">
          {tool}
        </span>
        {title && <span className="min-w-0 break-words text-muted-foreground">- {title}</span>}
        {status === "running" && (
          <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-amber-400" />
        )}
      </div>
      {status === "completed" && output && (
        <InlineDisclosure
          text={
            typeof output === "string"
              ? output.slice(0, 2000)
              : JSON.stringify(output, null, 2).slice(0, 2000)
          }
          tone="output"
          previewLines={3}
        />
      )}
    </div>
  );
});

// ── Part renderers ─────────────────────────────────────────────────────

const markdownComponents: Components = {
  p({ children }) {
    return <p className="mb-2 last:mb-0">{children}</p>;
  },
  h1({ children }) {
    return <h1 className="mb-2 mt-4 first:mt-0 text-lg font-semibold">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="mb-2 mt-3 first:mt-0 text-base font-semibold">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="mb-1.5 mt-2.5 first:mt-0 text-sm font-semibold">{children}</h3>;
  },
  h4({ children }) {
    return <h4 className="mb-1 mt-2 first:mt-0 text-[13px] font-semibold">{children}</h4>;
  },
  ul({ children }) {
    return <ul className="mb-2 ml-4 list-disc space-y-0.5 last:mb-0">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="mb-2 ml-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>;
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
        className="text-blue-600 underline decoration-blue-300 underline-offset-2 hover:text-blue-800 hover:decoration-blue-500"
      >
        {children}
      </a>
    );
  },
  strong({ children }) {
    return <strong className="font-semibold">{children}</strong>;
  },
  em({ children }) {
    return <em>{children}</em>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="mb-2 border-l-2 border-border pl-3 text-muted-foreground last:mb-0">
        {children}
      </blockquote>
    );
  },
  hr() {
    return <hr className="my-3 border-border" />;
  },
  code({ className, children }) {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      const lang = className?.replace("language-", "") ?? "";
      const language = HIGHLIGHT_LANGUAGE_ALIASES[lang.toLowerCase()];
      const code = String(children).replace(/\n$/, "");
      return (
        <div className="mb-2 min-w-0 overflow-hidden pl-3 last:mb-0">
          {lang && (
            <div className="mb-1 text-[11px] font-medium text-muted-foreground/60">{lang}</div>
          )}
          {language ? (
            <Suspense
              fallback={
                <pre className="app-scrollbar overflow-x-auto font-mono text-[13px] leading-relaxed text-muted-foreground/80">
                  {code}
                </pre>
              }
            >
              <SyntaxHighlightedOutput code={code} language={language} />
            </Suspense>
          ) : (
            <pre className="app-scrollbar overflow-x-auto font-mono text-[13px] leading-relaxed text-muted-foreground/80">
              {code}
            </pre>
          )}
        </div>
      );
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px] text-foreground">
        {children}
      </code>
    );
  },
  pre({ children }) {
    return <>{children}</>;
  },
  table({ children }) {
    return (
      <div className="mb-2 overflow-x-auto last:mb-0">
        <table className="min-w-full border-collapse text-[12px]">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="border-b border-border bg-muted">{children}</thead>;
  },
  th({ children }) {
    return <th className="px-2 py-1 text-left font-semibold text-foreground">{children}</th>;
  },
  td({ children }) {
    return <td className="border-t border-border px-2 py-1 text-foreground">{children}</td>;
  },
};

function decodeReference(value: string) {
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

function MessageText({ text }: { text: string }) {
  const parts: Array<{ type: "text" | "instance"; value: string; label?: string }> = [];
  let cursor = 0;
  for (const match of text.matchAll(INSTANCE_REFERENCE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ type: "text", value: text.slice(cursor, index) });
    parts.push({ type: "instance", value: decodeReference(match[1]), label: match[2] });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push({ type: "text", value: text.slice(cursor) });

  return parts.map((part, index) =>
    part.type === "instance" ? (
      <span
        key={`${part.value}:${index}`}
        className="mx-0.5 inline-flex items-center rounded-md border border-blue-500/25 bg-blue-500/10 px-1.5 py-0.5 align-baseline text-[11px] font-medium text-blue-700 dark:text-blue-300"
        title={part.value}
      >
        {part.label}
      </span>
    ) : (
      <Markdown key={index} remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>
        {part.value}
      </Markdown>
    ),
  );
}

const TextPartView = memo(
  function TextPartView({ part }: { part: Extract<Part, { type: "text" }> }) {
    return (
      <div className="text-[13px] leading-relaxed">
        <MessageText text={part.text} />
      </div>
    );
  },
  (prev, next) => prev.part.text === next.part.text,
);

function InlineDisclosure({
  text,
  tone = "reasoning",
  previewLines = 1,
  language,
}: {
  text: string;
  tone?: "reasoning" | "error" | "output";
  previewLines?: number;
  language?: HighlightLanguage;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const formatted = useMemo(() => {
    if (tone !== "output") return { text, structured: false };
    const trimmed = text.trim();
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
      return { text, structured: false };
    }
    try {
      const value: unknown = JSON.parse(trimmed);
      if (value === null || typeof value !== "object") return { text, structured: false };
      return { text: JSON.stringify(value, null, 2), structured: true };
    } catch {
      return { text, structured: false };
    }
  }, [text, tone]);
  const toneClass =
    tone === "error"
      ? "text-[#d73a49]/60 hover:text-[#d73a49]/85 dark:text-[#ff7b72]/55 dark:hover:text-[#ff7b72]/80"
      : tone === "output"
        ? "text-muted-foreground/70 opacity-70 hover:text-muted-foreground hover:opacity-100"
        : "text-muted-foreground/55 hover:text-muted-foreground";
  return (
    <div data-preserve-scroll className={`min-w-0 ${tone === "output" ? "pl-3" : ""}`}>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={`block w-full min-w-0 text-left text-[13px] leading-relaxed transition-colors ${toneClass}`}
      >
        {formatted.structured || language ? (
          <Suspense fallback={<span className="line-clamp-3">{formatted.text}</span>}>
            <span
              className={`block ${isOpen ? "animate-disclosure-expand" : "animate-disclosure-collapse"}`}
            >
              <SyntaxHighlightedOutput
                code={formatted.text}
                collapsed={!isOpen}
                language={language ?? "json"}
              />
            </span>
          </Suspense>
        ) : (
          <span
            className={
              isOpen
                ? "animate-disclosure-expand block whitespace-pre-wrap break-all"
                : previewLines === 1
                  ? "animate-disclosure-collapse block truncate"
                  : "animate-disclosure-collapse line-clamp-3 whitespace-pre-wrap"
            }
          >
            {formatted.text}
          </span>
        )}
      </button>
    </div>
  );
}

const ReasoningPartView = memo(function ReasoningPartView({
  part,
}: {
  part: Extract<Part, { type: "reasoning" }>;
}) {
  if (!part.text) return null;
  return <InlineDisclosure text={part.text} />;
});

const ToolPartView = memo(function ToolPartView({
  part,
}: {
  part: Extract<Part, { type: "tool" }>;
}) {
  const status = part.state.status;
  const input = part.state.input ?? {};
  const output = status === "completed" && "output" in part.state ? part.state.output : undefined;
  const errorMsg =
    status === "error" && "error" in part.state ? String(part.state.error) : undefined;
  const title =
    (status === "running" || status === "completed") && "title" in part.state
      ? part.state.title
      : undefined;
  const tool = baseToolName(part.tool);

  if (errorMsg) {
    return <InlineDisclosure text={errorMsg} tone="error" />;
  }

  function renderToolContent() {
    switch (tool) {
      case "bash":
        return <BashToolView input={input} output={output} status={status} />;
      case "edit":
        return <EditToolView input={input} output={output} status={status} />;
      case "read":
        return <ReadToolView input={input} status={status} />;
      case "write":
        return <WriteToolView input={input} status={status} />;
      case "glob":
        return <GlobToolView input={input} status={status} />;
      case "grep":
        return <GrepToolView input={input} status={status} />;
      case "task":
        return <TaskToolView input={input} status={status} />;
      case "webfetch":
        return <WebFetchToolView input={input} status={status} />;
      case "todowrite":
        return <TodoWriteToolView input={input} />;
      case "inspect_instance":
        return <RobloxInstanceCard output={typeof output === "string" ? output : JSON.stringify(output, null, 2)} />;
      default:
        return <DefaultToolView tool={tool} input={input} output={output} status={status} />;
    }
  }

  return (
    <div className="min-w-0 max-w-full overflow-hidden">
      {title &&
        ![
          "bash",
          "edit",
          "read",
          "write",
          "glob",
          "grep",
          "task",
          "webfetch",
          "todowrite",
        ].includes(tool) && (
          <div className="mb-1 break-words text-[11px] font-medium text-foreground">{title}</div>
        )}
      {renderToolContent()}
    </div>
  );
});

const StepPartView = memo(function StepPartView() {
  return <div className="h-6" aria-hidden="true" />;
});

const StepFinishPartView = memo(function StepFinishPartView({
  part,
}: {
  part: Extract<Part, { type: "step-finish" }>;
}) {
  const { tokens, cost } = part;
  return (
    <div className="my-1 flex flex-wrap items-center gap-1.5">
      {cost > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium tabular-nums text-muted-foreground">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
          {cost.toFixed(4)}
        </span>
      )}
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[9px] font-medium tabular-nums text-blue-600 dark:text-blue-400">
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        {tokens.input.toLocaleString()} in
      </span>
      <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-0.5 text-[9px] font-medium tabular-nums text-purple-600 dark:text-purple-400">
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        {tokens.output.toLocaleString()} out
      </span>
      {tokens.cache.read > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium tabular-nums text-amber-600 dark:text-amber-400">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg>
          {tokens.cache.read.toLocaleString()} cached
        </span>
      )}
    </div>
  );
});

const RetryPartView = memo(function RetryPartView({
  part,
}: {
  part: Extract<Part, { type: "retry" }>;
}) {
  return (
    <div className="my-1 flex items-center gap-1.5 text-[13px] leading-relaxed text-[#9a6700]/75 dark:text-[#d29922]/75">
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
      Retrying (attempt {part.attempt})
      {"error" in part && part.error?.data && "message" in part.error.data && (
        <span className="min-w-0 truncate opacity-80"> - {String(part.error.data.message)}</span>
      )}
    </div>
  );
});

const CompactionPartView = memo(function CompactionPartView() {
  return (
    <div className="my-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <svg
        width="9"
        height="9"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="4 14 10 14 10 20" />
        <polyline points="20 10 14 10 14 4" />
        <line x1="14" y1="10" x2="21" y2="3" />
        <line x1="3" y1="21" x2="10" y2="14" />
      </svg>
      Context compacted
    </div>
  );
});

const ModelErrorCard = memo(function ModelErrorCard({ error }: { error: ModelError }) {
  const presentation = presentModelError(error);

  return (
    <div role="alert" className="my-1 text-[#cf222e]/75 dark:text-[#ff7b72]/70">
      <div className="flex min-w-0 items-start gap-2">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-0.5 shrink-0"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div className="min-w-0">
          <div className="text-[13px] font-medium leading-relaxed">{presentation.title}</div>
          <div className="text-[13px] leading-relaxed opacity-80">{presentation.description}</div>
          {presentation.detail && presentation.detail !== presentation.description && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[13px] opacity-55 transition-opacity hover:opacity-100">
                Provider details
              </summary>
              <div className="mt-1 break-words pl-3 font-mono text-[13px] leading-relaxed opacity-70">
                {presentation.detail.slice(0, 1000)}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
});

const USAGE_LIMIT_WINDOW = 24 * 60 * 60 * 1000;

function usageLimitStorageKeys(action: OpenCodeUsageAction) {
  const suffix = action.reason === "free_tier_limit" ? "free-tier" : "account-rate-limit";
  return {
    seen: `BloxMind:usage-limit:${suffix}:seen`,
    hidden: `BloxMind:usage-limit:${suffix}:hidden`,
  };
}

function shouldShowUsageLimitDialog(action: OpenCodeUsageAction): boolean {
  const keys = usageLimitStorageKeys(action);
  if (window.localStorage.getItem(keys.hidden) === "true") return false;
  const seen = Number(window.localStorage.getItem(keys.seen));
  return !Number.isFinite(seen) || seen === 0 || Date.now() - seen >= USAGE_LIMIT_WINDOW;
}

const UsageLimitDialog = memo(function UsageLimitDialog({
  action,
}: {
  action: OpenCodeUsageAction;
}) {
  const [open, setOpen] = useState(() => shouldShowUsageLimitDialog(action));
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = "usage-limit-dialog-title";
  const descriptionId = "usage-limit-dialog-description";

  const close = useCallback(
    (dontShowAgain: boolean) => {
      const keys = usageLimitStorageKeys(action);
      window.localStorage.setItem(keys.seen, String(Date.now()));
      if (dontShowAgain) window.localStorage.setItem(keys.hidden, "true");
      setOpen(false);
    },
    [action],
  );

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none bg-transparent p-4 backdrop:bg-black/40"
      onCancel={(event) => {
        event.preventDefault();
        close(false);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close(false);
      }}
    >
      <div className="absolute left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-5 text-foreground shadow-2xl">
        <h2 id={titleId} className="text-sm font-semibold">
          {action.title}
        </h2>
        <p id={descriptionId} className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {action.message}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => close(true)}
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Don't show again
          </button>
          {action.link ? (
            <a
              href={action.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => close(false)}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
            >
              {action.label}
            </a>
          ) : (
            <button
              type="button"
              onClick={() => close(false)}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
            >
              {action.label}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
});

// ── Collapsible thinking block ──────────────────────────────────────────

const ThinkingBlock = memo(function ThinkingBlock({ parts }: { parts: Part[] }) {
  const [isOpen, setIsOpen] = useState(false);

  if (parts.length === 0) return null;

  // Collect tool names for the summary
  const toolNames = parts
    .filter((p) => p.type === "tool")
    .map((p) => baseToolName((p as Extract<Part, { type: "tool" }>).tool))
    .filter((name, idx, arr) => arr.indexOf(name) === idx); // dedupe

  const hasTools = toolNames.length > 0;
  const hasReasoning = parts.some((p) => p.type === "reasoning");
  const hasSteps = parts.some((p) => p.type === "step-start" || p.type === "step-finish");

  if (!hasTools && !hasReasoning && !hasSteps) return null;

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
        <span className="font-medium">
          {hasTools ? `Thought process` : "Reasoning"}
          {hasTools && (
            <span className="ml-1 text-muted-foreground/60">
              ({toolNames.join(", ")})
            </span>
          )}
        </span>
      </button>
      {isOpen && (
        <div className="mt-1.5 space-y-1.5 border-l-2 border-muted pl-3">
          {parts.map((part) => {
            switch (part.type) {
              case "reasoning":
                return <ReasoningPartView key={part.id} part={part as Extract<Part, { type: "reasoning" }>} />;
              case "tool":
                return <ToolPartView key={part.id} part={part as Extract<Part, { type: "tool" }>} />;
              case "step-start":
                return <StepPartView key={part.id} />;
              case "step-finish":
                return <StepFinishPartView key={part.id} part={part as Extract<Part, { type: "step-finish" }>} />;
              case "retry":
                return <RetryPartView key={part.id} part={part as Extract<Part, { type: "retry" }>} />;
              case "compaction":
                return <CompactionPartView key={part.id} />;
              default:
                return null;
            }
          })}
        </div>
      )}
    </div>
  );
});

// ── Smart part renderer: groups thinking parts, renders text outside ────

const SmartPartsRenderer = memo(function SmartPartsRenderer({ parts }: { parts: Part[] }) {
  // Separate parts into thinking groups and text parts
  const thinkingParts: Part[] = [];
  const textParts: Part[] = [];

  for (const part of parts) {
    if (part.type === "text") {
      textParts.push(part);
    } else if (
      part.type === "reasoning" ||
      part.type === "tool" ||
      part.type === "step-start" ||
      part.type === "step-finish" ||
      part.type === "retry" ||
      part.type === "compaction"
    ) {
      thinkingParts.push(part);
    }
  }

  return (
    <>
      {thinkingParts.length > 0 && <ThinkingBlock parts={thinkingParts} />}
      {textParts.map((part) => (
        <TextPartView key={part.id} part={part as Extract<Part, { type: "text" }>} />
      ))}
    </>
  );
});

// ── Inline todo panel ───────────────────────────────────────────────────

const TodoPanel = memo(function TodoPanel({ todos }: { todos: Todo[] }) {
  if (todos.length === 0) return null;
  const completed = todos.filter((t) => t.status === "completed").length;
  const total = todos.length;
  return (
    <div className="animate-fade-in my-2 rounded-lg border bg-card px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-foreground">Tasks</span>
        <span className="text-[10px] text-muted-foreground">
          {completed}/{total}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }}
        />
      </div>
      <div className="mt-2 space-y-1">
        {todos.map((todo, idx) => (
          <div key={idx} className="flex items-start gap-1.5 text-[11px]">
            <span className="mt-0.5 shrink-0">
              {todo.status === "completed" ? (
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-emerald-500"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : todo.status === "in_progress" ? (
                <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full border-2 border-amber-400" />
              ) : todo.status === "cancelled" ? (
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-muted-foreground"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ) : (
                <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-muted-foreground/40" />
              )}
            </span>
            <span
              className={
                todo.status === "completed"
                  ? "text-muted-foreground line-through"
                  : todo.status === "cancelled"
                    ? "text-muted-foreground/50 line-through"
                    : "text-foreground"
              }
            >
              {todo.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

// ── Question prompt ─────────────────────────────────────────────────────

const QuestionPrompt = memo(function QuestionPrompt({
  question,
  onAnswer,
  onReject,
}: {
  question: QuestionRequest;
  onAnswer: (requestID: string, answers: QuestionAnswer[]) => void;
  onReject: (requestID: string) => void;
}) {
  const [customInputs, setCustomInputs] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Record<number, Set<string>>>({});

  function toggleOption(qIdx: number, label: string, multiple?: boolean) {
    setSelected((prev) => {
      const current = prev[qIdx] ?? new Set<string>();
      const next = new Set(current);
      if (next.has(label)) {
        next.delete(label);
      } else {
        if (!multiple) next.clear();
        next.add(label);
      }
      return { ...prev, [qIdx]: next };
    });
  }

  function submit() {
    const answers: QuestionAnswer[] = question.questions.map((_q, idx) => {
      const sel = selected[idx] ?? new Set<string>();
      const arr = [...sel];
      const custom = customInputs[idx]?.trim();
      if (custom) arr.push(custom);
      return arr;
    });
    onAnswer(question.id, answers);
  }

  return (
    <div className="animate-fade-in-up my-2 rounded-lg border border-blue-200 bg-blue-50/30 px-3 py-3">
      {question.questions.map((q, qIdx) => (
        <div key={qIdx} className={qIdx > 0 ? "mt-3 border-t border-blue-100 pt-3" : ""}>
          <div className="text-[11px] font-semibold text-foreground">{q.header}</div>
          <div className="mt-0.5 text-[12px] text-foreground">{q.question}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {q.options.map((opt) => {
              const isSelected = selected[qIdx]?.has(opt.label);
              return (
                <button
                  key={opt.label}
                  onClick={() => toggleOption(qIdx, opt.label, q.multiple)}
                  className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors ${isSelected ? "border-blue-400 bg-blue-100 text-blue-800 dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-300" : "border-border bg-card text-foreground hover:border-blue-300 hover:bg-blue-50 dark:hover:border-blue-700 dark:hover:bg-blue-950/30"}`}
                  title={opt.description}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {q.custom !== false && (
            <input
              type="text"
              placeholder="Type your own answer..."
              value={customInputs[qIdx] ?? ""}
              onChange={(e) => setCustomInputs((prev) => ({ ...prev, [qIdx]: e.target.value }))}
              className="mt-2 w-full rounded border border-border bg-background px-2 py-1 text-[11px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          )}
        </div>
      ))}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          className="rounded-md bg-foreground px-3 py-1 text-[11px] font-medium text-background transition-opacity hover:opacity-90"
        >
          Submit
        </button>
        <button
          type="button"
          onClick={() => onReject(question.id)}
          className="rounded-md px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
});

// ── Permission prompt ───────────────────────────────────────────────────

const PermissionPrompt = memo(function PermissionPrompt({
  permission,
  onReply,
}: {
  permission: PermissionRequest;
  onReply: (requestID: string, reply: "once" | "always" | "reject") => void;
}) {
  return (
    <div className="animate-fade-in-up my-2 rounded-lg border border-amber-200 bg-amber-50/30 px-3 py-3 dark:border-amber-900 dark:bg-amber-950/30">
      <div className="text-[11px] font-semibold text-foreground">Permission Required</div>
      <div className="mt-1 text-[12px] text-foreground">
        <span className="font-mono text-amber-700 dark:text-amber-400">
          {permission.permission}
        </span>
      </div>
      {permission.patterns.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {permission.patterns.map((p, i) => (
            <div key={i} className="font-mono text-[10px] text-muted-foreground">
              {p}
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onReply(permission.id, "once")}
          className="rounded-md bg-foreground px-3 py-1 text-[11px] font-medium text-background transition-opacity hover:opacity-90"
        >
          Allow Once
        </button>
        <button
          type="button"
          onClick={() => onReply(permission.id, "always")}
          className="rounded-md border px-3 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
        >
          Always Allow
        </button>
        <button
          type="button"
          onClick={() => onReply(permission.id, "reject")}
          className="rounded-md px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:text-destructive"
        >
          Deny
        </button>
      </div>
    </div>
  );
});

// ── User message parts ──────────────────────────────────────────────────

const UserPartsView = memo(
  function UserPartsView({ parts }: { parts: Part[] }) {
    const fileParts: Extract<Part, { type: "file" }>[] = [];
    const textParts: Extract<Part, { type: "text" }>[] = [];
    for (const p of parts) {
      if (p.type === "file") fileParts.push(p as Extract<Part, { type: "file" }>);
      else if (p.type === "text") textParts.push(p as Extract<Part, { type: "text" }>);
    }
    const fileUrls = fileParts.map((p) => p.url);
    return (
      <div className="text-[13px] leading-relaxed">
        {fileParts.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {fileParts.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => openLightbox(fileUrls, i)}
                className="block cursor-zoom-in overflow-hidden rounded-lg border border-white/20 transition-opacity hover:opacity-80"
              >
                <img
                  src={p.url}
                  alt={p.filename ?? "attachment"}
                  className="max-h-32 max-w-[200px] object-cover"
                />
              </button>
            ))}
          </div>
        )}
        {textParts.map((p) => (
          <span key={p.id} className="whitespace-pre-wrap">
            {p.text}
          </span>
        ))}
        {parts.length === 0 && <span className="italic opacity-50">...</span>}
      </div>
    );
  },
  (prev, next) => prev.parts === next.parts,
);

// ── Message bubble ─────────────────────────────────────────────────────

const MessageBubble = memo(function MessageBubble({ messageId }: { messageId: string }) {
  const msg = useMessage(messageId);
  const [copied, setCopied] = useState(false);
  const { activeSessionId } = useActiveSession();
  const queryClient = useQueryClient();
  const sessionStatus = useSessionStatus(activeSessionId);
  const isBusy = sessionStatus?.type === "busy";
  const messageIds = useMessageIds();

  const handleCopy = useCallback(() => {
    if (!msg) return;
    // Copy only the final user-facing response text.
    // Take the last text part to avoid including intermediate reasoning.
    const textParts = msg.parts.filter((p) => p.type === "text");
    const lastText = textParts[textParts.length - 1];
    if (!lastText) return;
    const text = (lastText as Extract<Part, { type: "text" }>).text.trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [msg]);

  // Auto-checkpoint: save current conversation state to localStorage with strict FIFO cap of 5
  const autoCheckpoint = useCallback(() => {
    if (!activeSessionId) return;
    const cache = queryClient.getQueryData<MessagesCache>(qk.messages(activeSessionId));
    if (!cache || cache.messageIds.length === 0) return;
    const listKey = `BloxMind:checkpoints:${activeSessionId}`;
    const totalKey = `BloxMind:checkpoints:total:${activeSessionId}`;
    const existing = JSON.parse(window.localStorage.getItem(listKey) ?? "[]") as string[];
    const newCheckpoint = JSON.stringify(cache);
    // Strict FIFO: append new, cap at 5 (oldest purged automatically)
    const updated = [...existing, newCheckpoint];
    if (updated.length > 5) {
      updated.shift(); // Remove oldest (FIFO)
    }
    window.localStorage.setItem(listKey, JSON.stringify(updated));
    // Track total created for offset calculation
    const totalCreated = parseInt(window.localStorage.getItem(totalKey) ?? "0") + 1;
    window.localStorage.setItem(totalKey, String(totalCreated));
  }, [activeSessionId, queryClient]);

  // Manual checkpoint (same as auto)
  const handleCheckpoint = useCallback(() => autoCheckpoint(), [autoCheckpoint]);

  // Restore: load a specific checkpoint by index from localStorage
  const handleRestoreCheckpoint = useCallback(
    (index?: number) => {
      if (!activeSessionId) return;
      const listKey = `BloxMind:checkpoints:${activeSessionId}`;
      const saved = JSON.parse(window.localStorage.getItem(listKey) ?? "[]") as string[];
      if (saved.length === 0) return;
      const targetIndex = index ?? saved.length - 1;
      if (targetIndex < 0 || targetIndex >= saved.length) return;
      try {
        const cache = JSON.parse(saved[targetIndex]) as MessagesCache;
        queryClient.setQueryData(qk.messages(activeSessionId), cache);
      } catch {
        // ignore invalid checkpoint data
      }
    },
    [activeSessionId, queryClient],
  );

  // Get checkpoint count for this session
  const checkpointCount = activeSessionId
    ? (JSON.parse(window.localStorage.getItem(`BloxMind:checkpoints:${activeSessionId}`) ?? "[]") as string[]).length
    : 0;

  if (!msg) return null;

  const isUser = msg.info.role === "user";
  const hasText = msg.parts.some((p) => p.type === "text");
  const isLastAssistant = !isUser && msg.info.id === messageIds[messageIds.length - 1];

  // Calculate which checkpoint index corresponds to this assistant message
  // Each user+assistant pair = 1 turn, so assistant at index i -> checkpoint floor(i/2)
  const messageIndex = isUser ? -1 : messageIds.indexOf(msg.info.id);
  const associatedCheckpointIndex = messageIndex >= 0 ? Math.floor(messageIndex / 2) : -1;
  const hasAssociatedCheckpoint = associatedCheckpointIndex >= 0 && associatedCheckpointIndex < checkpointCount;

  return (
    <div className={`animate-fade-in-up flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] ${isUser ? "rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-background" : "w-full"}`}
      >
        {isUser ? (
          <UserPartsView parts={msg.parts} />
        ) : (
          <div className="space-y-2">
            {msg.parts.length === 0 && <BloxMindThinking />}
            <SmartPartsRenderer parts={msg.parts} />
            {"error" in msg.info &&
              msg.info.error &&
              msg.info.error.name !== "MessageAbortedError" && (
                <ModelErrorCard error={msg.info.error} />
              )}
            {!isBusy && (
              <div className="flex items-center justify-end gap-1 pt-1">
                <button
                  type="button"
                  onClick={handleCheckpoint}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/40 transition-colors hover:text-muted-foreground hover:bg-accent/50 disabled:opacity-50"
                  title="Save checkpoint"
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                  <span>Checkpoint</span>
                </button>
                {hasAssociatedCheckpoint ? (
                  <button
                    type="button"
                    onClick={() => handleRestoreCheckpoint(associatedCheckpointIndex)}
                    disabled={isBusy}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/40 transition-colors hover:text-muted-foreground hover:bg-accent/50 disabled:opacity-50"
                    title={`Restore to checkpoint #${associatedCheckpointIndex + 1}`}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </svg>
                    <span>Restore #{associatedCheckpointIndex + 1}</span>
                  </button>
                ) : checkpointCount > 0 && isLastAssistant ? (
                  <button
                    type="button"
                    onClick={() => handleRestoreCheckpoint()}
                    disabled={isBusy}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/40 transition-colors hover:text-muted-foreground hover:bg-accent/50 disabled:opacity-50"
                    title={`Restore latest checkpoint (${checkpointCount} saved)`}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </svg>
                    <span>Restore ({checkpointCount})</span>
                  </button>
                ) : null}
                {hasText && (
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/40 transition-colors hover:text-muted-foreground hover:bg-accent/50"
                    title="Copy message"
                  >
                    {copied ? (
                      <>
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-emerald-500"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span className="text-emerald-500">Copied</span>
                      </>
                    ) : (
                      <>
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// ── Main component ─────────────────────────────────────────────────────

const BusyThinkingIndicator = memo(function BusyThinkingIndicator({
  status,
  lastMessage,
}: {
  status: SessionStatus | undefined;
  lastMessage: MessageWithParts | undefined;
}) {
  if (status?.type !== "busy" || !lastMessage || lastMessage.info.role !== "user") return null;
  return <BloxMindThinking />;
});

function ChatMessages() {
  const messageIds = useMessageIds();
  const lastMessage = useMessage(messageIds[messageIds.length - 1] ?? "");
  const sessionError = useSessionError();
  const { activeSessionId } = useActiveSession();
  const queryClient = useQueryClient();
  const sessionStatus = useSessionStatus(activeSessionId);
  const isBusy = sessionStatus !== undefined && sessionStatus.type !== "idle";
  const usageAction = getOpenCodeUsageAction(sessionStatus);
  const todos = useTodos();
  const activeQuestion = useActiveQuestion();
  const activePermission = useActivePermission();
  const lastMessageHasError =
    lastMessage?.info.role === "assistant" && Boolean(lastMessage.info.error);
  const answerQuestion = useAnswerQuestion();
  const rejectQuestion = useRejectQuestion();
  const replyPermission = useReplyPermission();

  // Auto-checkpoint: save state before each new user prompt (strict FIFO cap of 5)
  const prevMessageCountRef = useRef(0);
  useEffect(() => {
    if (!activeSessionId || messageIds.length === 0) return;
    // When a new message is added and the previous count was > 0, auto-checkpoint
    if (messageIds.length > prevMessageCountRef.current && prevMessageCountRef.current > 0) {
      const cache = queryClient.getQueryData<MessagesCache>(qk.messages(activeSessionId));
      if (cache && cache.messageIds.length > 0) {
        const listKey = `BloxMind:checkpoints:${activeSessionId}`;
        const totalKey = `BloxMind:checkpoints:total:${activeSessionId}`;
        const existing = JSON.parse(window.localStorage.getItem(listKey) ?? "[]") as string[];
        const newCheckpoint = JSON.stringify(cache);
        // Strict FIFO: append new, cap at 5 (oldest purged)
        const updated = [...existing, newCheckpoint];
        if (updated.length > 5) {
          updated.shift(); // Remove oldest (FIFO)
        }
        window.localStorage.setItem(listKey, JSON.stringify(updated));
        // Track total created for offset calculation
        const totalCreated = parseInt(window.localStorage.getItem(totalKey) ?? "0") + 1;
        window.localStorage.setItem(totalKey, String(totalCreated));
      }
    }
    prevMessageCountRef.current = messageIds.length;
  }, [messageIds.length, activeSessionId, queryClient]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  const virtualizer = useVirtualizer({
    count: messageIds.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 80,
    overscan: 5,
  });

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScroll.current = distanceFromBottom < 80;
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    const anchor = bottomRef.current;
    if (!el || !anchor) return;
    let rafId = 0;
    const observer = new MutationObserver((mutations) => {
      const onlyDisclosureChanges = mutations.every((mutation) => {
        const target =
          mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        return target?.closest("[data-preserve-scroll]") !== null;
      });
      if (onlyDisclosureChanges) return;
      if (!shouldAutoScroll.current) return;
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          anchor.scrollIntoView({ behavior: "instant" });
        });
      }
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional scroll triggers
  useEffect(() => {
    if (shouldAutoScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [isBusy, todos, activeQuestion, activePermission]);

  const handleAnswer = useCallback(
    (requestID: string, answers: QuestionAnswer[]) => answerQuestion.mutate({ requestID, answers }),
    [answerQuestion],
  );
  const handleReject = useCallback(
    (requestID: string) => rejectQuestion.mutate(requestID),
    [rejectQuestion],
  );
  const handleReplyPermission = useCallback(
    (requestID: string, reply: "once" | "always" | "reject") =>
      replyPermission.mutate({ requestID, reply }),
    [replyPermission],
  );

  if (messageIds.length === 0 && !isBusy && !sessionError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <ImageLightbox />
        <div className="animate-fade-in-up text-center">
          <h2 className="font-serif text-2xl italic text-foreground">
            What would you like to build?
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Ask me to create scripts, design game mechanics, or modify your Roblox Studio project.
          </p>
        </div>
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={containerRef}
      data-chat-scroll
      onScroll={handleScroll}
      className="app-scrollbar flex-1 overflow-y-auto [overflow-anchor:none]"
    >
      <ImageLightbox />
      <div className="mx-auto max-w-2xl px-4 py-4">
        <div
          style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}
        >
          {virtualItems.map((virtualItem) => (
            <div
              key={messageIds[virtualItem.index]}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <div className="pb-4">
                <MessageBubble messageId={messageIds[virtualItem.index]} />
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {todos.length > 0 && <TodoPanel todos={todos} />}
          {activeQuestion && (
            <QuestionPrompt
              question={activeQuestion}
              onAnswer={handleAnswer}
              onReject={handleReject}
            />
          )}
          {activePermission && (
            <PermissionPrompt permission={activePermission} onReply={handleReplyPermission} />
          )}
          <BusyThinkingIndicator status={sessionStatus} lastMessage={lastMessage} />
          {usageAction && (
            <UsageLimitDialog
              key={`${usageAction.provider}:${usageAction.reason}`}
              action={usageAction}
            />
          )}
          {sessionError && !lastMessageHasError && <ModelErrorCard error={sessionError} />}
        </div>
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

export default ChatMessages;
