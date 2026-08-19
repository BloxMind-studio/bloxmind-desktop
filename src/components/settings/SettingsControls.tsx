import type { ReactNode } from "react";

/**
 * Shared building blocks for the mode-specific settings panels. The three
 * panels (Apps / Games / Agent) previously hand-rolled the same shell, header,
 * section labels, and toggle rows. These primitives centralize that markup.
 */

export function SettingsShell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
}

export function SettingsHeader({
  title,
  icon,
  onClose,
}: {
  title: string;
  icon: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b px-4">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-xs font-semibold">{title}</h3>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover/12 hover:text-foreground"
        title="Close"
        aria-label="Close"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          role="img"
          aria-label="Close"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

/** Scrollable settings body. `children` are placed in a `space-y-4` column. */
export function SettingsBody({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-sm space-y-4">{children}</div>
    </div>
  );
}

/** Small uppercase section label inside the settings body. */
export function SettingsGroupLabel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`text-[10px] font-semibold uppercase tracking-wider text-muted-foreground ${className}`}
    >
      {children}
    </div>
  );
}

export function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-card/50 p-3">
      <div>
        <div className="text-xs font-medium">{title}</div>
        <div className="mt-0.5 text-[10.5px] text-muted-foreground">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-selected/80" : "bg-muted"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`}
        />
      </button>
    </div>
  );
}
