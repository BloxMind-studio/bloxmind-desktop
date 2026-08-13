import { THEME_OPTIONS, type Theme, useTheme } from "@/components/theme-provider";
import { FONT_STYLE_STACKS } from "@/lib/fonts";
import { useUIPreferences } from "@/providers/PreferencesProvider";
import type { FontStyle } from "@/types/desktop";

const FONT_STYLES: Array<{ value: FontStyle; label: string; sample: string }> = [
  { value: "quiet", label: "Quiet", sample: "The quick brown fox" },
  { value: "rounded", label: "Rounded", sample: "The quick brown fox" },
  { value: "classic", label: "Classic", sample: "The quick brown fox" },
  { value: "mono", label: "Mono", sample: "The quick brown fox" },
  { value: "serif", label: "Serif", sample: "The quick brown fox" },
  { value: "humanist", label: "Humanist", sample: "The quick brown fox" },
];

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const { fontStyle, setFontStyle } = useUIPreferences();

  return (
    <div className="mx-auto w-full max-w-md px-6 py-8">
      <h4 className="font-serif text-lg italic text-foreground">Appearance</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Choose how BloxMind looks. System follows your OS preference.
      </p>

      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Theme
        </div>
        <div className="grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map((option) => {
            const selected = theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setTheme(option.value)}
                aria-pressed={selected}
                className={`rounded-lg border px-3 py-3 text-center transition-colors ${
                  selected
                    ? "border-foreground bg-selected/12 font-medium text-selected-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-hover/12"
                }`}
              >
                <ThemePreview swatch={option.value} />
                <span className="mt-2 block text-xs">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Font Style */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Text Style
        </div>
        <div className="grid grid-cols-2 gap-2">
          {FONT_STYLES.map((option) => {
            const selected = fontStyle === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setFontStyle(option.value)}
                aria-pressed={selected}
                className={`rounded-lg border px-3 py-2.5 text-center transition-colors ${
                  selected
                    ? "border-foreground bg-selected/12 font-medium text-selected-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-hover/12"
                }`}
              >
                <FontPreview style={option.value} />
                <span className="mt-1.5 block text-xs">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FontPreview({ style }: { style: FontStyle }) {
  return (
    <span
      className="block h-6 overflow-hidden text-[18px] leading-6 text-foreground"
      style={{ fontFamily: FONT_STYLE_STACKS[style] }}
    >
      Aa
    </span>
  );
}

function ThemePreview({ swatch }: { swatch: Theme }) {
  if (swatch === "light") {
    return (
      <div className="mx-auto flex h-10 w-full max-w-[72px] overflow-hidden rounded-md border border-stone-200">
        <div className="w-1/3 bg-stone-100" />
        <div className="flex-1 bg-stone-50" />
      </div>
    );
  }
  if (swatch === "dark") {
    return (
      <div className="mx-auto flex h-10 w-full max-w-[72px] overflow-hidden rounded-md border border-stone-700">
        <div className="w-1/3 bg-stone-800" />
        <div className="flex-1 bg-stone-950" />
      </div>
    );
  }
  return (
    <div className="mx-auto flex h-10 w-full max-w-[72px] overflow-hidden rounded-md border border-border">
      <div className="w-1/2 bg-stone-50" />
      <div className="w-1/2 bg-stone-950" />
    </div>
  );
}
