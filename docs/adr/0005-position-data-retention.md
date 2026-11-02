# ADR-0005: 30-day configurable retention of raw positions

- **Status:** Accepted (subject to the final privacy policy)
- **Date:** 2026-11-02

## Context

Location traces are personal data under GDPR. Raw traces are useful after a race (corrections,
replays, support), but keeping them indefinitely is neither necessary nor defensible.

## Decision

- Raw `position_events` are deleted **`retention_days` after race end**, default **30**,
  configurable per race (`races.retention_days`).
- Deletion runs daily via `pg_cron`.
- Aggregated or anonymized data (e.g. finish times, latest position) may be kept longer, as
  defined by the privacy policy.

## Consequences

- Retention is enforced by the database, not by manual cleanups.
- The value may change once the privacy policy and organizer agreements are finalized; changing
  it is a configuration change, not a schema change.
