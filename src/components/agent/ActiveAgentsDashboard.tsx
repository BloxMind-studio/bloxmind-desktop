import { CheckCircle2, Circle, Code2, Loader2, Play, Square, Trash2, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import type { AgentRun, RunLog, RunStatus } from "@/lib/agentStudio/types";
import { useAgentStudio } from "@/providers/AgentStudioProvider";

function StatusBadge({ status }: { status: RunStatus }) {
  if (status === "succeeded") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 aria-hidden="true" size={10} />
        Done
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">
        <XCircle aria-hidden="true" size={10} />
        Failed
      </span>
    );
  }
  if (status === "stopped") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
        <Square aria-hidden="true" size={9} fill="currentColor" />
        Stopped
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400">
        <Loader2 aria-hidden="true" size={10} className="animate-spin" />
        Running
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <Circle aria-hidden="true" size={9} />
      Queued
    </span>
  );
}

function LogLine({ log }: { log: RunLog }) {
  const levelStyles: Record<RunLog["level"], string> = {
    info: "text-muted-foreground",
    success: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    error: "text-destructive",
    script: "text-violet-600 dark:text-violet-400",
  };
  const time = new Date(log.time).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (
    <div className="flex items-baseline gap-2 font-mono text-[10.5px] leading-relaxed">
      <span className="shrink-0 tabular-nums text-muted-foreground/50">{time}</span>
      <span className={levelStyles[log.level]}>
        {log.level === "script" ? `$ ${log.message}` : log.message}
      </span>
    </div>
  );
}

function RunCard({ run }: { run: AgentRun }) {
  const { stopRun } = useAgentStudio();
  const [showScript, setShowScript] = useState(false);
  const canStop = run.status === "running" || run.status === "queued";

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-xs font-semibold">{run.agentName}</h4>
            <StatusBadge status={run.status} />
          </div>
          <p className="mt-0.5 text-[10.5px] text-muted-foreground">
            Trigger: {run.trigger}
            {run.finishedAt !== null &&
              ` · ${Math.max(0, Math.round((run.finishedAt - run.startedAt) / 1000))}s`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canStop && (
            <button
              type="button"
              onClick={() => stopRun(run.id)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              title="Stop run"
            >
              <Square aria-hidden="true" size={11} fill="currentColor" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowScript((open) => !open)}
            className="flex h-6 items-center gap-1 rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-hover/12"
            title="Show generated script"
          >
            <Code2 aria-hidden="true" size={12} />
            <span className="text-[10px]">Script</span>
          </button>
        </div>
      </div>

      {showScript && (
        <pre className="mt-3 overflow-x-auto rounded-lg border bg-background p-2.5 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
          {run.script}
        </pre>
      )}

      <div className="mt-3 max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-border/50 bg-background/60 p-2">
        {run.logs.map((log) => (
          <LogLine key={log.id} log={log} />
        ))}
        {run.logs.length === 0 && (
          <p className="py-1 text-[10.5px] text-muted-foreground/60">No log entries yet.</p>
        )}
      </div>
    </div>
  );
}

interface ActiveAgentsDashboardProps {
  emptyIcon: ReactNode;
  onCreateAgent: () => void;
}

/**
 * Active Agents Dashboard: running/queued agent runs with live logs, generated
 * scripts, and per-run controls (stop, inspect).
 */
export function ActiveAgentsDashboard({ emptyIcon, onCreateAgent }: ActiveAgentsDashboardProps) {
  const { runs, clearRuns } = useAgentStudio();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold">Active agents</h4>
            <p className="text-[11px] text-muted-foreground">
              Live runs, logs, and execution status.
            </p>
          </div>
          {runs.length > 0 && (
            <button
              type="button"
              onClick={clearRuns}
              className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-hover/12"
            >
              <Trash2 aria-hidden="true" size={11} />
              Clear
            </button>
          )}
        </div>

        {runs.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card/40 py-10 text-center">
            <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-accent">
              {emptyIcon}
            </div>
            <p className="text-xs font-medium text-foreground">No runs yet</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Run a workflow from the Agent Studio or create one with plain English.
            </p>
            <button
              type="button"
              onClick={onCreateAgent}
              className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-[11px] font-semibold text-background transition-opacity hover:opacity-85"
            >
              <Play aria-hidden="true" size={12} fill="currentColor" />
              Create an agent
            </button>
          </div>
        ) : (
          runs.map((run) => <RunCard key={run.id} run={run} />)
        )}
      </div>
    </div>
  );
}
