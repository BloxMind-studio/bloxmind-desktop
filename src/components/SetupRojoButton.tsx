import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { desktop } from "@/lib/desktop";

type SetupState = "idle" | "loading" | "installed";

function SetupRojoButtonImpl() {
  const [state, setState] = useState<SetupState>("idle");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const installed = await desktop.rojoCheckInstalled();
        if (!cancelled) setState(installed ? "installed" : "idle");
      } catch {
        // Browser/test mode intentionally has no Electron bridge.
        if (!cancelled) setState("idle");
      }
    };
    check();
    const interval = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleClick = useCallback(async () => {
    if (state === "installed") return;
    setState("loading");
    try {
      await desktop.rojoSetup((progress) => {
        if (progress.percent === undefined || progress.percent === 100) {
          toast.info(progress.message, { description: progress.phase });
        }
      });
      setState("installed");
      toast.success("Rojo is fully set up!", {
        description: "Open Roblox Studio, go to the Plugins tab, and click Connect.",
      });
    } catch (error) {
      setState("idle");
      toast.error("Rojo setup failed", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }, [state]);

  const isInstalled = state === "installed";

  if (isInstalled) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === "loading"}
      title={"1-Click Setup Rojo (downloads rojo.exe + Studio plugin)"}
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50"
    >
      {state === "loading" ? (
        <>
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-spin"
          >
            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
          </svg>
          <span>Installing Rojo…</span>
        </>
      ) : (
        <>
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
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>Setup Rojo</span>
        </>
      )}
    </button>
  );
}

export const SetupRojoButton = memo(SetupRojoButtonImpl);
