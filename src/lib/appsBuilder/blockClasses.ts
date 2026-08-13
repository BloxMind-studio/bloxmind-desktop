import type { AppBlock, AppThemeMode } from "./types";

/** Shared Tailwind class fragments for every block type. Used by BOTH the live
 *  preview and the code generator so the exported app matches the preview
 *  pixel-for-pixel. The generated project defines --app-* variables on a
 *  `.light`/`.dark` root, matching the preview's theme wrapper below. */
export const ROOT_CLASS = "min-h-full w-full";

export function rootThemeClass(theme: AppThemeMode): string {
  return theme === "dark" ? "dark" : "light";
}

/** Block -> className used by the preview renderer. */
export function blockClass(block: AppBlock): string {
  switch (block.type) {
    case "heading":
      return "text-2xl font-bold tracking-tight text-[var(--app-text)]";
    case "text":
      return "text-sm leading-relaxed text-[var(--app-muted)]";
    case "stat":
      return "flex flex-col rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] p-4 shadow-sm";
    case "button":
      return "inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98]";
    case "input":
      return "w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2.5 text-sm text-[var(--app-text)] placeholder:text-[var(--app-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]";
    case "card":
      return "rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] p-4 shadow-sm";
    case "list":
      return "flex flex-col gap-1.5";
  }
}

/** Caption helper used by stat/list rows in both renderers. */
export const STAT_VALUE_CLASS =
  "text-3xl font-bold tabular-nums text-[var(--app-text)]";
export const STAT_LABEL_CLASS =
  "text-[11px] font-medium uppercase tracking-wider text-[var(--app-muted)]";
export const LIST_ROW_CLASS =
  "flex items-center justify-between rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-text)]";
export const CARD_TITLE_CLASS = "text-sm font-semibold text-[var(--app-text)]";
export const CARD_BODY_CLASS =
  "mt-1 text-xs leading-relaxed text-[var(--app-muted)]";

/** The lone <style> used to theme the preview; mirrors what the generated
 *  project ships in src/index.css. */
export const PREVIEW_THEME_CSS = `
.light {
  --app-bg: #f8fafc;
  --app-card: #ffffff;
  --app-border: #e2e8f0;
  --app-text: #0f172a;
  --app-muted: #64748b;
}

.dark {
  --app-bg: #0f172a;
  --app-card: #1e293b;
  --app-border: #334155;
  --app-text: #f1f5f9;
  --app-muted: #94a3b8;
}

.app-scrollbar::-webkit-scrollbar { width: 6px; }
.app-scrollbar::-webkit-scrollbar-thumb { background: color-mix(in srgb, currentColor 25%, transparent); border-radius: 3px; }
.app-scrollbar::-webkit-scrollbar-track { background: transparent; }
`;

/** Accent hex for a given theme (generator picks a tasteful default). */
export function accentFor(theme: AppThemeMode, requested: string | undefined): string {
  if (requested) return requested;
  return theme === "dark" ? "#818cf8" : "#6366f1";
}