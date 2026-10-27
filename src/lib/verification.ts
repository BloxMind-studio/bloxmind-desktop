import { Schema } from "effect";

/**
 * How much verification the assistant does after it changes the place. The
 * user picks one in Settings → Behavior; every message carries the matching
 * instruction, so the engine never has to infer it.
 */
export const VerificationLevelSchema = Schema.Literal("off", "ask", "quick", "full");

export type VerificationLevel = typeof VerificationLevelSchema.Type;

/** Light verification is enough to catch a broken edit without a playtest. */
export const DEFAULT_VERIFICATION_LEVEL: VerificationLevel = "quick";

export interface VerificationOption {
  value: VerificationLevel;
  label: string;
  /** One line for the Settings list. */
  description: string;
  /** What the assistant is told to do at this level. */
  instruction: string;
}

export const VERIFICATION_OPTIONS: readonly VerificationOption[] = [
  {
    value: "off",
    label: "Off",
    description: "Make the change and report. No playtest, screenshot or reinspection.",
    instruction:
      "Do not verify the change. Do not playtest, take screenshots, re-inspect the place, or run checks. Make the smallest coherent change, then report what changed and what you did not check.",
  },
  {
    value: "ask",
    label: "Ask me",
    description: "Ask you to try the change in Studio instead of testing it itself.",
    instruction:
      "Do not test the change yourself: no playtests, screenshots or reinspection. When the change is ready, ask the user to try it in Studio and tell you whether it works, then wait for their answer before doing anything else.",
  },
  {
    value: "quick",
    label: "Quick check",
    description:
      "Re-read the changed code and take one screenshot. No playtest or simulated clicks.",
    instruction:
      "Verify in one short pass: re-read the code and properties you changed, and take at most one screenshot if the change is visual. Do not run playtests, scripts, log checks or simulated clicks. If a change is an interaction you cannot confirm without using it, report it as unverified and ask the user to try it instead of clicking around. Stop as soon as that check confirms the change is in place.",
  },
  {
    value: "full",
    label: "Full test",
    description: "Playtest, read the output and logs, and check screenshots before reporting.",
    instruction:
      "Verify thoroughly before reporting: playtest the place, read the playtest output and logs, take screenshots of the result, and check the flows your change touches. When you exercise a control, target it by its real name or API instead of guessing coordinates, and confirm the input actually hit it before judging the result. Fix what fails.",
  },
];

function optionFor(level: VerificationLevel | null | undefined): VerificationOption {
  return (
    VERIFICATION_OPTIONS.find((option) => option.value === level) ??
    VERIFICATION_OPTIONS.find((option) => option.value === DEFAULT_VERIFICATION_LEVEL) ??
    VERIFICATION_OPTIONS[0]
  );
}

/**
 * The system-prompt note for a verification level. It is appended to every
 * message the user sends so a chat-only or inspect-only turn does not turn into
 * a long testing pass unless the user asked for one.
 */
export function verificationGuidance(level?: VerificationLevel | null): string {
  const option = optionFor(level);
  return [
    `## Verification level: ${option.label}`,
    "The user chose how much verification BloxMind does after changing the place. Follow this level; it overrides any general instruction to verify. A test the user asks for in their own message still runs.",
    option.instruction,
    "Before treating a check as failed, confirm it targeted the real instance or control. A missed click or wrong target is a test mistake, not a bug: correct the check at most once, then report it as unverified instead of investigating further. Never re-run a check that already passed or chain extra checks after one passes.",
    "Report what you checked; never claim something works if this level did not check it.",
  ].join("\n\n");
}
