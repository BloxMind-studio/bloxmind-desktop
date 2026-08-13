import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { loadConfig, patchConfig } from "@/lib/config";
import type { AppMode } from "@/types/desktop";

interface ModeContextValue {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

const ModeContext = createContext<ModeContextValue>({
  mode: "roblox",
  setMode: () => {},
});

export function useAppMode() {
  return useContext(ModeContext);
}

const STORAGE_KEY = "BloxMind-active-mode";

function readStoredMode(): AppMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "roblox" || raw === "apps" || raw === "agent") return raw;
  } catch {
    // ignore storage failures
  }
  return "roblox";
}

/**
 * Owns the global mode switcher state. Reads the persisted preference on mount
 * and mirrors every change to both AppConfig and localStorage so the choice
 * survives restarts and stays in sync across windows.
 */
export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppMode>(readStoredMode);
  const interactedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadConfig()
      .then((config) => {
        if (cancelled || !config.activeMode) return;
        setModeState((current) => {
          if (interactedRef.current) return current;
          return current === config.activeMode ? current : config.activeMode;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: AppMode) => {
    interactedRef.current = true;
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // best-effort
    }
    patchConfig({ activeMode: next }).catch(() => undefined);
  }, []);

  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>;
}
