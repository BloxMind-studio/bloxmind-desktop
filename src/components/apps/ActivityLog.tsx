import { Check, CircleAlert, Loader2 } from "lucide-react";
import { memo, useEffect, useRef } from "react";

import type { ActivityEntry } from "@/lib/appsBuilder/activity";

/**
 * Live Activity Log — a dynamic feed of the agent's real work while a
 * build/update runs. Replaces the static checklist: each entry shows the exact
 * operation ("Creating file src/main.tsx"), a status badge (spinner → check →
 * red error), and the raw detail (shell command / error message) when present.
 * While the model streams reasoning without touching tools yet, the current
 * agent label is shown as a live "in progress" line so the feed is never a
 * bare header.
 */
export const ActivityLog = memo(function ActivityLog({
  entries,
  updating,
  currentLabel,
}: {
  entries: ActivityEntry[];
  /** Reading header text for change requests vs fresh builds. */
  updating: boolean;
  /** Live "what the agent is doing right now" label, e.g. "Thinking…". */
  currentLabel?: string | null;
}) {
  const listRef = useRef<HTMLOListElement>(null);

  // Keep the newest entry in view as the feed streams.
  useEffect(() => {
    const node = listRef.current;
    if (node && entries.length > 0) node.scrollTop = node.scrollHeight;
  }, [entries]);

  return (
    <div className="px-3 py-2" data-testid="activity-log">
      <div className="mr-6 rounded-lg bg-hover/6 px-2.5 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
          <Loader2 aria-hidden="true" size={11} className="animate-spin text-accent" />
          {updating ? "Updating your project…" : "Building your project…"}
        </div>
        <ol
          ref={listRef}
          className="app-scrollbar mt-2 flex max-h-44 flex-col gap-1.5 overflow-y-auto"
        >
          {entries.length === 0 && currentLabel ? (
            <li className="flex items-center gap-1.5 text-[10px] text-foreground">
              <Loader2 aria-hidden="true" size={10} className="shrink-0 animate-spin text-accent" />
              <span className="truncate">{currentLabel}</span>
            </li>
          ) : null}
          {entries.map((entry) => (
            <li
              key={entry.id}
              data-testid={`activity-${entry.status}`}
              className="flex gap-1.5 text-[10px]"
            >
              <span className="mt-0.5 flex w-3 shrink-0 items-center justify-center">
                {entry.status === "running" && (
                  <Loader2 aria-hidden="true" size={10} className="animate-spin text-accent" />
                )}
                {entry.status === "success" && (
                  <Check aria-hidden="true" size={10} className="text-accent" />
                )}
                {entry.status === "error" && (
                  <CircleAlert aria-hidden="true" size={10} className="text-destructive" />
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span
                  className={`truncate ${
                    entry.status === "error"
                      ? "font-medium text-destructive"
                      : entry.status === "running"
                        ? "text-foreground"
                        : "text-muted-foreground"
                  }`}
                >
                  {entry.title}
                  {entry.path ? (
                    <span className="ml-1 text-foreground/80"> {entry.path}</span>
                  ) : null}
                </span>
                {entry.detail ? (
                  <span className="truncate font-mono text-muted-foreground/80">
                    {entry.detail}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
});
