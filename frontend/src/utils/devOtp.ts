/**
 * One-slot, in-memory hand-off for the backend's mock-mode `dev_hint`.
 *
 * When no SMS provider is configured the backend still issues a real random
 * 6-digit code but cannot text it, and it returns that code as `dev_hint` in
 * non-production mock mode only. The signup screen sends the first code and then
 * navigates to the verify screen, so without a channel the developer would only
 * ever see the hint after pressing resend - and could not complete signup at all
 * on the first try.
 *
 * Deliberately in memory and never written to storage or navigation params: an
 * OTP must not end up in a persisted route, a log, or a deep link. Cleared on
 * read so it cannot linger behind a later screen.
 */
let pending: string | null = null;

export function setDevOtpHint(hint: string | null | undefined): void {
  pending = hint?.trim() ? hint : null;
}

/** Returns the pending hint once, then clears it. */
export function takeDevOtpHint(): string | null {
  const h = pending;
  pending = null;
  return h;
}
