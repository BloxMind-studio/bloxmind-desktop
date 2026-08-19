/**
 * Class-variance utility used by shadcn/ui components.
 * Mirrors the implementation in `src/lib/utils.ts` but is self-contained
 * for the `@bloxmind-studio/ui` package.
 */
export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}