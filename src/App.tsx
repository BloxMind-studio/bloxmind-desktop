import { useEffect, useRef, useState } from "react";

import { BloxMindLogo } from "@/components/BloxMindLogo";
import Chat from "@/components/Chat";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ModeSwitcher } from "@/components/ModeSwitcher";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { useUpdater } from "@/hooks/useUpdater";
import { desktop } from "@/lib/desktop";
import { ActiveSessionProvider } from "@/providers/ActiveSessionProvider";
import { AgentStudioProvider } from "@/providers/AgentStudioProvider";
import { ExplorerReferenceProvider } from "@/providers/ExplorerReferenceProvider";
import { ModeProvider } from "@/providers/ModeProvider";
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
      <div className="app-titlebar flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border/50 bg-gradient-to-r from-card via-card to-accent/5 px-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <BloxMindLogo size={18} />
            <div className="absolute -inset-1 rounded-full bg-accent/20 blur-sm" />
          </div>
          <span className="font-serif text-sm font-semibold italic text-foreground tracking-tight">
            BloxMind
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-full border border-border/60 bg-background/30 px-2 py-0.5 [-webkit-app-region:no-drag]">
            <ModeSwitcher />
          </div>
          <div className="h-1 w-1 rounded-full bg-accent/60 animate-pulse" />
          <span className="text-[10px] font-medium tabular-nums text-muted-foreground/80">
            {appVersion ? `v${appVersion}` : ""}
          </span>
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
          <ModeProvider>
            <OpenCodeClientProvider activeSessionIdRef={activeSessionIdRef}>
              <ActiveSessionProvider activeSessionIdRef={activeSessionIdRef}>
                <PreferencesProvider>
                  <StudioTargetProvider>
                    <ExplorerReferenceProvider>
                      <ProjectIndexProvider>
                        <AgentStudioProvider>
                          <AppInner />
                        </AgentStudioProvider>
                      </ProjectIndexProvider>
                    </ExplorerReferenceProvider>
                  </StudioTargetProvider>
                </PreferencesProvider>
              </ActiveSessionProvider>
            </OpenCodeClientProvider>
          </ModeProvider>
        </ThemeProvider>
      </QueryProvider>
    </ErrorBoundary>
  );
}

export default App;
