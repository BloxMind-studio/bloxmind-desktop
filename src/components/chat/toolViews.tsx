import type { Todo } from "@opencode-ai/sdk/v2/client";
import { lazy, memo, Suspense } from "react";
import { InlineDisclosure } from "@/components/chat/InlineDisclosure";

const SyntaxHighlightedOutput = lazy(() => import("@/components/SyntaxHighlightedOutput"));

// ── Helpers ─────────────────────────────────────────────────────────────

export function baseToolName(tool: string): string {
  return tool.replace(/^mcp_[^_]+_/, "");
}

export function inputField(input: Record<string, unknown>, key: string): string {
  const val = input[key];
  if (typeof val === "string") return val;
  if (val !== undefined && val !== null) return JSON.stringify(val);
  return "";
}

// ── Shared todo row (used by both the inline tool view and the TodoPanel) ─

function TodoStatusIcon({ status }: { status: Todo["status"] }) {
  if (status === "completed") {
    return (
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
    );
  }
  if (status === "in_progress") {
    return (
      <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full border-2 border-amber-400" />
    );
  }
  if (status === "cancelled") {
    return (
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
    );
  }
  return (
    <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-muted-foreground/40" />
  );
}

function todoTextClass(status: Todo["status"]): string {
  if (status === "completed") return "text-muted-foreground line-through";
  if (status === "cancelled") return "text-muted-foreground/50 line-through";
  return "text-foreground";
}

export function TodoRow({ todo, iconTopClass = "mt-px" }: { todo: Todo; iconTopClass?: string }) {
  return (
    <div className="flex items-start gap-1.5 text-[11px]">
      <span className={`shrink-0 ${iconTopClass}`}>
        <TodoStatusIcon status={todo.status} />
      </span>
      <span className={todoTextClass(todo.status)}>{todo.content}</span>
    </div>
  );
}

// ── Tool-specific renderers ─────────────────────────────────────────────

export const BashToolView = memo(function BashToolView({
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

export const EditToolView = memo(function EditToolView({
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

export const ReadToolView = memo(function ReadToolView({
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

export const WriteToolView = memo(function WriteToolView({
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

export const GlobToolView = memo(function GlobToolView({
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

export const GrepToolView = memo(function GrepToolView({
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

export const TaskToolView = memo(function TaskToolView({
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

export const WebFetchToolView = memo(function WebFetchToolView({
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

export const TodoWriteToolView = memo(function TodoWriteToolView({
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
        <TodoRow key={idx} todo={todo} iconTopClass="mt-px" />
      ))}
    </div>
  );
});

export const DefaultToolView = memo(function DefaultToolView({
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
