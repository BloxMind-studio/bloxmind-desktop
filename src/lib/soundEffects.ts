// Short WebAudio cues for chat events. The Settings toggle flips the module
// flag from PreferencesProvider; every call is a no-op when disabled or when
// the environment has no AudioContext (jsdom, non-browser contexts).

let enabled = true;
let context: AudioContext | null = null;

export function setSoundEffectsEnabled(value: boolean): void {
  enabled = value;
}

function audioContext(): AudioContext | null {
  if (context) return context;
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

function tone(ctx: AudioContext, frequency: number, startAt: number, duration: number): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(0.05, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}

/** Soft blip when a message is submitted. */
export function playMessageSent(): void {
  if (!enabled) return;
  try {
    const ctx = audioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    tone(ctx, 660, now, 0.09);
  } catch {
    // Audio is a nicety; never let it break the send path.
  }
}

/** Two-note chime when the assistant finishes a response. */
export function playResponseReady(): void {
  if (!enabled) return;
  try {
    const ctx = audioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    tone(ctx, 523.25, now, 0.12);
    tone(ctx, 783.99, now + 0.1, 0.16);
  } catch {
    // Audio is a nicety; never let it break the chat.
  }
}
