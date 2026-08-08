import { useEffect, useRef, useState } from "react";

import { BloxMindLogo } from "@/components/BloxMindLogo";
import Chat from "@/components/Chat";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { useUpdater } from "@/hooks/useUpdater";
import { desktop } from "@/lib/desktop";
import { ActiveSessionProvider } from "@/providers/ActiveSessionProvider";
import { ExplorerReferenceProvider } from "@/providers/ExplorerReferenceProvider";
import { OpenCodeClientProvider } from "@/providers/OpenCodeClientProvider";
import { PreferencesProvider } from "@/providers/PreferencesProvider";
import { ProjectIndexProvider } from "@/providers/ProjectIndexProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import { StudioTargetProvider } from "@/providers/StudioTargetProvider";

function AppInner() {
  useUpdater();
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
    <main className="flex h-full flex-col overflow-hidden">
      <div className="app-titlebar flex h-9 shrink-0 items-center justify-between gap-3 border-b bg-card px-3">
        <div className="flex items-center gap-1.5" title="BloxMind">
          <BloxMindLogo size={18} />
          <span className="font-serif text-[12px] italic text-foreground">BloxMind</span>
        </div>
        {/* Non-interactive so the titlebar stays draggable. */}
        <div className="pointer-events-none select-none text-[10px] tabular-nums text-muted-foreground/70">
          {appVersion ? `v${appVersion}` : ""}
        </div>
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
        </ThemeProvider>
      </QueryProvider>
    </ErrorBoundary>
  );
}

export default App;
