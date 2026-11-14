import { describe, expect, it } from 'vitest';

import {
  CONTRACT_VERSION,
  MAX_BATCH_SIZE,
  parsePositionBatch,
  positionBatchSchema,
  positionEventSchema,
  type PositionEvent,
} from './position-event.ts';

// Unique, valid UUID v4s without depending on a platform `crypto` global.
let uuidCounter = 0;
const uuid = () => `00000000-0000-4000-8000-${(++uuidCounter).toString(16).padStart(12, '0')}`;

const minimal = () => ({
  contract_version: CONTRACT_VERSION,
  event_id: uuid(),
  source_type: 'mobile_app',
  recorded_at: '2026-11-09T10:15:30.250Z',
  lat: 59.3293,
  lon: 18.0686,
});

const full = () => ({
  ...minimal(),
  accuracy_m: 4.5,
  altitude_m: 28,
  speed_mps: 3.4,
  heading_deg: 271.5,
});

const isValid = (event: unknown) => positionEventSchema.safeParse(event).success;
const batchOf = (n: number) => ({ events: Array.from({ length: n }, minimal) });

describe('positionEventSchema: valid events', () => {
  it('accepts an event with only the required fields', () => {
    expect(isValid(minimal())).toBe(true);
  });

  it('accepts an event with all optional measurements and returns it unchanged', () => {
    const event = full();
    expect(positionEventSchema.parse(event)).toEqual(event);
  });

  it('accepts null for optional measurements', () => {
    expect(
      isValid({
        ...minimal(),
        accuracy_m: null,
        altitude_m: null,
        speed_mps: null,
        heading_deg: null,
      }),
    ).toBe(true);
  });

  it.each([
    ['lat', 90],
    ['lat', -90],
    ['lon', 180],
    ['lon', -180],
    ['heading_deg', 0],
    ['heading_deg', 359.99],
    ['accuracy_m', 0],
    ['speed_mps', 0],
  ])('accepts boundary value %s = %d', (field, value) => {
    expect(isValid({ ...minimal(), [field]: value })).toBe(true);
  });

  it.each(['2026-11-09T10:15:30Z', '2026-11-09T11:15:30+01:00', '2026-11-09T10:15:30.123456Z'])(
    'accepts timestamp with timezone %s',
    (recorded_at) => {
      expect(isValid({ ...minimal(), recorded_at })).toBe(true);
    },
  );

  it('accepts the simulator as a source', () => {
    expect(isValid({ ...minimal(), source_type: 'simulator' })).toBe(true);
  });
});

describe('positionEventSchema: invalid coordinates', () => {
  it.each([
    ['lat', 90.0001],
    ['lat', -90.0001],
    ['lon', 180.0001],
    ['lon', -180.0001],
    ['lat', Number.NaN],
    ['lon', Number.POSITIVE_INFINITY],
    ['lat', '59.3293'],
    ['lon', null],
  ])('rejects %s = %s', (field, value) => {
    expect(isValid({ ...minimal(), [field]: value })).toBe(false);
  });
});

describe('positionEventSchema: missing required fields', () => {
  it.each(['contract_version', 'event_id', 'source_type', 'recorded_at', 'lat', 'lon'])(
    'rejects an event without %s',
    (field) => {
      const event: Record<string, unknown> = minimal();
      delete event[field];
      expect(isValid(event)).toBe(false);
    },
  );
});

describe('positionEventSchema: invalid values', () => {
  it.each([
    ['unknown source_type', { source_type: 'garmin' }],
    ['contract_version 0', { contract_version: 0 }],
    ['contract_version 2', { contract_version: 2 }],
    ['event_id that is not a UUID', { event_id: 'event-1' }],
    ['event_id that is a UUID v1', { event_id: 'c232ab00-9414-11ec-b3c8-9f6bdeced846' }],
    ['recorded_at without timezone', { recorded_at: '2026-11-09T10:15:30' }],
    ['recorded_at that is not a real date', { recorded_at: '2026-02-30T10:15:30Z' }],
    ['recorded_at as epoch number', { recorded_at: 1793614048000 }],
    ['negative accuracy_m', { accuracy_m: -1 }],
    ['negative speed_mps', { speed_mps: -0.1 }],
    ['speed_mps above 100', { speed_mps: 100.1 }],
    ['altitude_m below -1000', { altitude_m: -1000.1 }],
    ['heading_deg of 360', { heading_deg: 360 }],
    ['heading_deg of -1 (unknown on iOS)', { heading_deg: -1 }],
  ])('rejects %s', (_label, override) => {
    expect(isValid({ ...minimal(), ...override })).toBe(false);
  });
});

describe('positionEventSchema: privacy', () => {
  it.each(['participant_id', 'device_id', 'race_id', 'user_id', 'received_at'])(
    'rejects server-derived field %s sent by a client',
    (field) => {
      expect(isValid({ ...minimal(), [field]: uuid() })).toBe(false);
    },
  );

  it('rejects any unknown field', () => {
    expect(isValid({ ...minimal(), display_name: 'Anna' })).toBe(false);
  });

  it('has no identity fields in its type', () => {
    const typeCheckOnly = (event: PositionEvent) => {
      // @ts-expect-error participant identity is derived by the server, never sent by a client
      return event.participant_id;
    };
    expect(typeCheckOnly).toBeTypeOf('function');
  });
});

describe('positionBatchSchema', () => {
  it('accepts an optional sent_at with a timezone', () => {
    expect(
      positionBatchSchema.safeParse({ ...batchOf(1), sent_at: '2026-11-14T09:00:05Z' }).success,
    ).toBe(true);
  });

  it('accepts 1 event', () => {
    expect(positionBatchSchema.safeParse(batchOf(1)).success).toBe(true);
  });

  it(`accepts exactly ${MAX_BATCH_SIZE} events`, () => {
    expect(positionBatchSchema.safeParse(batchOf(MAX_BATCH_SIZE)).success).toBe(true);
  });

  it(`rejects ${MAX_BATCH_SIZE + 1} events`, () => {
    expect(positionBatchSchema.safeParse(batchOf(MAX_BATCH_SIZE + 1)).success).toBe(false);
  });

  it.each([
    ['an empty batch', { events: [] }],
    ['events that is not an array', { events: minimal() }],
    ['a bare array', [minimal()]],
    ['null', null],
    ['an unknown top-level field', { ...batchOf(1), participant_id: uuid() }],
  ])('rejects %s', (_label, input) => {
    expect(positionBatchSchema.safeParse(input).success).toBe(false);
  });

  it('rejects the whole batch if any event is invalid', () => {
    const input = { events: [minimal(), { ...minimal(), lat: 91 }] };
    expect(positionBatchSchema.safeParse(input).success).toBe(false);
  });
});

describe('parsePositionBatch (server-side partial validation)', () => {
  it('accepts valid events and reports invalid ones by index', () => {
    const valid1 = minimal();
    const valid2 = full();
    const result = parsePositionBatch({
      events: [valid1, { ...minimal(), lat: 91 }, valid2, { ...minimal(), source_type: 'garmin' }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.valid.map((v) => v.event.event_id)).toEqual([valid1.event_id, valid2.event_id]);
    expect(result.valid.map((v) => v.index)).toEqual([0, 2]);
    expect(result.rejected.map((r) => r.index)).toEqual([1, 3]);
    expect(result.rejected[0]?.issues[0]?.path).toEqual(['lat']);
  });

  it('returns valid events exactly as validated, with their index', () => {
    const event = full();
    const result = parsePositionBatch({ events: [event] });
    expect(result).toEqual({
      ok: true,
      sentAt: null,
      sentAtInvalid: false,
      valid: [{ index: 0, event }],
      rejected: [],
    });
  });

  it('keeps both copies of a repeated event_id, each with its own index', () => {
    // Deduplication is the server's job (first index wins); validation reports what was sent.
    const event = minimal();
    const result = parsePositionBatch({ events: [event, { ...event, lat: 10 }] });
    expect(result.ok && result.valid.map((v) => v.index)).toEqual([0, 1]);
  });

  it('returns the optional sent_at, and null when it is omitted', () => {
    const sentAt = '2026-11-14T10:00:05.120+01:00';
    const withSentAt = parsePositionBatch({ sent_at: sentAt, events: [minimal()] });
    expect(withSentAt.ok && withSentAt.sentAt).toBe(sentAt);
    const without = parsePositionBatch({ events: [minimal()] });
    expect(without.ok && without.sentAt).toBe(null);
  });

  it.each([
    ['an empty batch', { events: [] }],
    [`more than ${MAX_BATCH_SIZE} events`, batchOf(MAX_BATCH_SIZE + 1)],
    ['a bare array', [minimal()]],
    ['a non-object', 'events'],
    ['an unknown top-level field', { ...batchOf(1), participant_id: uuid() }],
  ])('fails as a whole for %s', (_label, input) => {
    const result = parsePositionBatch(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('never echoes the names of unknown fields', () => {
    const result = parsePositionBatch({
      events: [{ ...minimal(), anna_andersson_home_59_3293: true }],
    });
    expect(JSON.stringify(result)).not.toContain('anna_andersson_home');
    expect(result.ok && result.rejected[0]?.issues[0]?.message).toBe(
      'unknown field(s) not allowed',
    );
  });

  it.each([
    ['without a timezone', '2026-11-14T10:00:05'],
    ['that is not a date', 'yesterday 59.3293,18.0686'],
    ['as a number', 1763110805000],
    ['as an object', { lat: 59.3293 }],
    ['as null', null],
  ])('ignores a malformed sent_at %s, without changing any event outcome', (_label, sentAt) => {
    const events = [minimal(), { ...minimal(), lat: 91 }, full()];
    const withBad = parsePositionBatch({ sent_at: sentAt, events });
    const without = parsePositionBatch({ events });
    expect(withBad.ok).toBe(true);
    if (!withBad.ok || !without.ok) return;
    expect(withBad.sentAt).toBe(null);
    expect(withBad.sentAtInvalid).toBe(true);
    expect(withBad.valid).toEqual(without.valid);
    expect(withBad.rejected).toEqual(without.rejected);
  });

  it('reports sentAtInvalid as false for a valid or omitted sent_at', () => {
    const valid = parsePositionBatch({ sent_at: '2026-11-14T09:00:05Z', events: [minimal()] });
    expect(valid.ok && valid.sentAtInvalid).toBe(false);
    const omitted = parsePositionBatch({ events: [minimal()] });
    expect(omitted.ok && omitted.sentAtInvalid).toBe(false);
  });

  it('still rejects the whole request for any other malformed envelope field', () => {
    expect(parsePositionBatch({ sent_at: 'bad', events: [] }).ok).toBe(false);
    expect(parsePositionBatch({ sent_at: 'bad', ...batchOf(1), extra: 1 }).ok).toBe(false);
  });

  it.each([
    ['a coordinate as a string', { lat: '59.3293123' }, '59.3293123'],
    ['a coordinate out of range', { lat: 91.987654321 }, '91.987654321'],
    ['a coordinate as an object', { lon: { secret: 18.0686123 } }, '18.0686123'],
    ['a malformed timestamp', { recorded_at: '2026-11-09T10:15:30 home' }, 'home'],
    ['an unknown source type', { source_type: 'garmin-of-anna' }, 'anna'],
    ['a malformed event_id', { event_id: 'id-of-anna-andersson' }, 'anna'],
  ])('builds messages without submitted values for %s', (_label, change, secret) => {
    const result = parsePositionBatch({ events: [{ ...minimal(), ...change }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issues = result.rejected[0]?.issues ?? [];
    expect(issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(issues)).not.toContain(secret);
  });

  it('builds paths only from contract fields', () => {
    const allowed = new Set<PropertyKey>([
      'contract_version',
      'event_id',
      'source_type',
      'recorded_at',
      'lat',
      'lon',
      'accuracy_m',
      'altitude_m',
      'speed_mps',
      'heading_deg',
      'sent_at',
      'events',
    ]);
    const result = parsePositionBatch({
      events: [{ ...minimal(), lat: 'x', home_of_anna: 1, '59.3293': 2 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const segments = (result.rejected[0]?.issues ?? []).flatMap((issue) => issue.path);
    expect(segments).toContain('lat');
    for (const segment of segments) {
      expect(typeof segment === 'number' || segment === '(unknown)' || allowed.has(segment)).toBe(
        true,
      );
    }
    expect(JSON.stringify(result)).not.toContain('home_of_anna');
    expect(JSON.stringify(result)).not.toContain('59.3293');
  });

  it('describes limits from the schema, not from the input', () => {
    const result = parsePositionBatch({ events: [{ ...minimal(), lat: 91.5, heading_deg: 360 }] });
    expect(result.ok && result.rejected[0]?.issues).toEqual([
      { path: ['lat'], message: 'must be at most 90' },
      { path: ['heading_deg'], message: 'must be less than 360' },
    ]);
  });

  it('never includes input values in validation issues', () => {
    const secretLat = 91.987654321;
    const secretLon = 181.123456789;
    const result = parsePositionBatch({
      events: [{ ...minimal(), lat: secretLat, lon: secretLon, display_name: 'Anna Andersson' }],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(String(secretLat));
    expect(serialized).not.toContain(String(secretLon));
    expect(serialized).not.toContain('Anna Andersson');
  });
});
