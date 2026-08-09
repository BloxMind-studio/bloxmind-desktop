import { useUIPreferences } from "@/providers/PreferencesProvider";

const ACCENT_COLORS = [
  { value: "indigo" as const, label: "Indigo", class: "bg-indigo-500" },
  { value: "blue" as const, label: "Blue", class: "bg-blue-500" },
  { value: "violet" as const, label: "Violet", class: "bg-violet-500" },
  { value: "emerald" as const, label: "Emerald", class: "bg-emerald-500" },
  { value: "rose" as const, label: "Rose", class: "bg-rose-500" },
  { value: "amber" as const, label: "Amber", class: "bg-amber-500" },
];

export function GeneralTab() {
  const {
    accentColor,
    setAccentColor,
    layoutDensity,
    setLayoutDensity,
    fontSize,
    setFontSize,
    soundEffects,
    setSoundEffects,
  } = useUIPreferences();

  return (
    <div className="mx-auto w-full max-w-md px-6 py-8">
      <h4 className="font-serif text-lg italic text-foreground">General</h4>
      <p className="mt-1 text-xs text-muted-foreground">Customize your BloxMind experience.</p>

      {/* Accent Color */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Accent Color
        </div>
        <div className="flex gap-2">
          {ACCENT_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              onClick={() => setAccentColor(color.value)}
              aria-label={color.label}
              aria-pressed={accentColor === color.value}
              className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all ${
                accentColor === color.value
                  ? "border-foreground scale-110"
                  : "border-border hover:border-muted-foreground"
              }`}
            >
              <span className={`h-5 w-5 rounded-full ${color.class}`} />
            </button>
          ))}
        </div>
      </div>

      {/* Layout Density */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Layout Density
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(["compact", "comfortable"] as const).map((density) => (
            <button
              key={density}
              type="button"
              onClick={() => setLayoutDensity(density)}
              aria-pressed={layoutDensity === density}
              className={`rounded-lg border px-3 py-2.5 text-center text-xs transition-colors ${
                layoutDensity === density
                  ? "border-foreground bg-accent font-medium text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {density === "compact" ? "Compact" : "Comfortable"}
            </button>
          ))}
        </div>
      </div>

      {/* Font Size */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Font Size
        </div>
        <div className="rounded-lg border bg-card p-3.5">
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">A</span>
            <input
              type="range"
              min="0.8"
              max="1.2"
              step="0.05"
              value={fontSize}
              onChange={(e) => setFontSize(parseFloat(e.target.value))}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-foreground"
            />
            <span className="text-sm font-medium text-foreground">A</span>
          </div>
          <div className="mt-1 text-center text-[10px] text-muted-foreground">
            {Math.round(fontSize * 100)}%
          </div>
        </div>
      </div>

      {/* Sound Effects */}
      <div className="mt-6">
        <div className="rounded-lg border bg-card p-3.5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Sound Effects</div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Play audio cues for events like sending a message or receiving a response.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={soundEffects}
              aria-label="Sound effects"
              onClick={() => setSoundEffects(!soundEffects)}
              className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                soundEffects ? "bg-foreground" : "bg-border"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-background transition-transform ${
                  soundEffects ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
