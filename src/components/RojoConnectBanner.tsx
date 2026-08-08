import { memo, useEffect, useState } from "react";
import { desktop } from "@/lib/desktop";

function RojoConnectBannerImpl() {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval>;

    async function check() {
      try {
        const status = await desktop.rojoStatus();
        if (!cancelled) {
          const shouldShow = status.active && !status.clientConnected && !dismissed;
          setShow(shouldShow);
        }
      } catch {
        // ignore
      }
    }

    check();
    interval = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [dismissed]);

  const handleDismiss = () => {
    setDismissed(true);
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <span className="shrink-0 text-base leading-none">⚠️</span>
      <div className="flex-1">
        <span className="font-medium">
          Rojo Server Active — Click "Connect" inside Roblox Studio's Rojo Plugin to start
          live-syncing.
        </span>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 text-amber-600 transition-colors hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200"
        title="Dismiss"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          aria-hidden="true"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

export const RojoConnectBanner = memo(RojoConnectBannerImpl);
