import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { useEffect } from "react";
import { toast } from "sonner";

// ── Semver helpers ──────────────────────────────────────────────────────

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

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

// ── Hook ────────────────────────────────────────────────────────────────

export function useUpdater(): void {
  useEffect(() => {
    let cancelled = false;

    async function run() {
      // Small delay so the app can finish rendering first.
      await new Promise((r) => setTimeout(r, 3000));
      if (cancelled) return;

      try {
        const update = await check();
        if (cancelled || !update) return;

        const currentVersion = await getVersion();
        const current = parseSemver(currentVersion);
        const next = parseSemver(update.version);
        const patch = current && next ? isPatchOnly(current, next) : false;

        if (patch) {
          // Patch update — auto-install silently.
          console.debug(
            `[updater] Auto-installing patch update ${currentVersion} → ${update.version}`,
          );
          await update.downloadAndInstall();
          await relaunch();
        } else {
          // Minor/major — show persistent toast requiring manual action.
          console.debug(`[updater] Prompting for update ${currentVersion} → ${update.version}`);

          toast(`BloxBot ${update.version} is available`, {
            description: update.body ?? "A new version is ready to install.",
            duration: Number.POSITIVE_INFINITY,
            action: {
              label: "Install & Restart",
              onClick: async () => {
                const toastId = toast.loading("Installing update...");
                try {
                  await update.downloadAndInstall();
                  await relaunch();
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
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);
}
