import { memo, useEffect, useState } from "react";
import { toast } from "sonner";
import { desktop } from "@/lib/desktop";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import type { RojoStatus } from "@/types/desktop";

/**
 * Read-only Rojo live-sync status indicator.
 * Polls the Electron main process every 5s for the current `rojo serve` state.
 * Shows 🟢 Rojo Active (Port XXXX) or 🔴 Rojo Offline.
 * Clicking toggles the server on/off (graceful start/stop).
 * When a session is active, also shows which isolated session folder Rojo is
 * syncing to and reveals that folder in the OS file explorer on demand.
 */
function RojoStatusBadgeImpl() {
  const [status, setStatus] = useState<RojoStatus | null>(null);
  const [toggling, setToggling] = useState(false);
  const { activeSessionId } = useActiveSession();

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const s = await desktop.rojoStatus();
        if (!cancelled) setStatus(s);
      } catch {
        if (!cancelled) setStatus(null);
      }
    }

    void poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleToggle = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      // When a session is active, toggle its isolated per-session Rojo server
      // so Studio never syncs the wrong project. Otherwise fall back to the
      // shared BloxMind workspace.
      const s = activeSessionId
        ? await desktop.rojoToggleForSession(activeSessionId)
        : await desktop.rojoToggle((await desktop.getOpenCodeInfo()).workspace);
      setStatus(s);
    } catch {
      // ignore — status will refresh on next poll
    } finally {
      setToggling(false);
    }
  };

  const handleOpenWorkspace = async () => {
    if (!activeSessionId) return;
    try {
      await desktop.openSessionWorkspace(activeSessionId);
    } catch {
      toast.error("Failed to open session workspace", {
        description:
          "The session folder could not be opened in your file explorer. The desktop app is required.",
      });
    }
  };

  const active = status?.active === true;
  const port = status?.port;
  const error = status?.error;
  const clientConnected = status?.clientConnected === true;

  const handleAutoConnectTip = () => {
    toast.info("Auto-Connect Tip", {
      description:
        'In Roblox Studio, open the Rojo Plugin panel, click Settings, and toggle "Auto Connect" to ON. Studio will connect automatically whenever BloxMind starts Rojo.',
      duration: 8000,
    });
  };

  const hasError = !active && error !== null;

  // The workspace reported by Rojo is the session folder (rojo serve runs with
  // cwd = the session workspace). Derive the folder name for the indicator.
  const sessionFolderName = activeSessionId ?? extractFolderName(status?.workspace ?? "");
  const targetFileLabel = `sessions/${sessionFolderName}/default.project.json`;

  return (
    <div className="inline-flex min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={handleToggle}
        disabled={toggling}
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50"
        title={
          active
            ? `Rojo live-sync active on port ${port} — click to stop`
            : error
              ? `${error} — click to retry`
              : "Rojo CLI not found or inactive — click to start"
        }
      >
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            active
              ? clientConnected
                ? "bg-emerald-500"
                : "bg-amber-500"
              : hasError
                ? "bg-red-500"
                : "bg-muted-foreground/30"
          }`}
        />
        {active ? (
          <span
            className={
              clientConnected
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400"
            }
          >
            {clientConnected
              ? "Connected to Studio"
              : `Rojo Active${port ? ` (Port ${port})` : ""}`}
          </span>
        ) : hasError ? (
          <span className="text-red-600 dark:text-red-400">Rojo Error — Click to Retry</span>
        ) : (
          <span className="text-muted-foreground/60">Rojo Offline</span>
        )}
      </button>

      {/* Session-isolation indicator: shows which session folder Rojo targets. */}
      {activeSessionId && (
        <span
          className="inline-flex max-w-[180px] min-w-0 items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground"
          title={`Syncing ${targetFileLabel} (open this session's folder with the folder icon)`}
        >
          <svg
            width="9"
            height="9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="shrink-0"
          >
            <path d="M4 20V10a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
          </svg>
          <span className="truncate">{activeSessionId}</span>
        </span>
      )}

      {/* Open the active session's folder in the OS file explorer. */}
      {activeSessionId && (
        <button
          type="button"
          onClick={handleOpenWorkspace}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
          title={`Open this session's workspace folder (${targetFileLabel})`}
          aria-label="Open session workspace folder"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 1-3 3 3 3 0 0 1-3-3V6a1 1 0 0 1 2 0v12a1 1 0 0 0 2 0V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3" />
          </svg>
        </button>
      )}

      {active && !clientConnected && (
        <button
          type="button"
          onClick={handleAutoConnectTip}
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors"
          title="How to enable Auto-Connect"
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
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </button>
      )}
    </div>
  );
}

/** Last path segment of an absolute path, or the path itself when it has no separator. */
function extractFolderName(workspace: string): string {
  const trimmed = workspace.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export const RojoStatusBadge = memo(RojoStatusBadgeImpl);
