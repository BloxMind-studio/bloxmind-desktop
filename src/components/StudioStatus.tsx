import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useRestartMcp } from "@/hooks/mutations/useRestartMcp";
import { useStudioStatus } from "@/hooks/useStudioStatus";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

type Status = "connected" | "disconnected" | "failed" | "disabled" | "needs_auth" | "unknown";

const STATUS_CONFIG: Record<Status, { dot: string; label: string; description: string }> = {
  connected: {
    dot: "bg-emerald-400",
    label: "Studio connected",
    description: "Roblox Studio is connected and ready. You can send messages.",
  },
  disconnected: {
    dot: "bg-red-400",
    label: "Studio not connected",
    description: "Open Roblox Studio and enable the built-in MCP server in Assistant settings.",
  },
  failed: {
    dot: "bg-red-400",
    label: "MCP server unreachable",
    description:
      "The Studio MCP server is not responding. Make sure Roblox Studio is running with MCP enabled.",
  },
  disabled: {
    dot: "bg-stone-300",
    label: "MCP disabled",
    description: "The Roblox Studio integration is disabled in the configuration.",
  },
  needs_auth: {
    dot: "bg-amber-400",
    label: "MCP needs auth",
    description: "The MCP server requires authentication. Configure it in Settings > Studio.",
  },
  unknown: {
    dot: "bg-stone-300 animate-pulse",
    label: "Checking...",
    description: "Waiting for the MCP server to report its status.",
  },
};

const StudioStatus = memo(function StudioStatus() {
  const { status, ready } = useOpenCodeClient();
  const { studioStatus, studioError } = useStudioStatus();
  const restartMcp = useRestartMcp();
  const [hovering, setHovering] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const config = STATUS_CONFIG[studioStatus];

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const handleEnter = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setHovering(true);
  }, []);

  const handleLeave = useCallback(() => {
    timeoutRef.current = setTimeout(() => setHovering(false), 150);
  }, []);

  const handleRestart = useCallback(() => {
    restartMcp.mutate();
  }, [restartMcp]);

  if (status !== "Running" || !ready) return null;

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <div className="flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent">
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-500 ${config.dot}`}
        />
        <span className="text-[11px] text-muted-foreground">{config.label}</span>
      </div>

      {hovering && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 animate-in fade-in slide-in-from-top-1 duration-150 rounded-lg border bg-popover p-3 shadow-lg">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full transition-colors duration-500 ${config.dot}`}
            />
            <span className="text-xs font-medium text-foreground">{config.label}</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            {config.description}
          </p>
          {studioStatus === "failed" && (
            <div className="mt-2">
              {studioError && (
                <p className="mb-2 rounded bg-red-50 px-2 py-1 font-mono text-[10px] text-red-600">
                  {studioError}
                </p>
              )}
              <button
                type="button"
                onClick={handleRestart}
                disabled={restartMcp.isPending}
                className="inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-foreground text-[11px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {restartMcp.isPending ? "Restarting..." : "Restart MCP Server"}
              </button>
            </div>
          )}
          {studioStatus === "disconnected" && (
            <div className="mt-2">
              <ol className="space-y-1 text-[10px] text-muted-foreground">
                <li>1. Open Roblox Studio</li>
                <li>2. Open or create a place file</li>
                <li>
                  3. Open <strong>Assistant</strong> settings (three-dot menu)
                </li>
                <li>
                  4. Go to <strong>MCP Servers</strong> and enable{" "}
                  <strong>Studio as MCP server</strong>
                </li>
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default StudioStatus;
