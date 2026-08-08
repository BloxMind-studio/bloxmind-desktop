import { usePreferences } from "@/providers/PreferencesProvider";

export function BehaviorTab() {
  const {
    autoScroll,
    setAutoScroll,
    enterToSend,
    setEnterToSend,
    notificationsEnabled,
    setNotificationsEnabled,
  } = usePreferences();

  return (
    <div className="mx-auto w-full max-w-md px-6 py-8">
      <h4 className="font-serif text-lg italic text-foreground">Behavior</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Control how BloxMind behaves during conversations.
      </p>

      <div className="mt-6 space-y-3">
        {/* Auto-scroll */}
        <div className="rounded-lg border bg-card p-3.5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Auto-scroll on new messages</div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Automatically scroll to the bottom when new messages arrive.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoScroll}
              aria-label="Auto-scroll"
              onClick={() => setAutoScroll(!autoScroll)}
              className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                autoScroll ? "bg-foreground" : "bg-border"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-background transition-transform ${
                  autoScroll ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Enter to send */}
        <div className="rounded-lg border bg-card p-3.5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Enter to send</div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Press Enter to send a message. When disabled, use Shift+Enter to send.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enterToSend}
              aria-label="Enter to send"
              onClick={() => setEnterToSend(!enterToSend)}
              className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                enterToSend ? "bg-foreground" : "bg-border"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-background transition-transform ${
                  enterToSend ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Notifications */}
        <div className="rounded-lg border bg-card p-3.5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Notifications</div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Show toast notifications for events like session completion or errors.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={notificationsEnabled}
              aria-label="Notifications"
              onClick={() => setNotificationsEnabled(!notificationsEnabled)}
              className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                notificationsEnabled ? "bg-foreground" : "bg-border"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-background transition-transform ${
                  notificationsEnabled ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
