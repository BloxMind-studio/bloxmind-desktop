import type { ReactNode } from "react";
import { BloxMindLogo } from "@/components/BloxMindLogo";
import { WindowControls } from "@/components/WindowControls";
import { useLicense } from "@/providers/LicenseProvider";

/**
 * Blocks the app UI until a valid license session is verified. Once unlocked
 * it renders children unchanged; while locked it shows the Roblox sign-in
 * screen. Outside the desktop app (browser preview, e2e, tests) the license
 * bridge reports "authenticated", so the app always unlocks there.
 */
export function LicenseGate({ children }: { children: ReactNode }) {
  const { status, ready, loggingIn, error, login } = useLicense();

  if (!ready) return null;
  if (status.kind === "authenticated") return <>{children}</>;

  return (
    <main className="flex h-dvh w-screen flex-col overflow-hidden">
      <div
        className="app-titlebar flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border/50 bg-gradient-to-r from-card via-card to-accent/5 px-3 pt-[env(titlebar-area-height,0px)] [-webkit-app-region:drag]"
        style={{
          paddingTop: "max(0.5rem, env(titlebar-area-height))",
          paddingLeft: "max(0.75rem, env(titlebar-area-height))",
        }}
      >
        <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
          <div className="relative">
            <BloxMindLogo size={18} />
            <div className="absolute -inset-1 rounded-full bg-accent/20 blur-sm" />
          </div>
          <span className="font-serif text-sm font-semibold italic text-foreground tracking-tight">
            BloxMind
          </span>
        </div>
        <div className="[-webkit-app-region:no-drag]">
          <WindowControls />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center bg-card p-6">
        <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-card p-8 text-center shadow-xl">
          <div className="mx-auto mb-5 flex justify-center">
            <BloxMindLogo size={48} />
          </div>
          <h1 className="font-serif text-2xl font-semibold italic tracking-tight text-foreground">
            BloxMind
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with your Roblox account to unlock your AI workspace.
          </p>
          {error ? (
            <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void login()}
            disabled={loggingIn}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loggingIn ? "Waiting for Roblox..." : "Sign in with Roblox"}
          </button>
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground/70">
            Opens your browser to authorize BloxMind. Your session is stored securely on this
            device.
          </p>
        </div>
      </div>
    </main>
  );
}
