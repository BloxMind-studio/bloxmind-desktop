import { lazy, Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
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
      ? "text-[#d73a49]/60 dark:text-[#ff7b72]/55"
      : tone === "output"
        ? "text-muted-foreground/70 opacity-70 hover:opacity-100"
        : "text-muted-foreground/55";
  const handleContextMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Copy full text on right-click — user asked for one-click copy via right-click
    navigator.clipboard.writeText(formatted.text).catch(() => {});
    toast.success("Copied to clipboard", { duration: 1500 });
  };

  return (
    <div data-preserve-scroll className={`min-w-0 select-text ${tone === "output" ? "pl-3" : ""}`}>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        onContextMenu={handleContextMenu}
        title="Right-click to copy"
        className={`block w-full min-w-0 select-text text-left text-[13px] leading-relaxed transition-colors cursor-text ${toneClass}`}
      >
        {formatted.structured || language ? (
          <Suspense fallback={<span className="line-clamp-3 select-text">{formatted.text}</span>}>
            <span
              className={`block select-text ${isOpen ? "animate-disclosure-expand" : "animate-disclosure-collapse"}`}
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
                ? "animate-disclosure-expand block select-text whitespace-pre-wrap break-all"
                : previewLines === 1
                  ? "animate-disclosure-collapse block select-text truncate"
                  : "animate-disclosure-collapse line-clamp-3 select-text whitespace-pre-wrap"
            }
          >
            {formatted.text}
          </span>
        )}
      </button>
    </div>
  );
}
