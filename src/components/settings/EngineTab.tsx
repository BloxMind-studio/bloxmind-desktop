import { useEnginePreferences } from "@/providers/PreferencesProvider";

export function EngineTab() {
  const {
    temperature,
    setTemperature,
    maxTokens,
    setMaxTokens,
    systemPrompt,
    setSystemPrompt,
    customApiEndpoint,
    setCustomApiEndpoint,
  } = useEnginePreferences();

  return (
    <div className="mx-auto w-full max-w-md px-6 py-8">
      <h4 className="font-serif text-lg italic text-foreground">AI Engine</h4>
      <p className="mt-1 text-xs text-muted-foreground">Configure the behavior of the AI model.</p>

      {/* Temperature */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Temperature
        </div>
        <div className="rounded-lg border bg-card p-3.5">
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-muted-foreground">Precise</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-foreground"
            />
            <span className="text-[10px] text-muted-foreground">Creative</span>
          </div>
          <div className="mt-1 text-center text-[10px] text-muted-foreground">
            {temperature.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Max Tokens */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Max Tokens
        </div>
        <div className="rounded-lg border bg-card p-3.5">
          <input
            type="number"
            min={256}
            max={128_000}
            step={256}
            value={maxTokens}
            onChange={(e) =>
              setMaxTokens(
                Math.min(128_000, Math.max(256, Number.parseInt(e.target.value, 10) || 256)),
              )
            }
            className="h-8 w-full rounded border bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
          <div className="mt-1 text-[10px] text-muted-foreground">
            Max tokens per response (256–128,000)
          </div>
        </div>
      </div>

      {/* Custom API Endpoint */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Custom API Endpoint
        </div>
        <div className="rounded-lg border bg-card p-3.5">
          <input
            type="text"
            value={customApiEndpoint ?? ""}
            onChange={(e) => setCustomApiEndpoint(e.target.value.trim() || null)}
            placeholder="https://api.example.com/v1"
            className="h-8 w-full rounded border bg-background px-2 text-xs font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
          <div className="mt-1 text-[10px] text-muted-foreground">
            Leave empty to use the default endpoint.
          </div>
          {customApiEndpoint && (
            <button
              type="button"
              onClick={() => setCustomApiEndpoint(null)}
              className="mt-1 text-[10px] text-muted-foreground underline hover:text-foreground"
            >
              Reset to default
            </button>
          )}
        </div>
      </div>

      {/* System Prompt */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          System Prompt
        </div>
        <div className="rounded-lg border bg-card p-3.5">
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="You are a helpful AI assistant..."
            rows={4}
            className="h-24 w-full resize-y rounded border bg-background px-2 py-1.5 text-xs font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
          <div className="mt-1 text-[10px] text-muted-foreground">
            Custom instructions prepended to every conversation.
          </div>
        </div>
      </div>
    </div>
  );
}
