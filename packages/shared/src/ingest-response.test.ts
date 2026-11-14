import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  describeValidationIssues,
  INGEST_ERROR_CODES,
  INGEST_ERROR_HTTP_STATUS,
  ingestErrorSchema,
  ingestResponseSchema,
  MAX_REASON_LENGTH,
  MAX_REQUEST_BYTES,
  parseIngestResponse,
  REJECTION_CODES,
  REJECTION_REASONS,
  type EventResult,
} from './ingest-response.ts';
import { MAX_BATCH_SIZE, parsePositionBatch } from './position-event.ts';

const serverTime = '2026-11-14T09:00:05.400Z';
const accepted = (index: number) => ({ index, status: 'accepted' });
const duplicate = (index: number) => ({ index, status: 'duplicate' });
const rejected = (index: number, code: string = 'invalid', reason = 'lat: Too big') => ({
  index,
  status: 'rejected',
  code,
  reason,
});
const response = (...results: unknown[]) => ({ server_time: serverTime, results });

const isValid = (input: unknown, batchLength: number) => parseIngestResponse(input, batchLength).ok;

describe('ingest response: valid results', () => {
  it('accepts a batch where every event was accepted', () => {
    expect(isValid(response(accepted(0), accepted(1), accepted(2)), 3)).toBe(true);
  });

  it('accepts a batch of duplicates (e.g. a retry after a lost response)', () => {
    expect(isValid(response(duplicate(0), duplicate(1)), 2)).toBe(true);
  });

  it.each(REJECTION_CODES)('accepts a rejection with code %s', (code) => {
    expect(isValid(response(rejected(0, code)), 1)).toBe(true);
  });

  it('accepts partial batch success: accepted, duplicate and rejected mixed', () => {
    const input = response(
      accepted(0),
      duplicate(1),
      rejected(2, 'conflict', 'event_id already stored with different data'),
      rejected(3, 'future', 'recorded_at is in the future'),
      accepted(4),
      rejected(5, 'outside_window', 'recorded_at is outside the tracking window'),
    );
    const parsed = parseIngestResponse(input, 6);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.response.results.map((r) => r.status)).toEqual([
      'accepted',
      'duplicate',
      'rejected',
      'rejected',
      'accepted',
      'rejected',
    ]);
  });

  it('gives two events with the same event_id separate, unambiguous results', () => {
    // Batch: [E, E with different coordinates]. Results are per index, never per event_id.
    const input = response(
      accepted(0),
      rejected(1, 'duplicate_in_batch', 'an earlier event in this batch has the same event_id'),
    );
    expect(isValid(input, 2)).toBe(true);
  });

  it(`accepts the maximum of ${MAX_BATCH_SIZE} results`, () => {
    const results = Array.from({ length: MAX_BATCH_SIZE }, (_, i) => accepted(i));
    expect(isValid(response(...results), MAX_BATCH_SIZE)).toBe(true);
  });

  it('accepts server_time with a timezone offset', () => {
    expect(isValid({ server_time: '2026-11-14T10:00:05+01:00', results: [accepted(0)] }, 1)).toBe(
      true,
    );
  });
});

describe('ingest response: every submitted index exactly once', () => {
  it.each([
    ['a missing index', [accepted(0), accepted(2)], 3],
    ['a repeated index', [accepted(0), duplicate(0)], 2],
    ['indexes out of order', [accepted(1), accepted(0)], 2],
    ['an index starting at 1', [accepted(1)], 1],
    ['fewer results than submitted events', [accepted(0), accepted(1)], 3],
    ['more results than submitted events', [accepted(0), accepted(1), accepted(2)], 2],
  ] as const)('rejects %s', (_label, results, batchLength) => {
    expect(isValid(response(...results), batchLength)).toBe(false);
  });

  it('rejects an empty result list', () => {
    expect(isValid(response(), 0)).toBe(false);
    expect(isValid(response(), 1)).toBe(false);
  });

  it(`rejects more than ${MAX_BATCH_SIZE} results`, () => {
    const results = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => accepted(i));
    expect(isValid(response(...results), MAX_BATCH_SIZE + 1)).toBe(false);
  });
});

describe('ingest response: malformed', () => {
  it.each([
    ['null', null],
    ['a string', 'ok'],
    ['an array', [accepted(0)]],
    ['missing server_time', { results: [accepted(0)] }],
    [
      'server_time without a timezone',
      { server_time: '2026-11-14T09:00:05', results: [accepted(0)] },
    ],
    ['server_time as a number', { server_time: 1763110805400, results: [accepted(0)] }],
    ['missing results', { server_time: serverTime }],
    ['results as an object', { server_time: serverTime, results: { 0: accepted(0) } }],
    ['an unknown status', response({ index: 0, status: 'ok' })],
    ['a missing status', response({ index: 0 })],
    ['a rejection without a code', response({ index: 0, status: 'rejected', reason: 'x' })],
    ['a rejection without a reason', response({ index: 0, status: 'rejected', code: 'invalid' })],
    ['a rejection with an empty reason', response(rejected(0, 'invalid', ''))],
    ['a rejection with an unknown code', response(rejected(0, 'clock_suspect'))],
    ['an accepted result with a code', response({ index: 0, status: 'accepted', code: 'invalid' })],
    ['a negative index', response({ index: -1, status: 'accepted' })],
    ['a fractional index', response({ index: 0.5, status: 'accepted' })],
    ['an index as a string', response({ index: '0', status: 'accepted' })],
    ['an unknown top-level field', { ...response(accepted(0)), accepted: ['id'] }],
  ])('rejects %s', (_label, input) => {
    expect(isValid(input, 1)).toBe(false);
  });
});

describe('ingest response: privacy', () => {
  it('rejects results that carry coordinates or other event data', () => {
    expect(isValid(response({ ...accepted(0), lat: 59.3293, lon: 18.0686 }), 1)).toBe(false);
    expect(isValid(response({ ...accepted(0), event_id: 'e' }), 1)).toBe(false);
    expect(isValid(response({ ...rejected(0), recorded_at: serverTime }), 1)).toBe(false);
  });

  it('rejects a response that echoes the submitted events', () => {
    expect(isValid({ ...response(accepted(0)), events: [{ lat: 59.3293 }] }, 1)).toBe(false);
  });

  it('never includes input values in validation issues', () => {
    const secretLat = 59.987654321;
    const parsed = parseIngestResponse(response({ ...accepted(0), lat: secretLat }), 1);
    expect(JSON.stringify(parsed)).not.toContain(String(secretLat));
  });

  it('has no coordinate or identity fields in its result type', () => {
    expectTypeOf<EventResult>().not.toHaveProperty('lat');
    expectTypeOf<EventResult>().not.toHaveProperty('lon');
    expectTypeOf<EventResult>().not.toHaveProperty('event_id');
  });
});

describe('ingest error', () => {
  it.each(INGEST_ERROR_CODES)('accepts error code %s', (code) => {
    expect(ingestErrorSchema.safeParse({ error: { code, message: 'x' } }).success).toBe(true);
  });

  it.each([
    ['an unknown code', { error: { code: 'teapot', message: 'x' } }],
    ['a missing message', { error: { code: 'internal' } }],
    ['an empty message', { error: { code: 'internal', message: '' } }],
    ['an extra field', { error: { code: 'internal', message: 'x', detail: { lat: 59.3 } } }],
    ['a flat shape', { code: 'internal', message: 'x' }],
  ])('rejects %s', (_label, input) => {
    expect(ingestErrorSchema.safeParse(input).success).toBe(false);
  });

  it('maps every error code to one HTTP status', () => {
    expect(Object.keys(INGEST_ERROR_HTTP_STATUS).sort()).toEqual([...INGEST_ERROR_CODES].sort());
    expect(INGEST_ERROR_HTTP_STATUS).toMatchObject({
      invalid_request: 400,
      unauthorized: 401,
      forbidden: 403,
      payload_too_large: 413,
      rate_limited: 429,
      internal: 500,
    });
  });
});

describe('limits', () => {
  it('allows a full batch well within the request size limit', () => {
    const event = {
      contract_version: 1,
      event_id: '00000000-0000-4000-8000-000000000001',
      source_type: 'mobile_app',
      recorded_at: '2026-11-14T10:15:30.250+01:00',
      lat: -33.123456789012,
      lon: -151.123456789012,
      accuracy_m: 12.345678901,
      altitude_m: 1234.567890123,
      speed_mps: 12.345678901,
      heading_deg: 359.123456789,
    };
    const body = JSON.stringify({
      sent_at: '2026-11-14T10:20:00.000+01:00',
      events: Array.from({ length: MAX_BATCH_SIZE }, () => event),
    });
    // The body is plain ASCII, so its length in characters equals its size in bytes.
    expect(/^[\x20-\x7e]*$/.test(body)).toBe(true);
    expect(body.length).toBeLessThan(MAX_REQUEST_BYTES);
  });

  it('keeps the schema itself usable without the batch-length check', () => {
    expect(ingestResponseSchema.safeParse(response(accepted(0))).success).toBe(true);
  });
});

describe('rejection reasons (value-free)', () => {
  it('defines a fixed reason for every rejection code except invalid', () => {
    expect(Object.keys(REJECTION_REASONS).sort()).toEqual(
      REJECTION_CODES.filter((code) => code !== 'invalid').sort(),
    );
    for (const [code, text] of Object.entries(REJECTION_REASONS)) {
      expect(isValid(response(rejected(0, code, text)), 1)).toBe(true);
    }
  });

  it('describes invalid events by field and message, never by value', () => {
    const secretLat = 91.987654321;
    const secretTime = '2026-13-45T99:99:99Z';
    const parsed = parsePositionBatch({
      events: [
        {
          contract_version: 1,
          event_id: '00000000-0000-4000-8000-000000000001',
          source_type: 'mobile_app',
          recorded_at: secretTime,
          lat: secretLat,
          lon: 18.0686,
          display_name: 'Anna Andersson',
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const text = describeValidationIssues(parsed.rejected[0]!.issues);
    expect(text).toMatch(/^recorded_at: /);
    expect(text).toContain('lat: ');
    expect(text).not.toContain(String(secretLat));
    expect(text).not.toContain(secretTime);
    expect(text).not.toContain('Anna Andersson');
  });

  it('keeps described reasons within the allowed length', () => {
    const issues = Array.from({ length: 50 }, (_, i) => ({
      path: [`field_${i}`],
      message: 'Invalid input: expected number, received string',
    }));
    const text = describeValidationIssues(issues);
    expect(text.length).toBeLessThanOrEqual(MAX_REASON_LENGTH);
    expect(isValid(response(rejected(0, 'invalid', text)), 1)).toBe(true);
  });

  it('never returns an empty reason', () => {
    expect(describeValidationIssues([]).length).toBeGreaterThan(0);
    expect(describeValidationIssues([{ path: [], message: 'Invalid input' }])).toBe(
      'event: Invalid input',
    );
  });
});

describe('a batch where every event is invalid', () => {
  it('produces a valid response with every index rejected and no submitted values', () => {
    const secretLat = 123.456789;
    const batch = {
      events: [
        { lat: secretLat },
        'not an object',
        {
          contract_version: 1,
          event_id: 'not-a-uuid',
          source_type: 'mobile_app',
          recorded_at: '2026-11-14T09:00:00Z',
          lat: 59.3293,
          lon: 18.0686,
        },
      ],
    };
    const parsed = parsePositionBatch(batch);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.valid).toEqual([]);

    // What a server builds for this batch: one rejected result per index, in order.
    const body = {
      server_time: serverTime,
      results: parsed.rejected.map(({ index, issues }) => ({
        index,
        status: 'rejected',
        code: 'invalid',
        reason: describeValidationIssues(issues),
      })),
    };

    const result = parseIngestResponse(body, batch.events.length);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.results.map((r) => [r.index, r.status])).toEqual([
      [0, 'rejected'],
      [1, 'rejected'],
      [2, 'rejected'],
    ]);
    expect(JSON.stringify(body)).not.toContain(String(secretLat));
    expect(JSON.stringify(body)).not.toContain('not-a-uuid');
  });
});
