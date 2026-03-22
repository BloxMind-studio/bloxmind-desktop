import posthog from "posthog-js";

const POSTHOG_KEY = "phc_bOlMECnl02VBjOp2Y8PNOD36gSBmAuekirxhPKxjbEz";
const POSTHOG_HOST = "https://us.i.posthog.com";

let initialized = false;

export function initTelemetry(): void {
  if (initialized) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    persistence: "localStorage",
  });
  initialized = true;
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  if (!initialized) return;
  posthog.capture(event, properties);
}

export function identify(distinctId: string, properties?: Record<string, unknown>): void {
  if (!initialized) return;
  posthog.identify(distinctId, properties);
}
