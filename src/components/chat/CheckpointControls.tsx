import { useState } from "react";
import type { useCheckpointHistory } from "@/hooks/useCheckpointHistory";

export type CheckpointHistory = ReturnType<typeof useCheckpointHistory>;

// ── Restore checkpoint button ─────────────────────────────────────────────

export function RestoreCheckpointButton({
  checkpoint,
  isBusy,
  messageId,
}: {
  checkpoint: CheckpointHistory;
  isBusy: boolean;
  messageId: string;
}) {
  // Use the cached count so the button doesn't disappear during refetches.
  if (checkpoint.cachedFsCheckpointCount === 0) return null;

  // Only the specific message/task that was restored shows "Restored".
  // All other tasks show "Restore files" regardless of restore state.
  const restored = checkpoint.restoredMessageId === messageId;

  // Visual live-sync indicator: after a restore, show a small colored dot
  // next to the button label so the user knows at a glance whether Roblox
  // Studio received the reverted code via Rojo.
  //   • green  = Rojo active & Studio connected → code live-synced
  //   • amber  = Rojo not active or Studio not connected → local only
  //   • none   = no restore has been performed yet
  const syncDot = restored
    ? null
    : checkpoint.lastRestoreSynced === true
      ? "bg-emerald-500"
      : checkpoint.lastRestoreSynced === false
        ? "bg-amber-400"
        : null;

  const syncTitle = restored
    ? "This checkpoint has been restored"
    : checkpoint.lastRestoreSynced === true
      ? "Last restore was live-synced to Roblox Studio via Rojo"
      : checkpoint.lastRestoreSynced === false
        ? "Last restore was local only — connect Studio to Rojo to live-sync"
        : "Restore files to the last checkpoint";

  return (
    <button
      type="button"
      onClick={() => void checkpoint.restoreLatestFileCheckpoint(messageId)}
      disabled={isBusy || restored}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-all duration-200 disabled:opacity-60 ${
        restored
          ? "text-emerald-600/70 cursor-default"
          : "text-muted-foreground/40 hover:scale-105 hover:text-muted-foreground hover:bg-accent/50 active:scale-95"
      }`}
      title={syncTitle}
    >
      {restored ? (
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
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
      )}
      <span>{restored ? "Restored" : "Restore files"}</span>
      {syncDot && (
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${syncDot}`}
          role="img"
          aria-label={syncTitle}
        />
      )}
    </button>
  );
}

// ── Read-only checkpoint status badge ────────────────────────────────────
// Serves purely as a visual marker that an automatic checkpoint was captured
// for this turn. Clicking it only reveals metadata (timestamp + affected
// files); it never triggers a save or restore action.

export function CheckpointStatusBadge({ checkpoint }: { checkpoint: CheckpointHistory }) {
  const [open, setOpen] = useState(false);
  // Use the cached count so the badge persists across re-fetches.
  if (checkpoint.cachedFsCheckpointCount === 0) return null;
  const latest = checkpoint.latestFsCheckpoint;
  if (!latest) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-emerald-600/70 transition-all duration-200 hover:scale-105 hover:text-emerald-600 hover:bg-emerald-500/5 active:scale-95 dark:text-emerald-400/70 dark:hover:text-emerald-400"
        title="Automatic checkpoint captured for this turn — click for details"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span>Checkpoint</span>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-10 mb-1 w-64 rounded-lg border bg-popover p-2.5 text-[10px] shadow-lg">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
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
            Checkpoint saved
          </div>
          <div className="text-muted-foreground">
            Captured {new Date(latest.timestamp).toLocaleTimeString()}
            {latest.paths.length > 0
              ? ` · ${latest.paths.length} file(s) tracked`
              : " · full workspace snapshot"}
          </div>
          {latest.paths.length > 0 && (
            <div className="mt-1 space-y-0.5 border-t border-border/50 pt-1">
              {latest.paths.slice(0, 4).map((change) => (
                <div
                  key={change.path}
                  className="truncate font-mono text-[9px] text-muted-foreground/60"
                >
                  {change.operation === "create" ? "+" : "~"} {change.path}
                </div>
              ))}
              {latest.paths.length > 4 && (
                <div className="text-[9px] text-muted-foreground/50">
                  +{latest.paths.length - 4} more
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
