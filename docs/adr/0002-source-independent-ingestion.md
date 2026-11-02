# ADR-0002: Source-independent ingestion through one contract

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

The MVP's only GPS source is the phone app, but the product must later accept Garmin watches,
other wearables, dedicated trackers and official timing systems — without rewriting storage,
delivery or the spectator app.

## Decision

- All position data enters through a **single ingestion boundary** (Supabase Edge Function
  `ingest`) using a **canonical, versioned position-event contract** defined once in
  `packages/shared` (Zod).
- Clients never write position tables directly.
- Events carry a client-generated `event_id` (idempotency), `source_type`, `recorded_at` and a
  `contract_version`; the server assigns `received_at` and derives the participant from the
  authenticated caller.
- New sources are added as **adapters** (e.g. `ingest-garmin`) that map vendor payloads to the
  contract and reuse the shared pipeline code in `supabase/functions/_shared/`.

## Alternatives considered

- **Direct inserts from the app with RLS** — simplest today, but ties storage to one client,
  makes dedupe/validation/fan-out client concerns and blocks later scaling changes.
- **Per-source pipelines** — duplicates validation, storage and privacy logic per vendor.

## Consequences

- One place to enforce validation, dedupe and the privacy rules for publishing.
- The ingestion internals (queue, separate service) can be replaced later behind the same HTTP contract.
- Requires `packages/shared` to be importable from Deno (validated in M1).
