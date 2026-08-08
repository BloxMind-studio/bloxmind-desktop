import { useRef, useState } from "react";
import { desktop } from "@/lib/desktop";
import type { UpdateInfo } from "@/types/desktop";

const TECHNOLOGIES = [
  { name: "OpenCode", url: "https://opencode.ai", description: "AI coding engine" },
  {
    name: "Roblox Studio MCP",
    url: "https://create.roblox.com/docs/studio/mcp",
    description: "Official Studio MCP server",
  },
  { name: "Rojo", url: "https://rojo.space", description: "Sync engine for Roblox" },
];

type UpdateCheckStatus = "idle" | "checking" | "available" | "downloading" | "up-to-date" | "error";

export function AboutTab({ appVersion }: { appVersion: string | null }) {
  const [updateStatus, setUpdateStatus] = useState<UpdateCheckStatus>("idle");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Hold on to the Update handle so we can download it later
  const updateRef = useRef<UpdateInfo | null>(null);

  async function handleCheckForUpdates() {
    setUpdateStatus("checking");
    setUpdateError(null);
    setUpdateVersion(null);
    try {
      const update = await desktop.checkForUpdate();
      if (!update) {
        setUpdateStatus("up-to-date");
        return;
      }
      updateRef.current = update;
      setUpdateVersion(update.version);
      setUpdateStatus("available");
    } catch (err) {
      console.error("[about] Failed to check for updates:", err);
      setUpdateError(err instanceof Error ? err.message : "Could not reach update server");
      setUpdateStatus("error");
    }
  }

  async function handleInstall() {
    const update = updateRef.current;
    if (!update) return;
    try {
      setUpdateStatus("downloading");
      await desktop.installUpdate();
    } catch (err) {
      console.error("[about] Failed to install update:", err);
      setUpdateError(err instanceof Error ? err.message : "Installation failed");
      setUpdateStatus("error");
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-6 py-8">
      <h4 className="font-serif text-lg italic text-foreground">About BloxMind</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        AI-assisted Roblox development, right from your desktop.
      </p>

      {/* Version & update check */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Version
        </div>
        <div className="rounded-lg border bg-card p-3.5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium">
                BloxMind{appVersion && <span className="font-mono"> v{appVersion}</span>}
              </span>
            </div>
            {updateStatus === "idle" && (
              <button
                onClick={handleCheckForUpdates}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent"
              >
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
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                Check for updates
              </button>
            )}
            {updateStatus === "checking" && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <svg
                  className="h-3 w-3 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                </svg>
                Checking...
              </span>
            )}
            {updateStatus === "up-to-date" && (
              <span className="flex items-center gap-1.5 text-[11px] text-emerald-600">
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
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Up to date
              </span>
            )}
            {updateStatus === "downloading" && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <svg
                  className="h-3 w-3 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                </svg>
                Installing...
              </span>
            )}
          </div>

          {/* Update available */}
          {updateStatus === "available" && updateVersion && (
            <div className="mt-3 flex items-center justify-between rounded-md border bg-background px-3 py-2">
              <span className="text-xs">
                <span className="font-medium">v{updateVersion}</span>{" "}
                <span className="text-muted-foreground">is available</span>
              </span>
              <button
                onClick={handleInstall}
                className="rounded-md bg-foreground px-3 py-1 text-[11px] font-medium text-background transition-opacity hover:opacity-90"
              >
                Install & Restart
              </button>
            </div>
          )}

          {/* Error */}
          {updateStatus === "error" && updateError && (
            <div className="mt-3">
              <p className="rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-600 dark:bg-red-950/40 dark:text-red-400">
                {updateError}
              </p>
              <button
                onClick={handleCheckForUpdates}
                className="mt-2 text-[11px] text-muted-foreground underline hover:text-foreground"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Built with */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Built With
        </div>
        <div className="rounded-lg border bg-card">
          {TECHNOLOGIES.map((tech, idx) => (
            <div key={tech.name}>
              {idx > 0 && <div className="mx-3.5 h-px bg-border" />}
              <a
                href={tech.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between px-3.5 py-2.5 transition-colors hover:bg-accent"
              >
                <div className="min-w-0">
                  <span className="text-xs font-medium">{tech.name}</span>
                  <span className="ml-2 text-[11px] text-muted-foreground">{tech.description}</span>
                </div>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-muted-foreground"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
          ))}
        </div>
        <p className="mt-3 px-1 text-[11px] leading-relaxed text-muted-foreground">
          BloxMind is powered by these projects. Thank you to the teams behind them.
        </p>
      </div>

      {/* Links */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Links
        </div>
        <div className="space-y-1.5">
          <a
            href="https://BloxMind.ai"
            target="_blank"
            rel="noreferrer"
            className="flex h-9 w-full items-center gap-2 rounded-lg border bg-card px-3.5 text-xs transition-colors hover:bg-accent"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            Website
          </a>
          <a
            href="https://github.com/YUouriii"
            target="_blank"
            rel="noreferrer"
            className="flex h-9 w-full items-center gap-2 rounded-lg border bg-card px-3.5 text-xs transition-colors hover:bg-accent"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            My GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
