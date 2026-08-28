import type { Part } from "@opencode-ai/sdk/v2/client";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  buildSteps,
  TextPartView,
  ThinkingBlockBody,
  type ExecutionStep,
} from "@/components/chat/partViews";
import { BloxMindThinking } from "@/components/chat/ThinkingIndicator";
import { latestActivity } from "@/lib/activity";

/** How long (ms) the open step can stay quiet before a subtle stall note. */
const STALL_THRESHOLD_MS = 45_000;

/** A step frozen as a collapsible Thought, or the currently-open animated step. */
type DisplayStep = ExecutionStep & {
  status: "thinking" | "thought";
};

/**
 * Step-based execution renderer.
 *
 * Models an assistant message as an ordered array of execution steps (see
 * `buildSteps`) instead of a single global "isThinking" flag. Each step is
 * rendered by a single, long-lived `ExecutionStepBlock` keyed by a stable
 * `step-N` id. The block ALWAYS keeps the same outer `<div>` mounted and merely
 * swaps its inner content, so the transition from "thinking" to "thought" is an
 * ATOMIC in-place morph — the spinner never unmounts/remounts a different
 * component, and no entrance fade re-runs. That means zero frame gap between
 * the Thinking indicator ending and the Thought block appearing.
 *
 * Status is POSITION-BASED so it works for both explicit steps (delimited by
 * step-start/step-finish) and implicit steps (a bare tool/reasoning run that
 * `buildSteps` flushes without markers):
 *  - every step is `thought` once the turn settles (`!isActive`);
 *  - while active, the LAST step is `thinking` and every step before it is
 *    `thought` — so the instant a later step opens (or the turn ends) the
 *    previous step freezes in place, and the new step's Thinking block is
 *    appended below it immediately. A multi-tool turn therefore reads:
 *    Thinking -> Thought[1] -> Thinking -> Thought[2] -> ...
 *
 * The caller's `isActive` = the agent is still generating this message.
 */
export const StepExecutionView = memo(function StepExecutionView({
  parts,
  isActive,
}: {
  parts: Part[];
  isActive: boolean;
}) {
  const steps = useMemo(() => buildSteps(parts), [parts]);
  const textParts = useMemo(
    () => parts.filter((p) => p.type === "text") as Extract<Part, { type: "text" }>[],
    [parts],
  );

  // A single start-time for the entire busy session so the elapsed
  // timer never resets when a new execution step mounts.
  const sessionStartedAt = useRef<number | null>(null);
  if (isActive && sessionStartedAt.current === null) {
    sessionStartedAt.current = Date.now();
  }

  const displaySteps = useMemo<DisplayStep[]>(
    () =>
      steps.map((step, index) => ({
        ...step,
        status: isActive && index === steps.length - 1 ? "thinking" : "thought",
      })),
    [steps, isActive],
  );

  return (
    <>
      {displaySteps.map((step) => (
        <ExecutionStepBlock key={step.id} step={step} status={step.status} startedAt={sessionStartedAt.current} />
      ))}

      {/* Brand-new assistant shell (no parts yet) still shows a spin block. */}
      {isActive && steps.length === 0 && <ExecutionStepBlock key="__empty__" step={null} status="thinking" startedAt={sessionStartedAt.current} />}

      {!isActive && textParts.map((part) => <TextPartView key={part.id} part={part} />)}
    </>
  );
});

/**
 * A single atomic step block. It keeps the same outer `<div className="mb-3">`
 * permanently mounted and picks only the INNER content based on `status`:
 *  - `thinking` -> an animated spinner (+ live preview + elapsed/stall strip).
 *  - `thought`  -> the collapsible Thought/Reasoning body (no entrance fade).
 * Because the outer container is stable across the transition, switching status
 * never tears the block down or re-runs an animation — zero flicker.
 *
 * `step` is nullable solely so the brand-new empty shell (no parts yet) can
 * render an active spinner; once parts arrive it becomes a real step.
 */
function ExecutionStepBlock({
  step,
  status,
  startedAt,
}: {
  step: ExecutionStep | null;
  status: "thinking" | "thought";
  startedAt: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status !== "thinking") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  const parts = step?.parts ?? [];

  // A settled step with only metric/empty content (no tools, no readable
  // reasoning) must not resurrect an empty collapsible — drop it entirely.
  if (status === "thought" && step) {
    const hasReadable = (step.toolNames.length ?? 0) > 0 || step.reasoningText !== undefined;
    if (!hasReadable) return null;
  }
  // An empty shell with no steps and no active state renders nothing at all.
  if (!step && status === "thought") return null;

  const activity = latestActivity(parts);
  const elapsedMs = Math.max(0, startedAt !== null ? now - startedAt : 0);
  const seconds = Math.floor(elapsedMs / 1000);
  const stamp = `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  const stalled =
    activity.epoch === 0
      ? elapsedMs > STALL_THRESHOLD_MS
      : now - activity.epoch > STALL_THRESHOLD_MS;

  const preview = status === "thinking" ? activity.line ?? step?.reasoningText : undefined;

  return (
    <div className="mb-3">
      {status === "thinking" ? (
        <div className="glass-panel flex min-h-[21px] items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground">
          <BloxMindThinking label="Thinking..." />
          {preview && (
            <span className="min-w-0 flex-1 truncate" title={preview}>
              {preview}
            </span>
          )}
          <span className="shrink-0 font-medium tabular-nums text-foreground/80">{stamp}</span>
          {stalled && (
            <span
              className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600/90"
              title="No new events in a while - likely one long Studio call rather than a crash"
            >
              Still running - long Studio call in progress
            </span>
          )}
        </div>
      ) : (
        step && <ThinkingBlockBody parts={step.parts} />
      )}
    </div>
  );
}
