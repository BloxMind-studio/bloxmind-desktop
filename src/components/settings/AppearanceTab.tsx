import { THEME_OPTIONS, type Theme, useTheme } from "@/components/theme-provider";

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();

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
    </div>
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
