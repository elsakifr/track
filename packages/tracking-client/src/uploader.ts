/**
 * The uploader moves events from the position queue to the server, one batch at a time, and
 * removes them only when the server has acknowledged or permanently rejected them. It is the
 * second half of the upload protocol (ADR-0008); native watch apps follow the same rules.
 *
 * Guarantees:
 * - Nothing leaves the queue unless the server acknowledged it, or it was first saved to the
 *   rejected store. Failures, malformed transport results and stop() never remove events.
 * - At most one send is in progress (single-flight).
 * - Failures are retried with backoff; no sequence of failures causes a tight retry loop.
 */
import { MAX_BATCH_SIZE } from '@track/shared';
import type { PositionEvent } from '@track/shared';

import { backoffDelay, DEFAULT_BACKOFF } from './backoff.ts';
import type { BackoffOptions } from './backoff.ts';
import { assertBatchLimit } from './queue.ts';
import type { PositionQueue } from './queue.ts';
import type { RejectedEventStore, RejectedPosition } from './rejected-store.ts';
import { parseUploadOutcome } from './transport.ts';
import type { Transport, UploadOutcome } from './transport.ts';

export type UploaderOptions = {
  queue: PositionQueue;
  transport: Transport;
  rejectedStore: RejectedEventStore;
  /** Events per request, 1 to MAX_BATCH_SIZE (default 500). */
  batchSize?: number;
  /** Default: 1 s initial delay, 60 s maximum. */
  backoff?: BackoffOptions;
  /** A number in [0, 1) for the backoff jitter. Default `Math.random`; injected in tests. */
  random?: () => number;
};

export type UploaderState =
  'idle' | 'uploading' | 'waiting_to_retry' | 'paused_unauthorized' | 'paused_fatal' | 'stopped';

export type UploaderStatus = {
  state: UploaderState;
  /** Failed attempts in a row; reset by a successful upload or `resume()`. */
  consecutiveFailures: number;
  /** When the scheduled retry runs (ISO 8601), if one is scheduled. */
  nextRetryAt: string | null;
  lastError: string | null;
  lastSuccessAt: string | null;
};

export type FlushOutcome = 'drained' | 'retry_scheduled' | 'unauthorized' | 'fatal' | 'stopped';

export type FlushResult = {
  outcome: FlushOutcome;
  /** Events removed because the server accepted them or already had them. */
  acknowledged: number;
  /** Events moved to the rejected store. */
  rejected: number;
};

// setTimeout/clearTimeout exist on every target platform (React Native, browsers, Node, Deno)
// but are not part of the ES library types this platform-neutral package is compiled with.
const timers = globalThis as unknown as {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class Uploader {
  readonly #queue: PositionQueue;
  readonly #transport: Transport;
  readonly #rejectedStore: RejectedEventStore;
  readonly #batchSize: number;
  readonly #backoff: BackoffOptions;
  readonly #random: () => number;

  #inFlight: Promise<FlushResult> | null = null;
  #retryTimer: unknown = null;
  #nextRetryAt: number | null = null;
  #paused: 'unauthorized' | 'fatal' | null = null;
  #stopped = false;
  #failures = 0;
  #lastError: string | null = null;
  #lastSuccessAt: number | null = null;

  constructor(options: UploaderOptions) {
    const batchSize = options.batchSize ?? MAX_BATCH_SIZE;
    assertBatchLimit(batchSize);
    this.#queue = options.queue;
    this.#transport = options.transport;
    this.#rejectedStore = options.rejectedStore;
    this.#batchSize = batchSize;
    this.#backoff = options.backoff ?? DEFAULT_BACKOFF;
    this.#random = options.random ?? Math.random;
  }

  /**
   * Uploads until the queue is empty or a send does not succeed. Call it when new events are
   * queued. While a retry is scheduled it does not send (so frequent calls cannot bypass the
   * backoff); while an upload is running it returns that upload's result.
   */
  flush(): Promise<FlushResult> {
    if (this.#inFlight) return this.#inFlight;
    if (this.#stopped) return Promise.resolve(nothingSent('stopped'));
    if (this.#paused) return Promise.resolve(nothingSent(this.#paused));
    if (this.#retryTimer !== null) return Promise.resolve(nothingSent('retry_scheduled'));

    this.#inFlight = this.#run().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  /**
   * The network is back: cancel the scheduled retry and try now. The failure count is kept, so
   * a flapping connection still backs off if sends keep failing.
   */
  connectivityRestored(): Promise<FlushResult> {
    this.#cancelRetry();
    return this.flush();
  }

  /** Leaves the stopped or paused state (e.g. after signing in again) and uploads. */
  resume(): Promise<FlushResult> {
    this.#stopped = false;
    this.#paused = null;
    this.#failures = 0;
    this.#cancelRetry();
    return this.flush();
  }

  /**
   * Stops uploading: cancels a scheduled retry and starts no new sends. A send that is already
   * in progress cannot be recalled, so its result is still applied — events the server
   * acknowledged are removed, everything else stays queued — and then the upload ends. The
   * returned promise resolves when that has happened, so the queue is consistent afterwards.
   */
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#cancelRetry();
    if (this.#inFlight) await this.#inFlight;
  }

  status(): UploaderStatus {
    let state: UploaderState = 'idle';
    if (this.#stopped) state = 'stopped';
    else if (this.#paused) state = `paused_${this.#paused}`;
    else if (this.#inFlight) state = 'uploading';
    else if (this.#retryTimer !== null) state = 'waiting_to_retry';
    return {
      state,
      consecutiveFailures: this.#failures,
      nextRetryAt: this.#nextRetryAt === null ? null : new Date(this.#nextRetryAt).toISOString(),
      lastError: this.#lastError,
      lastSuccessAt:
        this.#lastSuccessAt === null ? null : new Date(this.#lastSuccessAt).toISOString(),
    };
  }

  async #run(): Promise<FlushResult> {
    let acknowledged = 0;
    let rejected = 0;
    const result = (outcome: FlushOutcome): FlushResult => ({ outcome, acknowledged, rejected });

    for (;;) {
      if (this.#stopped) return result('stopped');

      let batch: PositionEvent[];
      try {
        batch = await this.#queue.peekBatch(this.#batchSize);
      } catch (error) {
        return result(this.#retryLater(`Could not read the queue: ${describeError(error)}`));
      }
      if (batch.length === 0) {
        this.#failures = 0;
        return result('drained');
      }

      const outcome = await this.#send(batch);
      switch (outcome.kind) {
        case 'response': {
          const applied = await this.#apply(batch, outcome);
          acknowledged += applied.acknowledged;
          rejected += applied.rejected;
          if (applied.error !== null) {
            // Whatever could not be applied is still queued; try again later.
            return result(this.#retryLater(applied.error));
          }
          if (applied.acknowledged + applied.rejected === 0) {
            return result(this.#retryLater('The server acknowledged none of the sent events.'));
          }
          this.#failures = 0;
          this.#lastError = null;
          this.#lastSuccessAt = Date.now();
          continue; // next batch
        }
        case 'retryable':
          return result(this.#retryLater(outcome.reason, outcome.retryAfterMs));
        case 'unauthorized':
        case 'fatal':
          this.#paused = outcome.kind;
          this.#lastError = outcome.reason;
          return result(outcome.kind);
      }
    }
  }

  async #send(batch: readonly PositionEvent[]): Promise<UploadOutcome> {
    try {
      return parseUploadOutcome(await this.#transport(batch), batch.length);
    } catch (error) {
      return { kind: 'retryable', reason: `Transport error: ${describeError(error)}` };
    }
  }

  /**
   * Applies a server response to the queue. Order matters:
   * 1. remove acknowledged events (the server has them);
   * 2. save rejected events to the rejected store;
   * 3. only if saving succeeded, remove them from the queue.
   * Events the response does not mention, and IDs that were not in the batch, are left alone.
   */
  async #apply(
    batch: readonly PositionEvent[],
    outcome: Extract<UploadOutcome, { kind: 'response' }>,
  ): Promise<{ acknowledged: number; rejected: number; error: string | null }> {
    const sentIds = new Set(batch.map((event) => event.event_id));
    const ackIds = new Set(
      [...outcome.accepted, ...outcome.duplicates].filter((id) => sentIds.has(id)),
    );

    let acknowledged: number;
    try {
      acknowledged = await this.#queue.acknowledge([...ackIds]);
    } catch (error) {
      return {
        acknowledged: 0,
        rejected: 0,
        error: `Could not update the queue: ${describeError(error)}`,
      };
    }

    const rejectedAt = new Date().toISOString();
    const toReject = new Map<string, RejectedPosition>();
    for (const { index, reason } of outcome.rejected) {
      const event = batch[index];
      // An event the server also acknowledged is stored there; it is not a rejection.
      if (!event || ackIds.has(event.event_id) || toReject.has(event.event_id)) continue;
      toReject.set(event.event_id, { event, reason, rejected_at: rejectedAt });
    }
    if (toReject.size === 0) return { acknowledged, rejected: 0, error: null };

    try {
      await this.#rejectedStore.add([...toReject.values()]);
    } catch (error) {
      return {
        acknowledged,
        rejected: 0,
        error: `Could not save rejected events (they stay queued): ${describeError(error)}`,
      };
    }
    try {
      const removed = await this.#queue.acknowledge([...toReject.keys()]);
      return { acknowledged, rejected: removed, error: null };
    } catch (error) {
      // Saved but still queued: the next attempt may save them again (a duplicate in the
      // rejected store), but nothing is lost.
      return {
        acknowledged,
        rejected: 0,
        error: `Could not update the queue: ${describeError(error)}`,
      };
    }
  }

  /** Records the failure and schedules the next attempt, unless stopped. */
  #retryLater(reason: string, retryAfterMs?: number): FlushOutcome {
    this.#lastError = reason;
    if (this.#stopped) return 'stopped';
    const delay = Math.max(
      backoffDelay(this.#failures, this.#backoff, this.#random),
      retryAfterMs ?? 0,
    );
    this.#failures += 1;
    this.#nextRetryAt = Date.now() + delay;
    this.#retryTimer = timers.setTimeout(() => {
      this.#retryTimer = null;
      this.#nextRetryAt = null;
      void this.flush();
    }, delay);
    return 'retry_scheduled';
  }

  #cancelRetry() {
    if (this.#retryTimer !== null) timers.clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#nextRetryAt = null;
  }
}

const nothingSent = (outcome: FlushOutcome): FlushResult => ({
  outcome,
  acknowledged: 0,
  rejected: 0,
});
