import { lazy, Suspense, useMemo, useState } from "react";
import type { HighlightLanguage } from "@/components/SyntaxHighlightedOutput";

const SyntaxHighlightedOutput = lazy(() => import("@/components/SyntaxHighlightedOutput"));

export function InlineDisclosure({
  text,
  tone = "reasoning",
  previewLines = 1,
  language,
}: {
  text: string;
  tone?: "reasoning" | "error" | "output";
  previewLines?: number;
  language?: HighlightLanguage;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const formatted = useMemo(() => {
    if (tone !== "output") return { text, structured: false };
    const trimmed = text.trim();
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
      return { text, structured: false };
    }
    try {
      const value: unknown = JSON.parse(trimmed);
      if (value === null || typeof value !== "object") return { text, structured: false };
      return { text: JSON.stringify(value, null, 2), structured: true };
    } catch {
      return { text, structured: false };
    }
  }, [text, tone]);
  const toneClass =
    tone === "error"
      ? "text-[#d73a49]/60 hover:text-[#d73a49]/85 dark:text-[#ff7b72]/55 dark:hover:text-[#ff7b72]/80"
      : tone === "output"
        ? "text-muted-foreground/70 opacity-70 hover:text-muted-foreground hover:opacity-100"
        : "text-muted-foreground/55 hover:text-muted-foreground";
  return (
    <div data-preserve-scroll className={`min-w-0 ${tone === "output" ? "pl-3" : ""}`}>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={`block w-full min-w-0 text-left text-[13px] leading-relaxed transition-colors ${toneClass}`}
      >
        {formatted.structured || language ? (
          <Suspense fallback={<span className="line-clamp-3">{formatted.text}</span>}>
            <span
              className={`block ${isOpen ? "animate-disclosure-expand" : "animate-disclosure-collapse"}`}
            >
              <SyntaxHighlightedOutput
                code={formatted.text}
                collapsed={!isOpen}
                language={language ?? "json"}
              />
            </span>
          </Suspense>
        ) : (
          <span
            className={
              isOpen
                ? "animate-disclosure-expand block whitespace-pre-wrap break-all"
                : previewLines === 1
                  ? "animate-disclosure-collapse block truncate"
                  : "animate-disclosure-collapse line-clamp-3 whitespace-pre-wrap"
            }
          >
            {formatted.text}
          </span>
        )}
      </button>
    </div>
  );
}
