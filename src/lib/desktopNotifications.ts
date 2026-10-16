// Desktop notifications for finished responses. The Settings toggle flips the
// module flag from PreferencesProvider; calls are a no-op when disabled, when
// the Notification API is unavailable (jsdom), or when the window is visible —
// the toast in-app already covers the foreground case.

let enabled = true;

export function setNotificationsEnabled(value: boolean): void {
  enabled = value;
}

/** Show a system notification that the assistant finished responding. */
export function notifyResponseReady(): void {
  if (!enabled) return;
  if (typeof Notification === "undefined") return;
  if (typeof document === "undefined" || !document.hidden) return;
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
