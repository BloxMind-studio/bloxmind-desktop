import { createElement, useEffect } from "react";
import { toast } from "sonner";

import { UpdateReleaseNotes } from "@/components/UpdateReleaseNotes";
import { desktop } from "@/lib/desktop";

// ── Semver helpers ──────────────────────────────────────────────────────

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

let updaterStarted = false;
let failureToastShown = false;

function parseSemver(version: string): SemVer | null {
  const match = version.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/** Returns true when the new version is a patch-only bump (e.g. 0.2.1→0.2.2). */
function isPatchOnly(current: SemVer, next: SemVer): boolean {
  return current.major === next.major && current.minor === next.minor;
}

/** Numeric semver comparison; returns true only when next is strictly newer. */
function isNewerThan(next: SemVer, current: SemVer): boolean {
  return (
    (next.major - current.major || next.minor - current.minor || next.patch - current.patch) > 0
  );
}

// ── Hook ────────────────────────────────────────────────────────────────

export function useUpdater(): void {
  useEffect(() => {
    if (updaterStarted) return;
    updaterStarted = true;

    let cancelled = false;

    async function run() {
      // Small delay so the app can finish rendering first.
      await new Promise((r) => setTimeout(r, 3000));
      if (cancelled) return;

      try {
        const update = await desktop.checkForUpdate();
        if (cancelled || !update) return;

        const currentVersion = await desktop.getVersion();
        const current = parseSemver(currentVersion);
        const next = parseSemver(update.version);
        // electron-updater reports the latest release even when the app is
        // already current; only act when the reported version is strictly
        // newer than what is running.
        if (cancelled || !current || !next || !isNewerThan(next, current)) return;
        const patch = isPatchOnly(current, next);

        if (patch) {
          // Patch update — auto-install silently.
          console.debug(
            `[updater] Auto-installing patch update ${currentVersion} → ${update.version}`,
          );
          await desktop.installUpdate();
        } else {
          // Minor/major — show persistent toast requiring manual action.
          console.debug(`[updater] Prompting for update ${currentVersion} → ${update.version}`);

          toast(`BloxMind ${update.version} is available`, {
            className: "update-available-toast",
            description: createElement(UpdateReleaseNotes, { body: update.body }),
            duration: Number.POSITIVE_INFINITY,
            action: {
              label: "Install & Restart",
              onClick: async () => {
                const toastId = toast.loading("Installing update...");
                try {
                  await desktop.installUpdate();
                } catch (err) {
                  console.error("[updater] Failed to install update:", err);
                  toast.dismiss(toastId);
                  toast.error("Update failed", {
                    description: err instanceof Error ? err.message : "Installation failed",
                  });
                }
              },
            },
          });
        }
      } catch (err) {
        console.error("[updater] Failed to check for updates:", err);
        // Low-key warning: only surface the first failure per launch so we
        // never nag on transient network issues. A failed check is non-fatal —
        // the next launch retries automatically.
        if (!failureToastShown) {
          failureToastShown = true;
          toast.warning("Couldn't check for updates", {
            description: "You're still on the latest installed build. We'll retry next launch.",
          });
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);
}
