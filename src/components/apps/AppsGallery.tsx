import { AppWindow, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedApp } from "@/lib/appsBuilder/types";

function formatRelative(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Home screen for Apps mode. Lists every saved app (in-progress and completed)
 * so you can pick up where you left off, start a brand-new app, or delete one.
 */
export function AppsGallery({
  apps,
  onOpen,
  onNew,
  onDelete,
}: {
  apps: readonly SavedApp[];
  onOpen: (app: SavedApp) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  // Tracks which app card is awaiting delete confirmation (id → true).
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  // Auto-dismiss the confirmation after 3 s if the user doesn't act.
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!confirmingDeleteId) return;
    confirmTimerRef.current = setTimeout(() => setConfirmingDeleteId(null), 3000);
    return () => clearTimeout(confirmTimerRef.current);
  }, [confirmingDeleteId]);

  const handleDeleteClick = useCallback(
    (id: string) => {
      if (confirmingDeleteId === id) {
        // Second click — confirmed, fire the delete.
        onDelete(id);
        setConfirmingDeleteId(null);
      } else {
        // First click — arm the confirmation.
        setConfirmingDeleteId(id);
      }
    },
    [confirmingDeleteId, onDelete],
  );

  return (
    <div className="app-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-2xl italic text-foreground">Your Apps</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Pick up an app you're still working on, or reopen one you finished.
            </p>
          </div>
          <button
            type="button"
            data-testid="new-app"
            onClick={onNew}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            <Plus aria-hidden="true" size={14} />
            New App
          </button>
        </div>

        {apps.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/70 bg-card/40 px-6 py-14 text-center">
            <AppWindow aria-hidden="true" size={26} className="text-muted-foreground/60" />
            <p className="text-xs font-medium text-foreground">No apps yet</p>
            <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
              Describe an app and the AI agent will write a complete React + TypeScript project. Hit
              Save App to keep it here and come back to it whenever you want.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {apps.map((app) => (
              <div
                key={app.id}
                data-testid={`saved-app-${app.id}`}
                className="group flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-accent/40 hover:bg-hover/6"
              >
                <button
                  type="button"
                  data-testid={`open-app-${app.id}`}
                  onClick={() => onOpen(app)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background">
                    <AppWindow aria-hidden="true" size={16} className="text-accent" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-xs font-semibold text-foreground">
                        {app.name}
                      </span>
                      {app.status === "in-progress" ? (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          In progress
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                          Done
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {app.description ||
                        `${app.project.files.length} files · ${app.project.target} viewport`}
                    </span>
                  </span>
                </button>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                  Updated {formatRelative(app.updatedAt)}
                </span>
                <button
                  type="button"
                  data-testid={`delete-app-${app.id}`}
                  onClick={() => handleDeleteClick(app.id)}
                  title={confirmingDeleteId === app.id ? "Click again to confirm" : "Delete app"}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-medium transition-colors ${
                    confirmingDeleteId === app.id
                      ? "bg-red-500/15 text-red-500 ring-1 ring-red-500/40"
                      : "text-muted-foreground/60 hover:bg-red-500/10 hover:text-red-500"
                  }`}
                >
                  {confirmingDeleteId === app.id ? "?" : <Trash2 aria-hidden="true" size={13} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
