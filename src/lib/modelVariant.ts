/**
 * Reasoning effort to use after the selected model changes.
 *
 * A variant the user already chose (or the persisted default) stays selected
 * while the new model offers it. Otherwise fall back to "medium" once, or to
 * the model's own default when it has no such variant. Returning the current
 * value unchanged is what keeps a model switch from overwriting an explicit
 * choice.
 */
export function resolveVariantForModel(
  current: string | null,
  variants: readonly string[],
): string | null {
  if (current !== null && variants.includes(current)) return current;
  return variants.includes("medium") ? "medium" : null;
}
