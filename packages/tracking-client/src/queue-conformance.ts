/**
 * Conformance tests for `PositionQueue`. Every implementation runs this same suite, so the
 * in-memory queue, the SQLite queue (M3) and any future implementation behave identically. The
 * tests are also the readable reference for native watch apps that implement the upload
 * protocol (ADR-0008).
 *
 * Usage, in an implementation's `*.test.ts` file:
 *   describePositionQueue('MyQueue', () => new MyQueue());
 *
 * Test-only: not exported from the package entry point, so Vitest never ends up in app code.
 */
import { MAX_BATCH_SIZE, positionEventSchema } from '@track/shared';
import type { PositionEvent } from '@track/shared';
import { describe, expect, it } from 'vitest';

import type { PositionQueue } from './queue.ts';

/** A valid contract event with a deterministic UUID v4 `event_id`, numbered by `n`. */
export function makeEvent(n: number, overrides: Partial<PositionEvent> = {}): PositionEvent {
  return {
    contract_version: 1,
    event_id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
    source_type: 'simulator',
    recorded_at: new Date(Date.UTC(2026, 10, 14, 9, 0, 0) + n * 1000).toISOString(),
    lat: 59.3,
    lon: 18.05,
    accuracy_m: 4,
    altitude_m: null,
    speed_mps: 3.2,
    heading_deg: null,
    ...overrides,
  };
}

const events = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => makeEvent(from + i));
const ids = (list: readonly PositionEvent[]) => list.map((event) => event.event_id);

export function describePositionQueue(
  name: string,
  createQueue: () => PositionQueue | Promise<PositionQueue>,
): void {
  describe(`${name} — PositionQueue conformance`, () => {
    it('uses valid contract events as test data', () => {
      for (const event of events(0, 3)) {
        expect(positionEventSchema.safeParse(event).success).toBe(true);
      }
    });

    it('starts empty', async () => {
      const queue = await createQueue();
      expect(await queue.size()).toBe(0);
      expect(await queue.peekBatch(MAX_BATCH_SIZE)).toEqual([]);
    });

    it('returns events first in, first out, across several enqueue calls', async () => {
      const queue = await createQueue();
      await queue.enqueue([makeEvent(1)]);
      await queue.enqueue([makeEvent(2), makeEvent(3)]);
      expect(ids(await queue.peekBatch(10))).toEqual(
        ids([makeEvent(1), makeEvent(2), makeEvent(3)]),
      );
    });

    it('keeps every field of an event unchanged', async () => {
      const queue = await createQueue();
      const event = makeEvent(1, { altitude_m: 12.5, heading_deg: 270 });
      await queue.enqueue([event]);
      expect(await queue.peekBatch(1)).toEqual([event]);
    });

    it('reports how many events were added; an empty enqueue adds nothing', async () => {
      const queue = await createQueue();
      expect(await queue.enqueue(events(0, 3))).toBe(3);
      expect(await queue.enqueue([])).toBe(0);
      expect(await queue.size()).toBe(3);
    });

    it('does not remove events when peeking', async () => {
      const queue = await createQueue();
      await queue.enqueue(events(0, 3));
      const first = await queue.peekBatch(10);
      const second = await queue.peekBatch(10);
      expect(ids(second)).toEqual(ids(first));
      expect(await queue.size()).toBe(3);
    });

    it('returns at most `max` events, the oldest ones', async () => {
      const queue = await createQueue();
      await queue.enqueue(events(0, 5));
      expect(ids(await queue.peekBatch(2))).toEqual(ids(events(0, 2)));
    });

    it(`accepts batch sizes from 1 to ${MAX_BATCH_SIZE} and rejects anything else`, async () => {
      const queue = await createQueue();
      await queue.enqueue(events(0, 3));
      expect(await queue.peekBatch(1)).toHaveLength(1);
      expect(await queue.peekBatch(MAX_BATCH_SIZE)).toHaveLength(3);
      for (const invalid of [0, -1, 1.5, MAX_BATCH_SIZE + 1, Number.NaN]) {
        await expect(queue.peekBatch(invalid)).rejects.toThrow(RangeError);
      }
    });

    it('drains a backlog larger than one batch in order', async () => {
      const queue = await createQueue();
      const backlog = events(0, 1200);
      await queue.enqueue(backlog);

      const drained: PositionEvent[] = [];
      for (;;) {
        const batch = await queue.peekBatch(MAX_BATCH_SIZE);
        if (batch.length === 0) break;
        expect(batch.length).toBeLessThanOrEqual(MAX_BATCH_SIZE);
        drained.push(...batch);
        await queue.acknowledge(ids(batch));
      }
      expect(ids(drained)).toEqual(ids(backlog));
      expect(await queue.size()).toBe(0);
    });

    it('removes only acknowledged events and keeps the order of the rest', async () => {
      const queue = await createQueue();
      const all = events(0, 5);
      await queue.enqueue(all);
      const removed = await queue.acknowledge([all[1]!.event_id, all[3]!.event_id]);
      expect(removed).toBe(2);
      expect(ids(await queue.peekBatch(10))).toEqual(ids([all[0]!, all[2]!, all[4]!]));
    });

    it('ignores unknown, repeated and empty acknowledgements', async () => {
      const queue = await createQueue();
      const all = events(0, 3);
      await queue.enqueue(all);
      expect(await queue.acknowledge([makeEvent(99).event_id])).toBe(0);
      expect(await queue.acknowledge([all[0]!.event_id, all[0]!.event_id])).toBe(1);
      expect(await queue.acknowledge([all[0]!.event_id])).toBe(0);
      expect(await queue.acknowledge([])).toBe(0);
      expect(ids(await queue.peekBatch(10))).toEqual(ids(all.slice(1)));
    });

    it('does not store a duplicate event_id from a later enqueue; the first copy wins', async () => {
      const queue = await createQueue();
      const original = makeEvent(1);
      await queue.enqueue([original, makeEvent(2)]);
      expect(await queue.enqueue([makeEvent(1, { lat: 10 })])).toBe(0);
      expect(await queue.size()).toBe(2);
      expect((await queue.peekBatch(10))[0]).toEqual(original);
    });

    it('does not store a duplicate event_id within the same enqueue call', async () => {
      const queue = await createQueue();
      expect(await queue.enqueue([makeEvent(1), makeEvent(1, { lat: 10 }), makeEvent(2)])).toBe(2);
      expect(ids(await queue.peekBatch(10))).toEqual(ids([makeEvent(1), makeEvent(2)]));
    });

    it('keeps events that arrive while a batch is being uploaded', async () => {
      const queue = await createQueue();
      await queue.enqueue(events(0, 3));
      const inFlight = await queue.peekBatch(MAX_BATCH_SIZE);
      await queue.enqueue(events(3, 5)); // new fixes during the upload
      await queue.acknowledge(ids(inFlight)); // the server acknowledged the first batch
      expect(ids(await queue.peekBatch(10))).toEqual(ids(events(3, 5)));
    });

    it('accepts an event again after it was acknowledged (the server deduplicates)', async () => {
      const queue = await createQueue();
      await queue.enqueue([makeEvent(1)]);
      await queue.acknowledge([makeEvent(1).event_id]);
      expect(await queue.enqueue([makeEvent(1)])).toBe(1);
      expect(await queue.size()).toBe(1);
    });

    it('is not affected by callers changing events they passed in or got back', async () => {
      const queue = await createQueue();
      const input = makeEvent(1);
      await queue.enqueue([input]);
      input.lat = 0;
      const [peeked] = await queue.peekBatch(1);
      peeked!.lon = 0;
      expect(await queue.peekBatch(1)).toEqual([makeEvent(1)]);
    });
  });
}
