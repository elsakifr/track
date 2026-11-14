/**
 * Ingest response contract — what `/ingest` answers to a position batch (architecture §4.5).
 *
 * Every submitted event gets exactly one result, identified by its index in the submitted
 * batch, so even two events with the same `event_id` have unambiguous outcomes. Responses never
 * contain event data: only indexes, statuses, codes and value-free reasons (REJECTION_REASONS,
 * describeValidationIssues).
 *
 * Sources use the results to manage their queue: `accepted` and `duplicate` are acknowledged
 * (the server has the event), `rejected` is permanent (never resend; keep it locally instead).
 */
import { z } from 'zod';

import { MAX_BATCH_SIZE } from './position-event.ts';
import type { ValidationIssue } from './position-event.ts';

/** Largest request body a source may send, in bytes (500 events need about 150 KB). */
export const MAX_REQUEST_BYTES = 256 * 1024;

/** Why an event was rejected. Every rejection is permanent: the source must not resend it. */
export const REJECTION_CODES = [
  /** Does not match the position-event contract. */
  'invalid',
  /** `source_type` does not match the authenticated device. */
  'source_mismatch',
  /** An earlier event in the same batch has the same `event_id` (the first one is used). */
  'duplicate_in_batch',
  /** The `event_id` is already stored with different data; the stored event is kept. */
  'conflict',
  /** `recorded_at` is more than 5 minutes ahead of the server clock. */
  'future',
  /** `recorded_at` is outside the race's tracking window. */
  'outside_window',
  /** The race's upload deadline has passed. */
  'upload_closed',
] as const;

/** Why a whole request failed. Each code has one HTTP status (`INGEST_ERROR_HTTP_STATUS`). */
export const INGEST_ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'forbidden',
  'method_not_allowed',
  'payload_too_large',
  'unsupported_media_type',
  'rate_limited',
  'internal',
] as const;

export type RejectionCode = (typeof REJECTION_CODES)[number];
export type IngestErrorCode = (typeof INGEST_ERROR_CODES)[number];

export const INGEST_ERROR_HTTP_STATUS: Record<IngestErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  method_not_allowed: 405,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  internal: 500,
};

/** Longest allowed rejection reason or error message. */
export const MAX_REASON_LENGTH = 500;

/**
 * The reason text a server sends with each rejection code. Servers MUST use exactly these texts
 * for every code except `invalid`, whose reason MUST be built with `describeValidationIssues()`.
 * Both are value-free: a reason never contains submitted coordinates, timestamps, measurements,
 * IDs or any other event value. Clients must act on `code` only; `reason` is for people (logs,
 * support) and its wording may change without a contract version change.
 */
export const REJECTION_REASONS: Record<Exclude<RejectionCode, 'invalid'>, string> = {
  source_mismatch: 'source_type does not match the authenticated device',
  duplicate_in_batch: 'an earlier event in this batch has the same event_id',
  conflict: 'event_id is already stored with different data',
  future: 'recorded_at is too far ahead of the server clock',
  outside_window: "recorded_at is outside the race's tracking window",
  upload_closed: "the race's upload deadline has passed",
};

/**
 * The reason for an `invalid` rejection: the failing fields and messages reported by
 * `parsePositionBatch`, which never contain input values (e.g. "lat: Too big: expected number
 * to be <=90"). Truncated to MAX_REASON_LENGTH.
 */
export function describeValidationIssues(issues: readonly ValidationIssue[]): string {
  const text = issues
    .map(({ path, message }) => {
      const field = path.length > 0 ? path.map(String).join('.') : 'event';
      return `${field}: ${message}`;
    })
    .join('; ');
  const described = text.length > 0 ? text : 'event does not match the position-event contract';
  return described.length <= MAX_REASON_LENGTH
    ? described
    : `${described.slice(0, MAX_REASON_LENGTH - 1)}…`;
}

const index = z
  .int()
  .min(0)
  .max(MAX_BATCH_SIZE - 1);
/** Value-free text for people: REJECTION_REASONS, or describeValidationIssues() for `invalid`. */
const reason = z.string().min(1).max(MAX_REASON_LENGTH);

export const eventResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ index, status: z.literal('accepted') }),
  z.strictObject({ index, status: z.literal('duplicate') }),
  z.strictObject({
    index,
    status: z.literal('rejected'),
    code: z.enum(REJECTION_CODES),
    reason,
  }),
]);

/**
 * A 200 response. `results[i]` is the result for submitted event `i`: results are in batch
 * order and cover every index exactly once. Strict objects reject any other field, so a
 * response cannot carry coordinates or other event data.
 */
export const ingestResponseSchema = z
  .strictObject({
    /** The server clock when responding; lets a source notice that its own clock is wrong. */
    server_time: z.iso.datetime({ offset: true }),
    results: z.array(eventResultSchema).min(1).max(MAX_BATCH_SIZE),
  })
  .superRefine(({ results }, ctx) => {
    results.forEach((result, position) => {
      if (result.index !== position) {
        ctx.addIssue({
          code: 'custom',
          path: ['results', position, 'index'],
          message: `Expected index ${position}: results must cover every index once, in order.`,
        });
      }
    });
  });

/** The body of every non-200 response. */
export const ingestErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(INGEST_ERROR_CODES),
    /** Value-free, like rejection reasons: never echoes request content. */
    message: z.string().min(1).max(MAX_REASON_LENGTH),
  }),
});

export type EventResult = z.infer<typeof eventResultSchema>;
/** Derived from the schema, so the statuses are defined in exactly one place. */
export type ResultStatus = EventResult['status'];
export type IngestResponse = z.infer<typeof ingestResponseSchema>;
export type IngestError = z.infer<typeof ingestErrorSchema>;

export type ParsedIngestResponse =
  | { ok: true; response: IngestResponse }
  | { ok: false; issues: { path: PropertyKey[]; message: string }[] };

/**
 * Validates a 200 response against the batch it answers: the shape must match the contract and
 * there must be exactly one result for each of the `batchLength` submitted events. A source must
 * treat anything that fails this check as a failed request and keep all events queued.
 */
export function parseIngestResponse(input: unknown, batchLength: number): ParsedIngestResponse {
  const parsed = ingestResponseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map(({ path, message }) => ({ path, message })),
    };
  }
  if (parsed.data.results.length !== batchLength) {
    return {
      ok: false,
      issues: [
        {
          path: ['results'],
          message: `Expected ${batchLength} results (one per submitted event), got ${parsed.data.results.length}.`,
        },
      ],
    };
  }
  return { ok: true, response: parsed.data };
}
