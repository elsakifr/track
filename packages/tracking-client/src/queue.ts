/**
 * The position queue: a durable first-in, first-out buffer between a GPS source and the
 * uploader. It is the first half of the upload protocol (ADR-0008): a fix is queued before any
 * upload attempt, and it leaves the queue only when the server has acknowledged it.
 *
 * Every implementation (in memory now, SQLite on mobile in M3) must behave exactly as described
 * here and pass the shared conformance tests in `queue-conformance.ts`. The methods are async so
 * that a persistent store can implement the same interface.
 */
import { MAX_BATCH_SIZE } from '@track/shared';
import type { PositionEvent } from '@track/shared';

export interface PositionQueue {
  /**
   * Adds events at the end of the queue, in the given order.
   *
   * An event whose `event_id` is already in the queue is skipped, also within the same call, so
   * a producer can safely retry. The first copy is kept. An event that was already acknowledged
   * (and therefore removed) is accepted again; the server deduplicates it.
   *
   * @returns the number of events actually added.
   */
  enqueue(events: readonly PositionEvent[]): Promise<number>;

  /**
   * Returns up to `max` of the oldest events, without removing them. Calling it again before
   * acknowledging returns the same events.
   *
   * @param max 1 to `MAX_BATCH_SIZE` (500); anything else is rejected with a `RangeError`.
   */
  peekBatch(max: number): Promise<PositionEvent[]>;

  /**
   * Removes the events with these IDs. IDs that are not in the queue (unknown, or already
   * removed) are ignored, and the other events keep their order.
   *
   * @returns the number of events actually removed.
   */
  acknowledge(eventIds: readonly string[]): Promise<number>;

  /** The number of events waiting in the queue. */
  size(): Promise<number>;
}

/** Throws a `RangeError` unless `max` is a whole number from 1 to `MAX_BATCH_SIZE`. */
export function assertBatchLimit(max: number): void {
  if (!Number.isInteger(max) || max < 1 || max > MAX_BATCH_SIZE) {
    throw new RangeError(`Batch size must be a whole number from 1 to ${MAX_BATCH_SIZE}.`);
  }
}
