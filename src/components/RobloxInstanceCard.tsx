import { memo, useMemo, useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────

interface RobloxInstanceCardProps {
  /** Raw JSON output string from the inspect_instance tool. */
  output: string;
  /** Optional reasoning text to show in a muted accordion. */
  reasoning?: string;
  /** Token stats to display as a footer badge. */
  tokens?: {
    input: number;
    output: number;
    cacheRead?: number;
  };
}

interface ParsedInstance {
  className: string;
  path: string;
  properties: Record<string, unknown>;
}

// ── Color helpers ────────────────────────────────────────────────────────

/**
 * Detect Roblox RGB float values (0–1 range) and convert to hex.
 *
 * Matches patterns like:
 * - `"0.141176, 0.141176, 0.180392"` (comma-separated)
 * - `"0.5 0.2 0.8"` (space-separated)
 *
 * Returns `null` if the value doesn't look like an RGB float triplet.
 */
function parseRgbFloat(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();

  // Try comma-separated: "0.141176, 0.141176, 0.180392"
  let parts = trimmed.split(",").map((s) => s.trim());
  if (parts.length !== 3) {
    // Try space-separated: "0.5 0.2 0.8"
    parts = trimmed.split(/\s+/).filter(Boolean);
  }
  if (parts.length !== 3) return null;

  const nums = parts.map((s) => Number.parseFloat(s));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 1)) return null;

  // Convert 0–1 float to 0–255 hex.
  const toHex = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${nums.map(toHex).join("").toUpperCase()}`;
}

/**
 * Determine if a property name is a color property that should show a swatch.
 */
const COLOR_PROPERTIES = new Set([
  "BackgroundColor3",
  "BorderColor3",
  "TextColor3",
  "TextStrokeColor3",
  "SelectionColor3",
  "Color3",
  "OutlineColor",
  "HoverColor",
  "PressedColor",
  "SliderColor",
  "ThumbColor",
  "TrackColor",
  "ActiveColor",
  "InactiveColor",
]);

function isColorProperty(key: string): boolean {
  return COLOR_PROPERTIES.has(key);
}

// ── Property display helpers ─────────────────────────────────────────────

/**
 * Properties to show in the compact key-properties table.
 * Ordered by importance.
 */
const KEY_PROPERTIES = [
  "Name",
  "ClassName",
  "BackgroundColor3",
  "BackgroundTransparency",
  "BorderColor3",
  "BorderSizePixel",
  "Position",
  "Size",
  "AnchorPoint",
  "Rotation",
  "Visible",
  "Active",
  "Text",
  "TextColor3",
  "TextSize",
  "Font",
  "TextScaled",
  "TextWrapped",
  "LayoutOrder",
  "Parent",
];

/**
 * Format a property value for display.
 * - Truncates long strings.
 * - Wraps arrays/objects in JSON.
 */
function formatPropertyValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    if (value.length > 120) return `${value.slice(0, 120)}…`;
    return value;
  }
  if (typeof value === "number") {
    // Round floats to 4 decimal places for readability.
    return Number.isInteger(value) ? String(value) : value.toFixed(4);
  }
  if (typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

// ── Parser ───────────────────────────────────────────────────────────────

/**
 * Parse the raw JSON output from `roblox-studio_inspect_instance` into
 * a structured {@link ParsedInstance}.
 *
 * The output is typically a JSON object with `className`, `path`, and
 * `properties` fields. We handle both the raw object and the MCP content
 * wrapper format.
 */
function parseInspectOutput(output: string): ParsedInstance | null {
  try {
    const raw = JSON.parse(output);

    // Handle MCP content wrapper: { content: [{ type: "json", json: {...} }] }
    const data =
      raw?.content?.[0]?.json ??
      raw?.content?.[0]?.text ??
      raw?.json ??
      raw;

    // If the data is still a string, try parsing it again.
    const obj = typeof data === "string" ? JSON.parse(data) : data;

    if (!obj || typeof obj !== "object") return null;

    const path =
      typeof obj.path === "string"
        ? obj.path
        : typeof obj.fullPath === "string"
          ? obj.fullPath
          : typeof obj.Name === "string"
            ? obj.Name
            : "Unknown";

    const className =
      typeof obj.className === "string"
        ? obj.className
        : typeof obj.ClassName === "string"
          ? obj.ClassName
          : "Instance";

    const properties: Record<string, unknown> = {};

    // Collect properties from the top-level object, excluding meta fields.
    const metaKeys = new Set(["className", "ClassName", "path", "fullPath", "content", "type"]);
    for (const [key, value] of Object.entries(obj)) {
      if (!metaKeys.has(key) && value !== null && value !== undefined) {
        properties[key] = value;
      }
    }

    // Also check for a nested `properties` object.
    if (obj.properties && typeof obj.properties === "object" && !Array.isArray(obj.properties)) {
      for (const [key, value] of Object.entries(obj.properties)) {
        if (value !== null && value !== undefined) {
          properties[key] = value;
        }
      }
    }

    return { className, path, properties };
  } catch {
    return null;
  }
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * A clean, interactive UI card for displaying Roblox instance inspection
 * results from the `roblox-studio_inspect_instance` tool.
 *
 * Features:
 * - **Collapsible container** — shows a header summary by default.
 * - **Breadcrumb pathing** — interactive path segments.
 * - **Smart color swatches** — auto-detects RGB float values and shows
 *   a visual color preview dot.
 * - **Key properties view** — compact table of essential properties.
 * - **Reasoning accordion** — muted gray "Thinking" section.
 * - **Token badge** — small unobtrusive footer with token stats.
 */
const RobloxInstanceCard = memo(function RobloxInstanceCard({
  output,
  reasoning,
  tokens,
}: RobloxInstanceCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isReasoningOpen, setIsReasoningOpen] = useState(false);

  const instance = useMemo(() => parseInspectOutput(output), [output]);

  // ── Breadcrumb segments ────────────────────────────────────────────────
  const breadcrumbs = useMemo(() => {
    if (!instance) return [];
    return instance.path.split(".").filter(Boolean);
  }, [instance]);

  // ── Key properties (ordered) ───────────────────────────────────────────
  const keyProps = useMemo(() => {
    if (!instance) return [];
    const entries: Array<{ key: string; value: unknown }> = [];
    for (const propKey of KEY_PROPERTIES) {
      if (propKey in instance.properties) {
        entries.push({ key: propKey, value: instance.properties[propKey] });
      }
    }
    return entries;
  }, [instance]);

  // ── Other properties (not in key props) ────────────────────────────────
  const otherProps = useMemo(() => {
    if (!instance) return [];
    const keySet = new Set(KEY_PROPERTIES);
    return Object.entries(instance.properties)
      .filter(([key]) => !keySet.has(key))
      .slice(0, 20); // Limit to avoid overwhelming the UI
  }, [instance]);

  if (!instance) {
    // Fallback: show raw output in a disclosure if parsing fails.
    return (
      <div className="min-w-0 max-w-full overflow-hidden">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex w-full items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent"
        >
          <span className="shrink-0">🔍</span>
          <span className="min-w-0 flex-1 truncate">Inspect Instance</span>
          <span className="shrink-0 text-[10px] opacity-60">{isOpen ? "▲" : "▼"}</span>
        </button>
        {isOpen && (
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {output.slice(0, 3000)}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-md border bg-card">
      {/* ── Header / Collapse toggle ──────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
      >
        <span className="shrink-0">🔍</span>
        <span className="min-w-0 flex-1 truncate">
          Inspect Instance: <span className="font-semibold">{instance.className}</span>
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground transition-transform duration-200">
          {isOpen ? "▲" : "▼"}
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-border">
          {/* ── Breadcrumbs ──────────────────────────────────────────── */}
          {breadcrumbs.length > 0 && (
            <div className="flex flex-wrap items-center gap-0.5 px-2.5 pt-2 text-[10px]">
              {breadcrumbs.map((segment, idx) => (
                <span key={idx} className="flex items-center gap-0.5">
                  {idx > 0 && (
                    <span className="mx-0.5 text-muted-foreground/40" aria-hidden="true">
                      ›
                    </span>
                  )}
                  <span
                    className={
                      idx === breadcrumbs.length - 1
                        ? "font-medium text-foreground"
                        : "text-muted-foreground/60"
                    }
                  >
                    {segment}
                  </span>
                </span>
              ))}
            </div>
          )}

          {/* ── Key Properties Table ─────────────────────────────────── */}
          {keyProps.length > 0 && (
            <div className="px-2.5 pt-2">
              <table className="w-full border-collapse text-[11px]">
                <tbody>
                  {keyProps.map(({ key, value }) => {
                    const hex = isColorProperty(key) ? parseRgbFloat(value) : null;
                    return (
                      <tr key={key} className="border-b border-border/30 last:border-b-0">
                        <td className="w-1/3 whitespace-nowrap py-0.5 pr-2 font-medium text-muted-foreground">
                          {key}
                        </td>
                        <td className="flex items-center gap-1.5 py-0.5">
                          {hex && (
                            <span
                              className="inline-block h-3 w-3 shrink-0 rounded-full border border-border"
                              style={{ backgroundColor: hex }}
                              title={hex}
                            />
                          )}
                          <span className="break-all text-foreground">
                            {formatPropertyValue(value)}
                            {hex && (
                              <span className="ml-1 text-[10px] text-muted-foreground/60">
                                {hex}
                              </span>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Other Properties (collapsible) ────────────────────────── */}
          {otherProps.length > 0 && (
            <details className="px-2.5 pt-1.5 pb-1">
              <summary className="cursor-pointer text-[10px] font-medium text-muted-foreground/60 transition-colors hover:text-muted-foreground">
                {otherProps.length} more propert{otherProps.length === 1 ? "y" : "ies"}
              </summary>
              <div className="mt-1 max-h-40 overflow-y-auto">
                <table className="w-full border-collapse text-[10px]">
                  <tbody>
                    {otherProps.map(([key, value]) => {
                      const hex = isColorProperty(key) ? parseRgbFloat(value) : null;
                      return (
                        <tr key={key} className="border-b border-border/20 last:border-b-0">
                          <td className="w-1/3 whitespace-nowrap py-0.5 pr-2 font-medium text-muted-foreground/60">
                            {key}
                          </td>
                          <td className="flex items-center gap-1.5 py-0.5">
                            {hex && (
                              <span
                                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-border"
                                style={{ backgroundColor: hex }}
                                title={hex}
                              />
                            )}
                            <span className="break-all text-muted-foreground/80">
                              {formatPropertyValue(value)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {/* ── Reasoning accordion ──────────────────────────────────── */}
          {reasoning && (
            <div className="border-t border-border/30 px-2.5 py-1">
              <button
                type="button"
                onClick={() => setIsReasoningOpen(!isReasoningOpen)}
                className="flex w-full items-center gap-1 text-[10px] text-muted-foreground/50 transition-colors hover:text-muted-foreground/80"
              >
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`shrink-0 transition-transform duration-150 ${isReasoningOpen ? "rotate-90" : ""}`}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span>Thinking</span>
              </button>
              {isReasoningOpen && (
                <div className="mt-1 whitespace-pre-wrap break-words pl-3 text-[10px] leading-relaxed text-muted-foreground/60">
                  {reasoning}
                </div>
              )}
            </div>
          )}

          {/* ── Token badge footer ───────────────────────────────────── */}
          {tokens && (
            <div className="flex items-center justify-end gap-2 border-t border-border/20 px-2.5 py-1 text-[9px] text-muted-foreground/40">
              <span>{tokens.input.toLocaleString()} in</span>
              <span>{tokens.output.toLocaleString()} out</span>
              {tokens.cacheRead !== undefined && tokens.cacheRead > 0 && (
                <span>{tokens.cacheRead.toLocaleString()} cached</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export { RobloxInstanceCard };
export type { RobloxInstanceCardProps };