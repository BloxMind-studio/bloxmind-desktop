import type { Todo } from "@opencode-ai/sdk/v2/client";
import { memo } from "react";
import { TodoRow } from "@/components/chat/toolViews";

// ── Inline todo panel ───────────────────────────────────────────────────

export const TodoPanel = memo(function TodoPanel({ todos }: { todos: Todo[] }) {
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
          <TodoRow key={idx} todo={todo} iconTopClass="mt-0.5" />
        ))}
      </div>
    </div>
  );
});
