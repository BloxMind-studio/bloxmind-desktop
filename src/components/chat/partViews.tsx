import type { Part } from "@opencode-ai/sdk/v2/client";
import { lazy, memo, Suspense, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { InlineDisclosure } from "@/components/chat/InlineDisclosure";
import {
  BashToolView,
  baseToolName,
  DefaultToolView,
  EditToolView,
  GlobToolView,
  GrepToolView,
  ReadToolView,
  TaskToolView,
  TodoWriteToolView,
  WebFetchToolView,
  WriteToolView,
} from "@/components/chat/toolViews";
import { RobloxInstanceCard } from "@/components/RobloxInstanceCard";
import type { HighlightLanguage } from "@/components/SyntaxHighlightedOutput";

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

// Tools that render their own compact header (icon + path/command) and
// therefore shouldn't also get the generic title line in ToolPartView.
// Hoisted to module scope so we don't allocate a new array + call
// Array#includes on every render of every tool part.
const TOOLS_WITH_OWN_HEADER = new Set([
  "bash",
  "edit",
  "read",
  "write",
  "glob",
  "grep",
  "task",
  "webfetch",
  "todowrite",
]);

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

export const TextPartView = memo(
  function TextPartView({ part }: { part: Extract<Part, { type: "text" }> }) {
    return (
      <div className="select-text text-[13px] leading-relaxed">
        <MessageText text={part.text} />
      </div>
    );
  },
  (prev, next) => prev.part.text === next.part.text,
);

export const ReasoningPartView = memo(function ReasoningPartView({
  part,
}: {
  part: Extract<Part, { type: "reasoning" }>;
}) {
  if (!part.text) return null;
  return <InlineDisclosure text={part.text} />;
});

export const ToolPartView = memo(function ToolPartView({
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
        return (
          <RobloxInstanceCard
            output={typeof output === "string" ? output : JSON.stringify(output, null, 2)}
          />
        );
      default:
        return <DefaultToolView tool={tool} input={input} output={output} status={status} />;
    }
  }

  return (
    <div className="min-w-0 max-w-full overflow-hidden">
      {title && !TOOLS_WITH_OWN_HEADER.has(tool) && (
        <div className="mb-1 break-words text-[11px] font-medium text-foreground">{title}</div>
      )}
      {renderToolContent()}
    </div>
  );
});

export const StepPartView = memo(function StepPartView() {
  return <div className="h-6" aria-hidden="true" />;
});

export const StepFinishPartView = memo(function StepFinishPartView({
  part,
}: {
  part: Extract<Part, { type: "step-finish" }>;
}) {
  const { tokens, cost } = part;
  return (
    <div className="my-1 flex flex-wrap items-center gap-1.5">
      {cost > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium tabular-nums text-muted-foreground">
          <svg
            width="8"
            height="8"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-emerald-500"
          >
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          {cost.toFixed(4)}
        </span>
      )}
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[9px] font-medium tabular-nums text-blue-600 dark:text-blue-400">
        <svg
          width="8"
          height="8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {tokens.input.toLocaleString()} in
      </span>
      <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-0.5 text-[9px] font-medium tabular-nums text-purple-600 dark:text-purple-400">
        <svg
          width="8"
          height="8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
        {tokens.output.toLocaleString()} out
      </span>
      {tokens.cache.read > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium tabular-nums text-amber-600 dark:text-amber-400">
          <svg
            width="8"
            height="8"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
          {tokens.cache.read.toLocaleString()} cached
        </span>
      )}
    </div>
  );
});

export const RetryPartView = memo(function RetryPartView({
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

export const CompactionPartView = memo(function CompactionPartView() {
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

// ── Collapsible thinking block ──────────────────────────────────────────

const ThinkingBlock = memo(function ThinkingBlock({ parts }: { parts: Part[] }) {
  const [isOpen, setIsOpen] = useState(false);

  if (parts.length === 0) return null;

  const toolNames = parts
    .filter((p) => p.type === "tool")
    .map((p) => baseToolName((p as Extract<Part, { type: "tool" }>).tool))
    .filter((name, idx, arr) => arr.indexOf(name) === idx);

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
            <span className="ml-1 text-muted-foreground/60">({toolNames.join(", ")})</span>
          )}
        </span>
      </button>
      {isOpen && (
        <div className="mt-1.5 space-y-1.5 border-l-2 border-muted pl-3">
          {parts.map((part) => {
            switch (part.type) {
              case "reasoning":
                return (
                  <ReasoningPartView
                    key={part.id}
                    part={part as Extract<Part, { type: "reasoning" }>}
                  />
                );
              case "tool":
                return (
                  <ToolPartView key={part.id} part={part as Extract<Part, { type: "tool" }>} />
                );
              case "step-start":
                return <StepPartView key={part.id} />;
              case "step-finish":
                return (
                  <StepFinishPartView
                    key={part.id}
                    part={part as Extract<Part, { type: "step-finish" }>}
                  />
                );
              case "retry":
                return (
                  <RetryPartView key={part.id} part={part as Extract<Part, { type: "retry" }>} />
                );
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

export const SmartPartsRenderer = memo(function SmartPartsRenderer({ parts }: { parts: Part[] }) {
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
