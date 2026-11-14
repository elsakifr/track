/**
 * The transport sends one batch to the server and reports what happened as a normalized
 * outcome. The uploader only knows these outcomes; everything HTTP-specific (URL,
 * authentication, status codes, headers, timeouts) belongs to a transport implementation. The
 * HTTP transport for `/ingest` follows once its response format is defined (#9).
 */
import type { PositionEvent } from '@track/shared';

/** A rejected event, identified by its position in the sent batch (an invalid event may not have a usable `event_id`). */
export type RejectedInBatch = { index: number; reason: string };

export type UploadOutcome =
  /** The server processed the batch. Events it does not mention stay queued and are sent again. */
  | {
      kind: 'response';
      /** Newly stored. */
      accepted: readonly string[];
      /** Already stored earlier (e.g. after a lost response). Counts as acknowledged. */
      duplicates: readonly string[];
      /** Permanently invalid; never retried. */
      rejected: readonly RejectedInBatch[];
    }
  /** Temporary problem (offline, timeout, server error, rate limit): try again later. */
  | { kind: 'retryable'; reason: string; retryAfterMs?: number }
  /** The credentials were refused: stop until the app has signed in again and calls `resume()`. */
  | { kind: 'unauthorized'; reason: string }
  /** The request itself is wrong (a client bug): stop until `resume()`, never discard data. */
  | { kind: 'fatal'; reason: string };

/**
 * Sends one batch. May throw on network errors; the uploader treats an exception as
 * `retryable`. Must not resolve before the server has answered (or the attempt has failed).
 */
export type Transport = (batch: readonly PositionEvent[]) => Promise<UploadOutcome>;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isRejectedEntry = (value: unknown, batchLength: number): value is RejectedInBatch => {
  if (typeof value !== 'object' || value === null) return false;
  const { index, reason } = value as Record<string, unknown>;
  return (
    typeof index === 'number' &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < batchLength &&
    typeof reason === 'string'
  );
};

/**
 * Checks a transport's result at runtime. Anything that does not match `UploadOutcome` becomes
 * `fatal`, so a buggy transport can never cause queued events to be removed. An invalid
 * `retryAfterMs` is ignored (normal backoff applies).
 */
export function parseUploadOutcome(value: unknown, batchLength: number): UploadOutcome {
  const malformed = (why: string): UploadOutcome => ({
    kind: 'fatal',
    reason: `Malformed transport outcome: ${why}.`,
  });
  if (typeof value !== 'object' || value === null) return malformed('not an object');
  const outcome = value as Record<string, unknown>;

  switch (outcome.kind) {
    case 'response': {
      const { accepted, duplicates, rejected } = outcome;
      if (!isStringArray(accepted) || !isStringArray(duplicates)) {
        return malformed('"accepted" and "duplicates" must be arrays of strings');
      }
      if (!Array.isArray(rejected) || !rejected.every((r) => isRejectedEntry(r, batchLength))) {
        return malformed('each rejected entry needs an index inside the batch and a reason');
      }
      return { kind: 'response', accepted, duplicates, rejected: rejected as RejectedInBatch[] };
    }
    case 'retryable': {
      if (typeof outcome.reason !== 'string') return malformed('"reason" must be a string');
      const { retryAfterMs } = outcome;
      const valid =
        typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0;
      return valid
        ? { kind: 'retryable', reason: outcome.reason, retryAfterMs }
        : { kind: 'retryable', reason: outcome.reason };
    }
    case 'unauthorized':
    case 'fatal': {
      if (typeof outcome.reason !== 'string') return malformed('"reason" must be a string');
      return { kind: outcome.kind, reason: outcome.reason };
    }
    default:
      return malformed('unknown "kind"');
  }
}
