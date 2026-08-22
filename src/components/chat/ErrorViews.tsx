import { memo, useCallback, useEffect, useRef, useState } from "react";
import { type ModelError, presentModelError } from "@/lib/modelError";
import type { OpenCodeUsageAction } from "@/lib/usageLimit";

// ── Model error card ───────────────────────────────────────────────────

export const ModelErrorCard = memo(function ModelErrorCard({ error }: { error: ModelError }) {
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

// ── Usage limit dialog ─────────────────────────────────────────────────

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

export const UsageLimitDialog = memo(function UsageLimitDialog({
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
      className="fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none bg-transparent p-4 backdrop:bg-[#161616]/50"
      onCancel={(event) => {
        event.preventDefault();
        close(false);
      }}
      onKeyDown={(event) => {
        // Native <dialog> dismisses Escape via onCancel when shown with
        // showModal(); this handler covers the fallback `open` attribute path
        // and satisfies keyboard parity with the backdrop click.
        if (event.key === "Escape") close(false);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close(false);
      }}
    >
      <div className="absolute left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-5 text-foreground shadow-lg">
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
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-hover/12"
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
