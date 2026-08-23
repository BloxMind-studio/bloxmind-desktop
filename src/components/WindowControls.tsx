import { Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { desktop } from "@/lib/desktop";

/**
 * Frameless-window titlebar controls.
 *
 * The Electron window is created with `frame: false`, so there is no OS
 * chrome to minimize/maximize/close the app; these buttons drive the real
 * BrowserWindow through the desktop bridge. In a plain browser preview the
 * bridge calls reject and are swallowed, so the buttons render inert.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let disposed = false;
    desktop
      .windowIsMaximized()
      .then((value) => {
        if (!disposed) setMaximized(value);
      })
      .catch(() => undefined);
    const unsubscribe = desktop.onWindowMaximizedChange((value) => setMaximized(value));
    return () => {
      disposed = true;
      // Bridge implementations always hand back a synchronous unsubscribe; the
      // guard keeps a contract-drifting mock from white-screening the app.
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  const buttonClass =
    "flex h-[30px] w-[34px] items-center justify-center text-muted-foreground/70 transition-colors hover:bg-hover/12 hover:text-foreground";

  return (
    <div
      className="flex shrink-0 items-stretch justify-end [-webkit-app-region:no-drag]"
      data-testid="window-controls"
    >
      <button
        type="button"
        data-testid="window-minimize"
        aria-label="Minimize"
        title="Minimize"
        className={buttonClass}
        onClick={() => desktop.windowMinimize()}
      >
        <Minus aria-hidden="true" size={13} />
      </button>
      <button
        type="button"
        data-testid="window-maximize"
        aria-label={maximized ? "Restore" : "Maximize"}
        title={maximized ? "Restore" : "Maximize"}
        className={buttonClass}
        onClick={() => desktop.windowMaximizeToggle()}
      >
        {maximized ? (
          <span className="relative h-3 w-3">
            <span className="absolute left-0 bottom-0 h-2 w-2 border border-current" />
            <span className="absolute top-0 left-[4px] h-2 w-2 border border-current" />
          </span>
        ) : (
          <Square aria-hidden="true" size={11} />
        )}
      </button>
      <button
        type="button"
        data-testid="window-close"
        aria-label="Close"
        title="Close"
        className="flex h-[30px] w-[34px] items-center justify-center text-muted-foreground/70 transition-colors hover:bg-red-500/90 hover:text-white"
        onClick={() => desktop.windowClose()}
      >
        <X aria-hidden="true" size={14} />
      </button>
    </div>
  );
}
