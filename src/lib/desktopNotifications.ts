// Desktop notifications for finished responses. The Settings toggle flips the
// module flag from PreferencesProvider; calls are a no-op when disabled, when
// the Notification API is unavailable (jsdom), or when the window is visible —
// the toast in-app already covers the foreground case.

let enabled = true;

export function setNotificationsEnabled(value: boolean): void {
  enabled = value;
}

import { desktop } from "@/lib/desktop";

/** Show a system notification that the assistant finished responding. */
export function notifyResponseReady(): void {
  if (!enabled) return;
  if (typeof document === "undefined" || !document.hidden) return;
  // Prefer the main-process notification in the desktop app: it can focus the
  // window on click and works even when the renderer is blocked. Fall back to
  // the Web Notification API in a browser / when the bridge isn't available.
  if (typeof window !== "undefined" && "BloxMind" in window) {
    void desktop.notifyResponseReady().catch(() => {
      // Fall through to the web path only if the bridge call fails unexpectedly.
      tryWebNotification();
    });
    return;
  }
  tryWebNotification();
}

function tryWebNotification(): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "denied") return;
  if (Notification.permission === "default") {
    void Notification.requestPermission().catch(() => {});
  }
  try {
    new Notification("BloxMind", { body: "Your assistant finished responding." });
  } catch {
    // Construction can throw on platforms without a notification backend.
  }
}
