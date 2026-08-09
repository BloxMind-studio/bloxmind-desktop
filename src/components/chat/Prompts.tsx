import type {
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
} from "@opencode-ai/sdk/v2/client";
import { memo, useState } from "react";

// ── Question prompt ─────────────────────────────────────────────────────

export const QuestionPrompt = memo(function QuestionPrompt({
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
    <div className="animate-fade-in-up my-2 rounded-lg border border-cyan-200 bg-cyan-50/30 px-3 py-3 dark:border-cyan-900/50 dark:bg-cyan-950/20">
      {question.questions.map((q, qIdx) => (
        <div
          key={qIdx}
          className={qIdx > 0 ? "mt-3 border-t border-cyan-100 pt-3 dark:border-cyan-900/40" : ""}
        >
          <div className="text-[11px] font-semibold text-foreground">{q.header}</div>
          <div className="mt-0.5 text-[12px] text-foreground">{q.question}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {q.options.map((opt) => {
              const isSelected = selected[qIdx]?.has(opt.label);
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => toggleOption(qIdx, opt.label, q.multiple)}
                  className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors ${isSelected ? "border-cyan-400 bg-cyan-100 text-cyan-800 dark:border-cyan-500 dark:bg-cyan-950/50 dark:text-cyan-300" : "border-border bg-card text-foreground hover:border-cyan-300 hover:bg-cyan-50 dark:hover:border-cyan-700 dark:hover:bg-cyan-950/30"}`}
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
              className="mt-2 w-full rounded border border-border bg-background px-2 py-1 text-[11px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-accent/40"
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

export const PermissionPrompt = memo(function PermissionPrompt({
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
