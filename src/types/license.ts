export interface RobloxProfile {
  userId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
}

export type LicenseStatusKind = "authenticated" | "unauthenticated";

export interface LicenseStatus {
  kind: LicenseStatusKind;
  profile: RobloxProfile | null;
  hwid: string | null;
}

/** The `window.electron.auth` bridge exposed by the preload script. */
export interface ElectronAuthApi {
  loginWithRoblox(): Promise<LicenseStatus>;
  getLicenseStatus(): Promise<LicenseStatus>;
  logout(): Promise<void>;
  onStatusChanged(listener: (status: LicenseStatus) => void): () => void;
}
