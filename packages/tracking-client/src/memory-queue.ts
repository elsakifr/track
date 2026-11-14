/**
 * In-memory implementation of the position queue. Used in tests and by the simulator; the
 * mobile app gets a persistent (SQLite) implementation in M3, because memory is lost when the
 * app is terminated.
 */
import type { PositionEvent } from '@track/shared';

import { assertBatchLimit } from './queue.ts';
import type { PositionQueue } from './queue.ts';

export class InMemoryPositionQueue implements PositionQueue {
  // A Map keeps insertion order (first in, first out), and keying by event_id gives duplicate
  // detection and removal without scanning the whole queue.
  readonly #events = new Map<string, PositionEvent>();

  async enqueue(events: readonly PositionEvent[]): Promise<number> {
    let added = 0;
    for (const event of events) {
      if (this.#events.has(event.event_id)) continue;
      // Store a copy, so a caller changing its object later cannot change the queued event.
      this.#events.set(event.event_id, { ...event });
      added += 1;
    }
    return added;
  }

  async peekBatch(max: number): Promise<PositionEvent[]> {
    assertBatchLimit(max);
    const batch: PositionEvent[] = [];
    for (const event of this.#events.values()) {
      if (batch.length === max) break;
      // Return copies, as a persistent store would: changing them must not change the queue.
      batch.push({ ...event });
    }
    return batch;
  }

  async acknowledge(eventIds: readonly string[]): Promise<number> {
    let removed = 0;
    for (const id of eventIds) {
      if (this.#events.delete(id)) removed += 1;
    }
    return removed;
  }

  async size(): Promise<number> {
    return this.#events.size;
  }
}
