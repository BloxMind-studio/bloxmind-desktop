import { createHighlighterCore } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

interface HighlightedToken {
  content: string;
  light?: string;
  dark?: string;
}

const highlighterPromise = createHighlighterCore({
  themes: [githubLight, githubDark],
  langs: [],
  engine: createJavaScriptRegexEngine(),
});

type AppCodeLanguage = "css" | "html" | "json" | "markdown" | "tsx" | "typescript" | "text";

const languageLoads = new Map<AppCodeLanguage, Promise<void>>();

function ensureLanguage(language: AppCodeLanguage): Promise<void> | null {
  const existing = languageLoads.get(language);
  if (existing) return existing;
  if (language === "text") return null;
  const loading = highlighterPromise.then(async (highlighter) => {
    switch (language) {
      case "css":
        await highlighter.loadLanguage((await import("@shikijs/langs/css")).default);
        break;
      case "html":
        await highlighter.loadLanguage((await import("@shikijs/langs/html")).default);
        break;
      case "json":
        await highlighter.loadLanguage((await import("@shikijs/langs/json")).default);
        break;
      case "markdown":
        await highlighter.loadLanguage((await import("@shikijs/langs/markdown")).default);
        break;
      case "tsx":
        await highlighter.loadLanguage((await import("@shikijs/langs/tsx")).default);
        break;
      case "typescript":
        await highlighter.loadLanguage((await import("@shikijs/langs/typescript")).default);
        break;
    }
  });
  languageLoads.set(language, loading);
  return loading;
}

/** Map a file path to the shiki language used to highlight it. */
export function languageForPath(path: string): AppCodeLanguage {
  const extension = path.includes(".") ? (path.split(".").pop()?.toLowerCase() ?? "") : "";
  switch (extension) {
    case "ts":
    case "mts":
    case "cts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "js":
    case "jsx":
    case "mjs":
      return "tsx";
    case "json":
      return "json";
    case "css":
      return "css";
    case "html":
    case "htm":
      return "html";
    case "md":
    case "markdown":
      return "markdown";
    default:
      return "text";
  }
}

function preserveIndentation(value: string) {
  return value.replace(/^( +)/, (indentation) => "\u00a0".repeat(indentation.length));
}

/**
 * Read-only syntax-highlighted code editor. Renders a scannable file view with
 * a line-number gutter; used in the Code Preview pane of the Apps Builder.
 */
export default function HighlightedCode({
  path,
  code,
  showLineNumbers = true,
}: {
  path: string;
  code: string;
  showLineNumbers?: boolean;
}) {
  const [lines, setLines] = useState<HighlightedToken[][] | null>(null);
  const language = languageForPath(path);

  useEffect(() => {
    let active = true;
    setLines(null);
    const loading = ensureLanguage(language);
    if (!loading) return;
    void loading.then(() =>
      highlighterPromise.then((highlighter) => {
        const tokenLines = highlighter.codeToTokensWithThemes(code, {
          lang: language,
          themes: { light: "github-light", dark: "github-dark" },
        });
        if (!active) return;
        setLines(
          tokenLines.map((line) =>
            line.map((token) => ({
              content: token.content,
              light: token.variants.light?.color,
              dark: token.variants.dark?.color,
            })),
          ),
        );
      }),
    );
    return () => {
      active = false;
    };
  }, [code, language]);

  const sourceLines = code.split("\n");
  const renderedLines = lines ?? null;

  return (
    <div className="app-scrollbar h-full overflow-auto bg-background/40" data-testid="code-editor">
      <div className="flex min-w-full w-max font-mono text-[12px] leading-[1.7]">
        {showLineNumbers && (
          <div
            aria-hidden="true"
            className="sticky left-0 select-none border-r bg-background/60 px-3 py-1 text-right text-muted-foreground/50"
          >
            {sourceLines.map((_, index) => (
              <div key={index} className="pr-1">
                {index + 1}
              </div>
            ))}
          </div>
        )}
        <div
          className={`min-w-min flex-1 whitespace-pre ${showLineNumbers ? "px-3 py-1" : "px-4 py-1"}`}
        >
          {renderCodeLines(renderedLines, sourceLines)}
        </div>
      </div>
    </div>
  );
}

function renderCodeLines(tokenLines: HighlightedToken[][] | null, sourceLines: string[]) {
  if (!tokenLines) {
    return (
      <code>
        {sourceLines.map((line, index) => (
          <div key={index}>{preserveIndentation(line) || "\u00a0"}</div>
        ))}
      </code>
    );
  }
  return (
    <code>
      {tokenLines.map((line, lineIndex) => (
        <div key={lineIndex}>
          {line.length === 0
            ? "\u00a0"
            : line.map((token, tokenIndex) => (
                <span
                  key={tokenIndex}
                  className="syntax-token"
                  style={
                    {
                      "--syntax-light": token.light,
                      "--syntax-dark": token.dark,
                    } as CSSProperties
                  }
                >
                  {tokenIndex === 0 ? preserveIndentation(token.content) : token.content}
                </span>
              ))}
        </div>
      ))}
    </code>
  );
}
