import type { ElectronAuthApi, LicenseStatus } from "@/types/license";

function authBridge(): ElectronAuthApi | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as Window & { electron?: { auth?: ElectronAuthApi } }).electron?.auth;
  return bridge ?? null;
}

/**
 * Returns the current license status. Outside the desktop app (browser dev,
 * e2e, tests) there is no auth bridge, so the app is treated as unlocked.
 */
export async function getLicenseStatus(): Promise<LicenseStatus> {
  const bridge = authBridge();
  if (!bridge) return { kind: "authenticated", profile: null, hwid: null };
  return bridge.getLicenseStatus();
}

export async function loginWithRoblox(): Promise<LicenseStatus> {
  const bridge = authBridge();
  if (!bridge) throw new Error("Roblox sign-in is only available in the desktop app");
  return bridge.loginWithRoblox();
}

export async function logoutLicense(): Promise<void> {
  await authBridge()?.logout();
}

export function subscribeLicenseStatus(listener: (status: LicenseStatus) => void): () => void {
  const bridge = authBridge();
  if (!bridge) return () => {};
  return bridge.onStatusChanged(listener);
}
