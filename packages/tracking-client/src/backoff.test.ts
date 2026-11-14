import { describe, expect, it } from 'vitest';

import { backoffDelay, DEFAULT_BACKOFF } from './backoff.ts';

const max = () => 1; // upper end of the jitter range
const min = () => 0; // lower end

describe('backoffDelay', () => {
  it('doubles from 1 s up to the 60 s maximum (default options)', () => {
    const delays = Array.from({ length: 9 }, (_, attempt) =>
      backoffDelay(attempt, DEFAULT_BACKOFF, max),
    );
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
  });

  it('randomizes within the upper half of the window', () => {
    expect(backoffDelay(0, DEFAULT_BACKOFF, min)).toBe(500);
    expect(backoffDelay(0, DEFAULT_BACKOFF, () => 0.5)).toBe(750);
    expect(backoffDelay(3, DEFAULT_BACKOFF, min)).toBe(4_000);
    expect(backoffDelay(10, DEFAULT_BACKOFF, min)).toBe(30_000);
  });

  it('never returns less than half the initial delay, so retries are never immediate', () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(backoffDelay(attempt, DEFAULT_BACKOFF, min)).toBeGreaterThanOrEqual(500);
    }
  });

  it('stays finite for very large attempt counts', () => {
    expect(backoffDelay(10_000, DEFAULT_BACKOFF, max)).toBe(60_000);
  });
});
