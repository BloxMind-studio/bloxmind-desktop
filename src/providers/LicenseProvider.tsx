import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getLicenseStatus,
  loginWithRoblox,
  logoutLicense,
  subscribeLicenseStatus,
} from "@/lib/license";
import type { LicenseStatus } from "@/types/license";

interface LicenseContextValue {
  status: LicenseStatus;
  /** False until the initial status check has completed. */
  ready: boolean;
  loggingIn: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const LicenseContext = createContext<LicenseContextValue | null>(null);

export function useLicense(): LicenseContextValue {
  const context = useContext(LicenseContext);
  if (!context) {
    throw new Error("useLicense must be used within a LicenseProvider");
  }
  return context;
}

export function LicenseProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LicenseStatus>({
    kind: "unauthenticated",
    profile: null,
    hwid: null,
  });
  const [ready, setReady] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLicenseStatus()
      .then((initial) => {
        if (!cancelled) setStatus(initial);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    const unsubscribe = subscribeLicenseStatus(setStatus);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const login = useCallback(async () => {
    setLoggingIn(true);
    setError(null);
    try {
      const next = await loginWithRoblox();
      setStatus(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Roblox sign-in failed");
    } finally {
      setLoggingIn(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setError(null);
    try {
      await logoutLicense();
    } finally {
      setStatus({ kind: "unauthenticated", profile: null, hwid: null });
    }
  }, []);

  const value = useMemo(
    () => ({ status, ready, loggingIn, error, login, logout }),
    [status, ready, loggingIn, error, login, logout],
  );

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>;
}
