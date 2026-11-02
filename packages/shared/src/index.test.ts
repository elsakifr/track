import { describe, expect, it } from 'vitest';

import { CONTRACT_VERSION } from './index';

// Toolchain smoke test: proves Vitest runs in CI. Replace with real contract tests in M1.
describe('@track/shared', () => {
  it('exports a contract version', () => {
    expect(typeof CONTRACT_VERSION).toBe('number');
  });
});
