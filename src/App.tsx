import { useEffect, useRef, useState } from "react";

import { BloxMindLogo } from "@/components/BloxMindLogo";
import Chat from "@/components/Chat";
import ErrorBoundary from "@/components/ErrorBoundary";
import { LicenseGate } from "@/components/LicenseGate";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { WindowControls } from "@/components/WindowControls";
import { useSessionPersistence } from "@/hooks/useSessionPersistence";
import { useUpdater } from "@/hooks/useUpdater";
import { desktop } from "@/lib/desktop";
import { ActiveSessionProvider } from "@/providers/ActiveSessionProvider";
import { ExplorerReferenceProvider } from "@/providers/ExplorerReferenceProvider";
import { LicenseProvider } from "@/providers/LicenseProvider";
import { OpenCodeClientProvider } from "@/providers/OpenCodeClientProvider";
import { PreferencesProvider } from "@/providers/PreferencesProvider";
import { ProjectIndexProvider } from "@/providers/ProjectIndexProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import { StudioTargetProvider } from "@/providers/StudioTargetProvider";

function AppInner() {
  useUpdater();
  useSessionPersistence();
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    desktop
      .getVersion()
      .then((version) => {
        if (!cancelled) setAppVersion(version);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex h-dvh w-screen flex-col overflow-hidden">
      <div
        className="app-titlebar flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background px-3 pt-[env(titlebar-area-height,0px)] [-webkit-app-region:drag]"
        style={{
          paddingTop: "max(0.5rem, env(titlebar-area-height))",
          paddingLeft: "max(0.75rem, env(titlebar-area-height))",
        }}
      >
        <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
          <BloxMindLogo size={18} />
          <span className="font-serif text-sm font-semibold italic text-foreground tracking-tight">
            BloxMind
          </span>
        </div>
        <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
          <div className="h-1 w-1 rounded-full bg-accent" />
          <span className="text-[10px] font-medium tabular-nums text-muted-foreground/80">
            {appVersion ? `v${appVersion}` : ""}
          </span>
        </div>
        <WindowControls />
      </div>
      <ErrorBoundary>
        <Chat />
      </ErrorBoundary>
      <Toaster />
    </main>
  );
}

function App() {
  const activeSessionIdRef = useRef<string | null>(null);

  return (
    <ErrorBoundary>
      <QueryProvider>
        <ThemeProvider>
          <LicenseProvider>
            <LicenseGate>
              <OpenCodeClientProvider activeSessionIdRef={activeSessionIdRef}>
                <ActiveSessionProvider activeSessionIdRef={activeSessionIdRef}>
                  <PreferencesProvider>
                    <StudioTargetProvider>
                      <ExplorerReferenceProvider>
                        <ProjectIndexProvider>
                          <AppInner />
                        </ProjectIndexProvider>
                      </ExplorerReferenceProvider>
                    </StudioTargetProvider>
                  </PreferencesProvider>
                </ActiveSessionProvider>
              </OpenCodeClientProvider>
            </LicenseGate>
          </LicenseProvider>
        </ThemeProvider>
      </QueryProvider>
    </ErrorBoundary>
  );
}

export default App;
