import { useEffect, useRef, useState } from "react";
import { THEME_PRESETS, useUIPreferences } from "@/providers/PreferencesProvider";
import type { ThemeColors, ThemePreset } from "@/types/desktop";

const PRESET_ORDER: ThemePreset[] = ["soft-blue", "dark-neon", "emerald", "custom"];

const PRESET_LABELS: Record<ThemePreset, string> = {
  "soft-blue": "Soft Blue",
  "dark-neon": "Dark Neon",
  emerald: "Emerald",
  custom: "Custom",
};

const FIELD_LABELS: Record<keyof ThemeColors, string> = {
  selectedBg: "Selected / Active Background",
  selectedFg: "Selected / Active Text",
  hoverBg: "Hover Background",
  hoverFg: "Hover Text",
};

const FIELD_DESCRIPTIONS: Record<keyof ThemeColors, string> = {
  selectedBg: "Soft highlight behind active menu items, model selections, and sidebar sessions.",
  selectedFg: "Text color inside selected items.",
  hoverBg: "Overlay shown when hovering interactive elements.",
  hoverFg: "Text color when hovering interactive elements.",
};

const COLOR_INPUTS: Array<keyof ThemeColors> = ["selectedBg", "selectedFg", "hoverBg", "hoverFg"];

/** Normalizes #rgb/#rrggbb/#rrggbbaa and rgb()/rgba() strings to #rrggbb when
 *  possible, so a native <input type="color"> can display the swatch. */
function toHexInput(value: string): string {
  const trimmed = value.trim();
  let match = /^#([0-9a-f]{3,8})$/i.exec(trimmed);
  if (match) {
    let hex = match[1];
    if (hex.length === 3 || hex.length === 4) {
      hex = [...hex].map((c) => c + c).join("");
    }
    return `#${hex.slice(0, 6)}`;
  }
  match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i.exec(trimmed);
  if (match) {
    const toHex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${toHex(Number(match[1]))}${toHex(Number(match[2]))}${toHex(Number(match[3]))}`;
  }
  return "#000000";
}

/** Accepts #rgb, #rrggbb, #rrggbbaa, rgb(), rgba() and returns true when valid. */
function isColor(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed) ||
    /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:[,/]\s*[\d.]+%?)?\s*\)$/i.test(trimmed)
  );
}

export function ThemeColorsTab() {
  const { themePreset, themeColors, setThemePreset, setThemeColors } = useUIPreferences();

  const handlePreset = (preset: ThemePreset) => {
    if (preset === "custom") {
      setThemePreset("custom");
      return;
    }
    setThemePreset(preset);
  };

  const handleField = (field: keyof ThemeColors, value: string) => {
    if (!isColor(value)) return;
    setThemeColors({ ...themeColors, [field]: value });
  };

  return (
    <div className="mx-auto w-full max-w-md px-6 py-8">
      <h4 className="font-serif text-lg italic text-foreground">Theme Colors</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Customize the primary interactive colors. Changes apply instantly across the whole app.
      </p>

      {/* Presets */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Presets
        </div>
        <div className="grid grid-cols-2 gap-2">
          {PRESET_ORDER.map((preset) => {
            const selected = themePreset === preset;
            const colors =
              preset === "custom"
                ? themeColors
                : { ...THEME_PRESETS[preset as Exclude<ThemePreset, "custom">] };
            return (
              <button
                key={preset}
                type="button"
                onClick={() => handlePreset(preset)}
                aria-pressed={selected}
                className={`rounded-lg border px-3 py-2.5 text-center transition-colors ${
                  selected
                    ? "border-selected-foreground bg-selected/12 font-medium text-selected-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-hover/12"
                }`}
              >
                <div className="flex justify-center gap-1">
                  <span
                    className="h-4 w-4 rounded-full border border-border/60"
                    style={{ backgroundColor: colors.selectedBg }}
                    aria-hidden="true"
                  />
                  <span
                    className="h-4 w-4 rounded-full border border-border/60"
                    style={{ backgroundColor: colors.hoverBg }}
                    aria-hidden="true"
                  />
                </div>
                <span className="mt-1.5 block text-xs">{PRESET_LABELS[preset]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom color fields */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Colors
        </div>
        <div className="space-y-3">
          {COLOR_INPUTS.map((field) => (
            <ColorField
              key={field}
              label={FIELD_LABELS[field]}
              description={FIELD_DESCRIPTIONS[field]}
              value={themeColors[field]}
              onChange={(value) => handleField(field, value)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ColorField({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const [valid, setValid] = useState(true);
  const pickerRef = useRef<HTMLInputElement>(null);

  // Keep the text field in sync when a preset applies new colors.
  useEffect(() => {
    setText(value);
    setValid(true);
  }, [value]);

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => pickerRef.current?.click()}
          className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border transition-transform hover:scale-105"
          aria-label={`Pick color for ${label}`}
          title="Open color picker"
        >
          <span className="absolute inset-0" style={{ backgroundColor: value }} />
          <span className="absolute inset-0 grid place-items-center opacity-0 hover:opacity-100">
            <span className="rounded bg-black/40 px-1 text-[9px] font-semibold text-white">
              ...
            </span>
          </span>
        </button>
        <input
          ref={pickerRef}
          type="color"
          value={toHexInput(value)}
          onChange={(e) => {
            onChange(e.target.value);
            setText(e.target.value);
            setValid(true);
          }}
          className="sr-only"
          aria-label={`Visual color picker for ${label}`}
        />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-foreground">{label}</div>
          <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{description}</div>
        </div>
      </div>
      <div className="mt-2.5">
        <label
          htmlFor={`color-input-${label}`}
          className="mb-1 block text-[10px] text-muted-foreground"
        >
          HEX / RGBA
        </label>
        <input
          id={`color-input-${label}`}
          type="text"
          value={text}
          spellCheck={false}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            const ok = isColor(next);
            setValid(ok);
            if (ok) onChange(next);
          }}
          onBlur={() => {
            setText(value);
            setValid(true);
          }}
          className={`h-8 w-full rounded-md border bg-background px-2 font-mono text-xs outline-none transition-colors focus:ring-1 focus:ring-hover/40 ${
            valid ? "border-border" : "border-red-500/60"
          }`}
          placeholder="#39FF14 or rgba(57, 255, 20, 0.2)"
        />
        {!valid && (
          <p
            className="mt-1 text-[10px] text-red-500"
            role="alert"
            aria-live="polite"
          >
            Invalid color — use #rgb, #rrggbb, #rrggbbaa, rgb(), or rgba().
          </p>
        )}
      </div>
    </div>
  );
}
