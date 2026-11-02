/**
 * @track/shared — domain types and validation schemas.
 *
 * M1 adds the canonical position-event contract here (see docs/architecture.md §4).
 * Every GPS source and the ingest Edge Function validate against that single schema.
 */
export const CONTRACT_VERSION = 0;
