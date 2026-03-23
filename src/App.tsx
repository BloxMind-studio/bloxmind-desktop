import { useRef } from "react";

import Chat from "@/components/Chat";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";
import { useUpdater } from "@/hooks/useUpdater";
import { ActiveSessionProvider } from "@/providers/ActiveSessionProvider";
import { OpenCodeClientProvider } from "@/providers/OpenCodeClientProvider";
import { PreferencesProvider } from "@/providers/PreferencesProvider";
import { QueryProvider } from "@/providers/QueryProvider";

function AppInner() {
  useUpdater();

  return (
    <main className="flex h-full flex-col overflow-hidden">
      <div
        className="flex h-9 shrink-0 items-center justify-end border-b bg-card px-3"
        data-tauri-drag-region
      />
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
    <QueryProvider>
      <OpenCodeClientProvider activeSessionIdRef={activeSessionIdRef}>
        <ActiveSessionProvider activeSessionIdRef={activeSessionIdRef}>
          <PreferencesProvider>
            <AppInner />
          </PreferencesProvider>
        </ActiveSessionProvider>
      </OpenCodeClientProvider>
    </QueryProvider>
  );
}

export default App;
