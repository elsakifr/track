import type { PositionEvent } from '@track/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeIngestServer } from './fake-ingest-server.ts';
import { InMemoryPositionQueue } from './memory-queue.ts';
import { makeEvent } from './queue-conformance.ts';
import { InMemoryRejectedEventStore } from './rejected-store.ts';
import type { RejectedPosition } from './rejected-store.ts';
import { Uploader } from './uploader.ts';
import type { UploaderOptions } from './uploader.ts';

const events = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => makeEvent(from + i));
const ids = (list: readonly PositionEvent[]) => list.map((event) => event.event_id);

/** Builds an uploader with a fresh queue, rejected store and fake server; jitter fixed at the top. */
async function setup(initial: PositionEvent[] = [], options: Partial<UploaderOptions> = {}) {
  const queue = new InMemoryPositionQueue();
  const rejectedStore = new InMemoryRejectedEventStore();
  const server = new FakeIngestServer();
  await queue.enqueue(initial);
  const uploader = new Uploader({
    queue,
    rejectedStore,
    transport: server.transport,
    random: () => 1,
    ...options,
  });
  return { queue, rejectedStore, server, uploader };
}

/** Waits for an upload that a timer started (shares the in-flight promise; never starts one). */
async function settle(uploader: Uploader) {
  if (uploader.status().state === 'uploading') await uploader.flush();
}

/** Advances fake time by `ms` and waits for any upload that started. */
async function advance(uploader: Uploader, ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await settle(uploader);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-14T09:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Uploader — batch uploading', () => {
  it('drains a backlog in batches of at most 500, oldest first', async () => {
    const backlog = events(0, 1200);
    const { queue, server, uploader } = await setup(backlog);

    const result = await uploader.flush();

    expect(result).toEqual({ outcome: 'drained', acknowledged: 1200, rejected: 0 });
    expect(server.sends.map((batch) => batch.length)).toEqual([500, 500, 200]);
    expect(server.sends.flat().map((event) => event.event_id)).toEqual(ids(backlog));
    expect(server.stored.size).toBe(1200);
    expect(await queue.size()).toBe(0);
  });

  it('uses a smaller batch size when configured, and rejects invalid ones', async () => {
    const { server, uploader } = await setup(events(0, 5), { batchSize: 2 });
    await uploader.flush();
    expect(server.sends.map((batch) => batch.length)).toEqual([2, 2, 1]);

    await expect(setup([], { batchSize: 0 })).rejects.toThrow(RangeError);
    await expect(setup([], { batchSize: 501 })).rejects.toThrow(RangeError);
  });

  it('does not send anything when the queue is empty', async () => {
    const { server, uploader } = await setup();
    expect(await uploader.flush()).toEqual({ outcome: 'drained', acknowledged: 0, rejected: 0 });
    expect(server.sends).toHaveLength(0);
  });
});

describe('Uploader — offline recovery and backoff', () => {
  it('keeps every event while offline and retries after the backoff delay', async () => {
    const { queue, server, uploader } = await setup(events(0, 3));
    server.offline = true;

    expect((await uploader.flush()).outcome).toBe('retry_scheduled');
    expect(await queue.size()).toBe(3);
    expect(uploader.status()).toMatchObject({
      state: 'waiting_to_retry',
      consecutiveFailures: 1,
      nextRetryAt: '2026-11-14T09:00:01.000Z',
      lastError: 'offline',
    });

    server.offline = false;
    await advance(uploader, 999);
    expect(server.sends).toHaveLength(1); // not yet
    await advance(uploader, 1);
    expect(server.sends).toHaveLength(2);
    expect(await queue.size()).toBe(0);
    expect(uploader.status()).toMatchObject({ state: 'idle', consecutiveFailures: 0 });
  });

  it('backs off exponentially up to 60 s and resets after a success', async () => {
    const { server, uploader } = await setup(events(0, 1));
    server.offline = true;
    await uploader.flush();

    const waits: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const before = server.sends.length;
      const nextRetryAt = Date.parse(uploader.status().nextRetryAt!);
      waits.push(nextRetryAt - Date.now());
      await advance(uploader, nextRetryAt - Date.now());
      expect(server.sends).toHaveLength(before + 1); // exactly one attempt per wait
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);

    server.offline = false;
    await advance(uploader, 60_000);
    expect(uploader.status().consecutiveFailures).toBe(0);
  });

  it('starts again from the initial delay after a success', async () => {
    const { queue, server, uploader } = await setup(events(0, 1));
    server.offline = true;
    await uploader.flush();
    await advance(uploader, 1_000); // second failure → next wait 2 s
    server.offline = false;
    await advance(uploader, 2_000); // success
    expect(await queue.size()).toBe(0);

    server.offline = true;
    await queue.enqueue([makeEvent(1)]);
    await uploader.flush();
    expect(Date.parse(uploader.status().nextRetryAt!) - Date.now()).toBe(1_000);
  });

  it('respects Retry-After when it is longer than the backoff', async () => {
    const { server, uploader } = await setup(events(0, 2));
    server.script({ kind: 'retryable', reason: 'rate limited', retryAfterMs: 30_000 });

    await uploader.flush();
    await advance(uploader, 29_999);
    expect(server.sends).toHaveLength(1);
    await advance(uploader, 1);
    expect(server.sends).toHaveLength(2);
    expect(server.stored.size).toBe(2);
  });

  it('uploads at once when connectivity is restored, but keeps backing off if it still fails', async () => {
    const { queue, server, uploader } = await setup(events(0, 2));
    server.offline = true;
    await uploader.flush(); // failure 1, retry in 1 s

    // The OS reports connectivity, but the server is still unreachable: no tight loop.
    expect((await uploader.connectivityRestored()).outcome).toBe('retry_scheduled');
    expect(Date.parse(uploader.status().nextRetryAt!) - Date.now()).toBe(2_000);

    server.offline = false;
    expect((await uploader.connectivityRestored()).outcome).toBe('drained');
    expect(server.sends).toHaveLength(3);
    expect(await queue.size()).toBe(0);
  });

  it('does not send when flush() is called while a retry is scheduled', async () => {
    const { server, uploader } = await setup(events(0, 1));
    server.offline = true;
    await uploader.flush();

    for (let i = 0; i < 20; i += 1) {
      expect((await uploader.flush()).outcome).toBe('retry_scheduled');
    }
    expect(server.sends).toHaveLength(1);
  });

  it('treats an exception from the transport as a temporary failure', async () => {
    const { queue, server, uploader } = await setup(events(0, 2));
    server.script({ kind: 'throw', error: new Error('socket hang up') });

    expect((await uploader.flush()).outcome).toBe('retry_scheduled');
    expect(uploader.status().lastError).toBe('Transport error: socket hang up');
    expect(await queue.size()).toBe(2);
    await advance(uploader, 1_000);
    expect(await queue.size()).toBe(0);
  });
});

describe('Uploader — acknowledgements and duplicates', () => {
  it('removes only acknowledged events; unmentioned events are sent again', async () => {
    const all = events(0, 4);
    const { queue, server, uploader } = await setup(all);
    server.script({ kind: 'partial', count: 2 }); // stores all 4, acknowledges only 2

    const result = await uploader.flush();

    expect(result).toEqual({ outcome: 'drained', acknowledged: 4, rejected: 0 });
    expect(server.sends.map(ids)).toEqual([ids(all), ids(all.slice(2))]);
    expect(server.stored.size).toBe(4); // the resend was deduplicated
    expect(await queue.size()).toBe(0);
  });

  it('recovers from a lost response through duplicates, without storing anything twice', async () => {
    const all = events(0, 3);
    const { queue, server, uploader } = await setup(all);
    server.script({ kind: 'lose_response' });

    await uploader.flush();
    expect(await queue.size()).toBe(3); // the client does not know they were stored
    await advance(uploader, 1_000);

    expect(server.sends).toHaveLength(2);
    expect(server.stored.size).toBe(3);
    expect(await queue.size()).toBe(0);
  });

  it('ignores acknowledged IDs that were not in the batch', async () => {
    const { queue, server, uploader } = await setup(events(0, 2), { batchSize: 1 });
    server.script({
      kind: 'response',
      accepted: [makeEvent(0).event_id, makeEvent(1).event_id], // event 1 was not sent
      duplicates: [],
      rejected: [],
    });

    await uploader.flush();
    expect(server.sends.map(ids)).toEqual([ids([makeEvent(0)]), ids([makeEvent(1)])]);
    expect(await queue.size()).toBe(0);
  });

  it('retries with backoff when a response acknowledges nothing (no tight loop)', async () => {
    const { queue, server, uploader } = await setup(events(0, 2));
    server.script({ kind: 'response', accepted: [], duplicates: [], rejected: [] });

    expect((await uploader.flush()).outcome).toBe('retry_scheduled');
    expect(server.sends).toHaveLength(1);
    expect(await queue.size()).toBe(2);
    await advance(uploader, 1_000);
    expect(await queue.size()).toBe(0);
  });
});

describe('Uploader — malformed transport results', () => {
  const malformed: [string, unknown][] = [
    ['null', null],
    ['an unknown kind', { kind: 'ok' }],
    [
      'accepted is not an array',
      { kind: 'response', accepted: 'all', duplicates: [], rejected: [] },
    ],
    [
      'accepted holds non-strings',
      { kind: 'response', accepted: [1], duplicates: [], rejected: [] },
    ],
    [
      'rejected index out of range',
      { kind: 'response', accepted: [], duplicates: [], rejected: [{ index: 9, reason: 'x' }] },
    ],
    [
      'rejected index not an integer',
      { kind: 'response', accepted: [], duplicates: [], rejected: [{ index: 0.5, reason: 'x' }] },
    ],
    [
      'rejected without a reason',
      { kind: 'response', accepted: [], duplicates: [], rejected: [{ index: 0 }] },
    ],
    ['retryable without a reason', { kind: 'retryable' }],
  ];

  it.each(malformed)(
    'removes nothing and stops when the result is malformed (%s)',
    async (_, value) => {
      const { queue, rejectedStore, server, uploader } = await setup(events(0, 2));
      server.script({ kind: 'raw', value });

      expect((await uploader.flush()).outcome).toBe('fatal');
      expect(await queue.size()).toBe(2);
      expect(await rejectedStore.size()).toBe(0);
      expect(uploader.status().lastError).toMatch(/^Malformed transport outcome/);

      await advance(uploader, 10 * 60_000);
      expect(server.sends).toHaveLength(1); // no retries until resume()
    },
  );

  it('ignores an invalid Retry-After and uses the normal backoff', async () => {
    const { server, uploader } = await setup(events(0, 1));
    server.script({ kind: 'raw', value: { kind: 'retryable', reason: 'busy', retryAfterMs: -5 } });

    await uploader.flush();
    expect(Date.parse(uploader.status().nextRetryAt!) - Date.now()).toBe(1_000);
  });
});

describe('Uploader — rejected events', () => {
  it('saves rejected events with their reason before removing them, without blocking the rest', async () => {
    const valid = events(0, 3);
    const invalid = makeEvent(3, { lat: 200 }); // fails the contract on the server
    const { queue, rejectedStore, server, uploader } = await setup([
      valid[0]!,
      invalid,
      ...valid.slice(1),
    ]);

    const result = await uploader.flush();

    expect(result).toEqual({ outcome: 'drained', acknowledged: 3, rejected: 1 });
    expect(await queue.size()).toBe(0);
    expect(server.stored.has(invalid.event_id)).toBe(false);
    const saved = await rejectedStore.list();
    expect(saved).toEqual<RejectedPosition[]>([
      {
        event: invalid,
        reason: expect.stringMatching(/^lat: /) as unknown as string,
        rejected_at: '2026-11-14T09:00:00.000Z',
      },
    ]);
  });

  it('keeps a rejected event in the queue if saving it fails, and retries later', async () => {
    const all = events(0, 3);
    const failingStore = new InMemoryRejectedEventStore();
    let storeWorks = false;
    const realAdd = failingStore.add.bind(failingStore);
    failingStore.add = async (entries) => {
      if (!storeWorks) throw new Error('disk full');
      return realAdd(entries);
    };
    const { queue, server, uploader } = await setup(all, { rejectedStore: failingStore });
    server.rejectIds.add(all[1]!.event_id);

    const first = await uploader.flush();
    expect(first).toEqual({ outcome: 'retry_scheduled', acknowledged: 2, rejected: 0 });
    expect(ids(await queue.peekBatch(10))).toEqual(ids([all[1]!])); // still queued
    expect(uploader.status().lastError).toBe(
      'Could not save rejected events (they stay queued): disk full',
    );

    storeWorks = true;
    await advance(uploader, 1_000);
    expect(await queue.size()).toBe(0);
    expect(await failingStore.size()).toBe(1);
  });

  it('does not treat an event as rejected when the server also acknowledged it', async () => {
    const { queue, rejectedStore, server, uploader } = await setup(events(0, 1));
    server.script({
      kind: 'response',
      accepted: [makeEvent(0).event_id],
      duplicates: [],
      rejected: [{ index: 0, reason: 'contradictory' }],
    });

    await uploader.flush();
    expect(await queue.size()).toBe(0);
    expect(await rejectedStore.size()).toBe(0);
  });

  it('keeps stored entries unchanged when callers modify what they passed in or got back', async () => {
    const store = new InMemoryRejectedEventStore();
    const entry: RejectedPosition = { event: makeEvent(1), reason: 'r', rejected_at: 't' };
    await store.add([entry]);
    entry.event.lat = 0;
    const [listed] = await store.list();
    listed!.event.lon = 0;
    expect(await store.list()).toEqual([{ event: makeEvent(1), reason: 'r', rejected_at: 't' }]);
  });
});

describe('Uploader — unauthorized and fatal', () => {
  it.each(['unauthorized', 'fatal'] as const)(
    'stops on %s without removing events or retrying, until resume()',
    async (kind) => {
      const { queue, server, uploader } = await setup(events(0, 2));
      server.script({ kind, reason: `${kind} by test` });

      expect((await uploader.flush()).outcome).toBe(kind);
      expect(uploader.status()).toMatchObject({
        state: `paused_${kind}`,
        lastError: `${kind} by test`,
      });
      expect(await queue.size()).toBe(2);

      await advance(uploader, 10 * 60_000);
      expect((await uploader.flush()).outcome).toBe(kind);
      expect((await uploader.connectivityRestored()).outcome).toBe(kind);
      expect(server.sends).toHaveLength(1);

      expect((await uploader.resume()).outcome).toBe('drained');
      expect(await queue.size()).toBe(0);
    },
  );
});

describe('Uploader — single-flight', () => {
  it('shares one upload between concurrent flush() calls', async () => {
    const { server, uploader } = await setup(events(0, 3));
    const held = server.hold();

    const first = uploader.flush();
    const second = uploader.flush();
    expect(second).toBe(first);
    await held.arrived;
    expect(uploader.status().state).toBe('uploading');
    held.release();

    await first;
    expect(server.sends).toHaveLength(1);
    expect(server.maxConcurrentSends).toBe(1);
  });

  it('sends events that were queued during an upload in the same flush, afterwards', async () => {
    const { queue, server, uploader } = await setup(events(0, 3));
    const held = server.hold();

    const flushing = uploader.flush();
    await held.arrived;
    await queue.enqueue(events(3, 5)); // new fixes while the first batch is in flight
    held.release();

    expect(await flushing).toEqual({ outcome: 'drained', acknowledged: 5, rejected: 0 });
    expect(server.sends.map(ids)).toEqual([ids(events(0, 3)), ids(events(3, 5))]);
    expect(server.maxConcurrentSends).toBe(1);
  });
});

describe('Uploader — stop() and resume()', () => {
  it('applies the in-flight result, then sends nothing more', async () => {
    const { queue, server, uploader } = await setup(events(0, 5), { batchSize: 2 });
    const held = server.hold();

    const flushing = uploader.flush();
    await held.arrived;
    const stopping = uploader.stop();
    held.release();
    await stopping;

    expect((await flushing).outcome).toBe('stopped');
    expect(server.stored.size).toBe(2);
    expect(ids(await queue.peekBatch(10))).toEqual(ids(events(2, 5))); // consistent with the server
    expect(server.sends).toHaveLength(1);

    expect((await uploader.flush()).outcome).toBe('stopped');
    expect((await uploader.connectivityRestored()).outcome).toBe('stopped');
    expect(server.sends).toHaveLength(1);

    expect((await uploader.resume()).outcome).toBe('drained');
    expect(server.stored.size).toBe(5);
    expect(await queue.size()).toBe(0);
  });

  it('keeps everything and schedules no retry when the in-flight send fails after stop()', async () => {
    const { queue, server, uploader } = await setup(events(0, 2));
    server.offline = true;
    const held = server.hold();

    const flushing = uploader.flush();
    await held.arrived;
    const stopping = uploader.stop();
    held.release();
    await stopping;

    expect((await flushing).outcome).toBe('stopped');
    expect(await queue.size()).toBe(2);
    expect(uploader.status()).toMatchObject({ state: 'stopped', nextRetryAt: null });
    await advance(uploader, 10 * 60_000);
    expect(server.sends).toHaveLength(1);
  });

  it('cancels a scheduled retry', async () => {
    const { queue, server, uploader } = await setup(events(0, 1));
    server.offline = true;
    await uploader.flush();

    await uploader.stop();
    server.offline = false;
    await advance(uploader, 10 * 60_000);

    expect(server.sends).toHaveLength(1);
    expect(await queue.size()).toBe(1);
  });

  it('resolves stop() immediately when nothing is in flight', async () => {
    const { uploader } = await setup();
    await expect(uploader.stop()).resolves.toBeUndefined();
    expect(uploader.status().state).toBe('stopped');
  });
});
