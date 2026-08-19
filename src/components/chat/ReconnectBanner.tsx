import { WifiOff } from "lucide-react";
import { memo, useEffect, useState } from "react";
import type { OpenCodeClientContextValue } from "@/providers/OpenCodeClientProvider";
import { SSE_MAX_RECONNECT_ATTEMPTS } from "@/providers/OpenCodeClientProvider";

// ── Hook ──────────────────────────────────────────────────────────────────

function useReconnectTimer(
  sseConnected: boolean,
  consecutiveFailures: number,
): { elapsed: number; show: boolean } {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (sseConnected) {
      setElapsed(0);
      return;
    }

    const start = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);

    return () => clearInterval(id);
  }, [sseConnected]);

  const show = !sseConnected && consecutiveFailures > 0;
  return { elapsed, show };
}

// ── Component ─────────────────────────────────────────────────────────────

export const ReconnectBanner = memo(function ReconnectBanner({
  sseConnected,
  consecutiveFailures,
}: Pick<OpenCodeClientContextValue, "sseConnected"> & { consecutiveFailures: number }) {
  const { elapsed, show } = useReconnectTimer(sseConnected, consecutiveFailures);

  if (!show) return null;

  const permanentlyDisconnected = consecutiveFailures >= SSE_MAX_RECONNECT_ATTEMPTS;

  if (permanentlyDisconnected) {
    return (
      <div className="animate-fade-in-up flex items-center justify-center gap-2 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-400">
        <WifiOff size={14} />
        <span>Connection lost after {SSE_MAX_RECONNECT_ATTEMPTS} attempts.</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded bg-red-500/20 px-2 py-0.5 font-medium transition-colors hover:bg-red-500/30"
        >
          Reload
        </button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up flex items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-400">
      <WifiOff size={13} />
      <span>Reconnecting to OpenCode{elapsed > 0 && ` (${elapsed}s)`}</span>
    </div>
  );
});
