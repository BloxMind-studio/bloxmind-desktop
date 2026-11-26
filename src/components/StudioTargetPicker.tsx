import posthog from "posthog-js/dist/module.full.no-external.js";
import { useEffect, useRef, useState } from "react";

import { analyticsProperties } from "@/lib/analytics";
import { useStudioTargetOptional } from "@/providers/StudioTargetProvider";

/** Three fruitless Refreshes inside 30 seconds means someone is stuck, not just checking. */
const STUCK_REFRESHES = 3;
const STUCK_WINDOW_MS = 30_000;
/** Studio answers in milliseconds, too fast to see, so Refresh stays busy at least this long. */
const MIN_REFRESH_MS = 600;

function foundLabel(count: number): string {
  if (count === 0) return "No Studio found";
  return `${count} ${count === 1 ? "Studio" : "Studios"} found`;
}

function StudioIcon() {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M4 5.5h16v11H4z" />
      <path d="M8 20h8M12 16.5V20" />
    </svg>
  );
}

export default function StudioTargetPicker({
  openRequest = 0,
  onOpenSetup,
  onWorkedWithoutStudio,
}: {
  /** Bumped by the chat notice to open the picker without a click on its trigger. */
  openRequest?: number;
  /** Opens the setup steps, after several fruitless refreshes or from the empty state. */
  onOpenSetup?: () => void;
  onWorkedWithoutStudio?: () => void;
} = {}) {
  const studioTarget = useStudioTargetOptional();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [stuck, setStuck] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const seenOpenRequest = useRef(openRequest);
  const emptyRefreshes = useRef<number[]>([]);
  const stuckRef = useRef(false);

  useEffect(() => {
    if (openRequest === seenOpenRequest.current) return;
    seenOpenRequest.current = openRequest;
    setOpen(true);
  }, [openRequest]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setChecked(false);
        // Closing it counts as moving on, so a later Refresh isn't stuck straight away.
        emptyRefreshes.current = [];
        stuckRef.current = false;
        setStuck(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const hasTargets = (studioTarget?.targets.length ?? 0) > 0;

  // Studio can turn up from the background check too, not only from Refresh.
  useEffect(() => {
    if (!hasTargets) return;
    emptyRefreshes.current = [];
    stuckRef.current = false;
    setStuck(false);
  }, [hasTargets]);

  if (!studioTarget) return null;
  const {
    targets,
    selected,
    status,
    refreshing,
    selectingKey,
    error,
    clearError,
    missing,
    discover,
    select,
  } = studioTarget;
  const busy = status === "loading" || refreshing || selectingKey !== null;

  const buttonLabel =
    status === "loading"
      ? "Finding Studios…"
      : (selected?.label ?? (status === "empty" ? "No Studios" : "Choose Studio"));

  const refresh = async () => {
    // Refresh keeps keyboard focus while it's busy, so it can't use disabled.
    if (busy) return;
    clearError();
    setChecked(false);
    await Promise.all([
      discover(),
      new Promise((resolve) => window.setTimeout(resolve, MIN_REFRESH_MS)),
    ]);
    setChecked(true);
    const now = Date.now();
    const found = targets.length;
    emptyRefreshes.current =
      found > 0 ? [] : [...emptyRefreshes.current, now].filter((at) => now - at < STUCK_WINDOW_MS);
    if (emptyRefreshes.current.length >= STUCK_REFRESHES && !stuckRef.current && !missing) {
      stuckRef.current = true;
      setStuck(true);
      posthog.capture(
        "studio_target_guidance_shown",
        analyticsProperties("studio_target", { trigger: "repeated_refresh", status }),
      );
    }
  };

  const showMeHow = onOpenSetup ? (
    <button
      type="button"
      onClick={() => {
        posthog.capture(
          "studio_target_guidance_followed",
          analyticsProperties("studio_target", {
            trigger: stuck ? "repeated_refresh" : "empty",
            status,
          }),
        );
        setOpen(false);
        onOpenSetup();
      }}
      className={`mt-2 inline-flex h-7 items-center rounded-md px-3 text-xs font-medium transition-colors ${
        stuck ? "bg-foreground text-background hover:opacity-90" : "border hover:bg-accent"
      }`}
    >
      Show me how
    </button>
  ) : null;

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() =>
          setOpen((value) => {
            if (!value) {
              posthog.capture(
                "studio_target_picker_opened",
                analyticsProperties("studio_target", { status }),
              );
            }
            return !value;
          })
        }
        className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md border bg-background px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <span className="shrink-0">
          <StudioIcon />
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{buttonLabel}</span>
        {status === "loading" ? (
          <span className="ml-0.5 h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
        ) : (
          <svg
            aria-hidden="true"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m7 10 5 5 5-5" />
          </svg>
        )}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Choose Roblox Studio"
          className="animate-picker-in absolute right-0 top-9 z-40 w-[min(20rem,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl"
        >
          <div className="flex h-11 items-center justify-between gap-3 border-b px-4">
            <h4 className="text-sm font-semibold">Pick Studio</h4>
            <button
              type="button"
              onClick={() => void refresh()}
              aria-disabled={busy}
              aria-busy={refreshing}
              className="inline-flex min-w-14 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground"
            >
              {refreshing ? (
                <span className="h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
              ) : null}
              Refresh
            </button>
          </div>
          <div className="max-h-72 p-2">
            {status === "loading" ? (
              <output className="block space-y-2 p-2" aria-label="Loading Studio targets">
                {[0, 1].map((item) => (
                  <div key={item} className="h-12 animate-pulse rounded-lg bg-muted" />
                ))}
              </output>
            ) : status === "empty" ? (
              <div className="px-4 py-7 text-center">
                <p className="text-sm font-medium">
                  {checked ? foundLabel(targets.length) : "No Studio windows found"}
                </p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  Studio MCP is connected, but it has not reported an open Studio window yet.
                </p>
                {showMeHow}
              </div>
            ) : status === "error" ? (
              <div className="px-4 py-7 text-center">
                <p className="text-sm font-medium">Couldn’t find Studios</p>
                <p
                  className="mt-1 line-clamp-3 break-words text-[11px] leading-4 text-muted-foreground"
                  title={error ?? undefined}
                >
                  {error ?? "The Studio integration could not be initialized."}
                </p>
                {showMeHow}
              </div>
            ) : (
              <div className="space-y-1">
                {targets.map((target) => {
                  const active = selected?.key === target.key;
                  const selecting = selectingKey === target.key;
                  return (
                    <button
                      key={target.key}
                      type="button"
                      disabled={selectingKey !== null}
                      onClick={() => void select(target)}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors disabled:opacity-60 ${active ? "bg-accent" : "hover:bg-accent/70"}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{target.label}</span>
                        {target.detail ? (
                          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                            {target.detail}
                          </span>
                        ) : null}
                      </span>
                      {selecting ? (
                        <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                      ) : active ? (
                        <svg
                          aria-label="Selected"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                        >
                          <path d="m5 12 4 4L19 6" />
                        </svg>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {checked && !busy ? (
            <output className="block border-t px-4 py-2 text-center text-[11px] text-muted-foreground">
              {foundLabel(targets.length)}
            </output>
          ) : null}
          {error && status !== "error" ? (
            <div
              role="alert"
              className="line-clamp-3 break-words border-t border-red-200 bg-red-50 px-4 py-2.5 text-[10px] leading-4 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
              title={error}
            >
              {error}
            </div>
          ) : null}
          {studioTarget && !studioTarget.withoutStudio ? (
            <div className="border-t p-2">
              <button
                type="button"
                onClick={() => {
                  studioTarget.workWithoutStudio();
                  onWorkedWithoutStudio?.();
                  setOpen(false);
                }}
                className="w-full rounded-md px-3 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Work without Studio
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
