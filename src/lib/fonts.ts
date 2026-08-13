import type { FontStyle } from "@/types/desktop";

/**
 * Font-family stacks behind each Text Style preset in the Appearance tab.
 * Keep in sync with the `:root[data-font-style="..."]` rules in src/index.css,
 * which are the source of truth for how the running app renders.
 */
export const FONT_STYLE_STACKS: Record<FontStyle, string> = {
  quiet: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
  rounded: '"Nunito Sans", "Verdana", system-ui, sans-serif',
  classic: '"Georgia", "Times New Roman", serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", monospace',
  serif: '"Source Serif 4", "Iowan Old Style", "Palatino Linotype", serif',
  humanist: '"Gill Sans", "Trebuchet MS", system-ui, sans-serif',
};
