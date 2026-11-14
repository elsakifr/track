/**
 * Where permanently rejected events go. The server will never accept them, so they must leave
 * the position queue (or they would block it), but they are kept here with the reason instead of
 * being silently discarded — for diagnostics and support. The uploader saves an event here
 * BEFORE removing it from the queue.
 *
 * The in-memory implementation is for tests and the simulator; the mobile app gets a persistent
 * (SQLite) implementation in M3.
 */
import type { PositionEvent } from '@track/shared';

export type RejectedPosition = {
  event: PositionEvent;
  /** The server's reason. Never contains event values (see the contract's validation issues). */
  reason: string;
  /** When the uploader stored it (ISO 8601). */
  rejected_at: string;
};

export interface RejectedEventStore {
  /** Saves all entries, or throws and saves none. */
  add(entries: readonly RejectedPosition[]): Promise<void>;
  /** Oldest first. */
  list(): Promise<RejectedPosition[]>;
  size(): Promise<number>;
}

export class InMemoryRejectedEventStore implements RejectedEventStore {
  #entries: RejectedPosition[] = [];

  async add(entries: readonly RejectedPosition[]): Promise<void> {
    this.#entries.push(...entries.map(copy));
  }

  async list(): Promise<RejectedPosition[]> {
    return this.#entries.map(copy);
  }

  async size(): Promise<number> {
    return this.#entries.length;
  }
}

// Copies in and out, as a persistent store would, so callers cannot change stored entries.
const copy = (entry: RejectedPosition): RejectedPosition => ({
  ...entry,
  event: { ...entry.event },
});
