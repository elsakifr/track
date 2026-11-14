/**
 * Exponential backoff with "equal jitter": the wait doubles after every failed attempt, up to a
 * maximum, and is randomized within the upper half of that window. The randomness spreads out
 * retries from many devices (e.g. after a shared network outage); the lower bound guarantees a
 * real pause, so repeated failures can never turn into a tight retry loop.
 */
export type BackoffOptions = { initialMs: number; maxMs: number };

export const DEFAULT_BACKOFF: BackoffOptions = { initialMs: 1_000, maxMs: 60_000 };

/**
 * @param attempt how many attempts in a row have failed before this one (0 for the first retry).
 * @param random a number in [0, 1), e.g. `Math.random`; injected so tests are deterministic.
 * @returns a delay in milliseconds, between half the window and the window
 *   (window = min(maxMs, initialMs × 2^attempt)).
 */
export function backoffDelay(
  attempt: number,
  options: BackoffOptions,
  random: () => number,
): number {
  const window = Math.min(options.maxMs, options.initialMs * 2 ** Math.min(attempt, 30));
  return Math.round(window / 2 + random() * (window / 2));
}
