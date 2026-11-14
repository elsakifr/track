/**
 * A fake `/ingest` server for tests (test-only; not exported from the package). It validates
 * every batch with the real contract (`parsePositionBatch`), deduplicates on `event_id` like the
 * real server, and can be told to misbehave: go offline, fail, rate-limit, lose a response,
 * reject specific events, refuse credentials, return garbage, or hold a send in flight.
 */
import { parsePositionBatch } from '@track/shared';
import type { PositionEvent } from '@track/shared';

import type { RejectedInBatch, Transport, UploadOutcome } from './transport.ts';

/** What the next send should do instead of normal processing. */
export type ScriptedSend =
  | UploadOutcome
  /** Store the events, then report a timeout — the client never learns they were stored. */
  | { kind: 'lose_response' }
  /** The transport throws (e.g. a network exception). */
  | { kind: 'throw'; error: Error }
  /** Return this value as-is, to simulate a buggy transport. */
  | { kind: 'raw'; value: unknown }
  /** Acknowledge only the first `count` new events of the batch, and say nothing about the rest. */
  | { kind: 'partial'; count: number };

export class FakeIngestServer {
  /** Everything stored, by `event_id`. */
  readonly stored = new Map<string, PositionEvent>();
  /** Every batch received, in order (also failed ones). */
  readonly sends: PositionEvent[][] = [];
  /** Events with these IDs are rejected with reason "rejected by test". */
  readonly rejectIds = new Set<string>();
  offline = false;
  /** The highest number of sends that were in progress at the same time. */
  maxConcurrentSends = 0;

  #script: ScriptedSend[] = [];
  #concurrent = 0;
  #hold: { arrived: () => void; released: Promise<void> } | null = null;

  /** The next sends behave as scripted, one entry per send; then normal behaviour resumes. */
  script(...sends: ScriptedSend[]): void {
    this.#script.push(...sends);
  }

  /**
   * Holds the next send in flight until `release()` is called. `arrived` resolves once that
   * send has reached the server, so a test can act while the upload is in progress.
   */
  hold(): { arrived: Promise<void>; release: () => void } {
    let arrived!: () => void;
    let release!: () => void;
    const arrivedPromise = new Promise<void>((resolve) => (arrived = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    this.#hold = { arrived, released };
    return { arrived: arrivedPromise, release };
  }

  readonly transport: Transport = async (batch) => {
    this.sends.push(batch.map((event) => ({ ...event })));
    this.#concurrent += 1;
    this.maxConcurrentSends = Math.max(this.maxConcurrentSends, this.#concurrent);
    try {
      const hold = this.#hold;
      if (hold) {
        this.#hold = null;
        hold.arrived();
        await hold.released;
      }
      return this.#handle(batch);
    } finally {
      this.#concurrent -= 1;
    }
  };

  #handle(batch: readonly PositionEvent[]): UploadOutcome {
    const scripted = this.#script.shift();
    if (scripted) {
      switch (scripted.kind) {
        case 'lose_response':
          this.#process(batch);
          return { kind: 'retryable', reason: 'timeout (response lost)' };
        case 'throw':
          throw scripted.error;
        case 'raw':
          return scripted.value as UploadOutcome; // deliberately unchecked
        case 'partial': {
          const response = this.#process(batch);
          return { ...response, accepted: response.accepted.slice(0, scripted.count) };
        }
        default:
          return scripted;
      }
    }
    if (this.offline) return { kind: 'retryable', reason: 'offline' };
    return this.#process(batch);
  }

  /** Normal server behaviour: validate, reject, deduplicate, store. */
  #process(batch: readonly PositionEvent[]): Extract<UploadOutcome, { kind: 'response' }> {
    const parsed = parsePositionBatch({ events: batch });
    if (!parsed.ok) throw new Error('The fake server received an invalid batch envelope.');

    const rejected: RejectedInBatch[] = parsed.rejected.map(({ index, issues }) => ({
      index,
      reason: issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    }));
    const accepted: string[] = [];
    const duplicates: string[] = [];
    batch.forEach((event, index) => {
      if (rejected.some((r) => r.index === index)) return;
      if (this.rejectIds.has(event.event_id)) {
        rejected.push({ index, reason: 'rejected by test' });
      } else if (this.stored.has(event.event_id)) {
        duplicates.push(event.event_id);
      } else {
        this.stored.set(event.event_id, { ...event });
        accepted.push(event.event_id);
      }
    });
    return { kind: 'response', accepted, duplicates, rejected };
  }
}
