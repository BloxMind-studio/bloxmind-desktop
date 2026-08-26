import { Folder } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSessions } from "@/hooks/useSessions";
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
  const { data: sessions } = useSessions();

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

  // Prefer the human-readable session title (updates live via React Query
  // invalidation on rename); fall back to the raw id.
  const sessionTitle =
    sessions?.find((s) => s.id === activeSessionId)?.title?.trim() || activeSessionId;

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

      {/* Unified session workspace badge: shows which isolated folder Rojo
          targets; clicking reveals that folder in the OS file explorer. */}
      {activeSessionId && (
        <button
          type="button"
          onClick={handleOpenWorkspace}
          className="inline-flex max-w-[200px] min-w-0 shrink-0 items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground hover:scale-[1.03] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          title="Open session workspace folder"
          aria-label="Open session workspace folder"
        >
          <Folder size={10} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{sessionTitle}</span>
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

export const RojoStatusBadge = RojoStatusBadgeImpl;
