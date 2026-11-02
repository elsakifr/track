# ADR-0003: Private Realtime Broadcast channels, server-only publishing

- **Status:** Accepted (anonymous-spectator details validated in M1)
- **Date:** 2026-11-02

## Context

Spectators need live positions with < 10 s latency. Some participants are private. Supabase
Realtime offers `postgres_changes` and Broadcast; public channels can be joined — and broadcast
to — by anyone with the public anon key and a topic name.

## Decision

- Use **Realtime Broadcast**, published only by the server (`ingest`). Location tables are
  **not** added to the `supabase_realtime` publication (no `postgres_changes` on positions).
- All channels are **private** (Realtime Authorization). RLS policies on `realtime.messages`
  grant `SELECT` per topic; there is **no `INSERT` policy** for client roles, so clients cannot send.
- Topics: `race:{race_id}:public` (public participants only) and `participant:{participant_id}`
  (the participant and their authorized followers).
- "Allow public access" is disabled in Realtime settings on hosted projects.
- If unauthenticated (`anon`) subscribers cannot be authorized as intended, spectators use
  Supabase anonymous sign-in and policies target `authenticated`.

## Alternatives considered

- **`postgres_changes` on `latest_positions`** — per-subscriber RLS evaluation for every change
  scales poorly, and any mistake in table publication exposes data.
- **Public channels with unguessable topic names** — security by obscurity; leaked links expose
  private runners and anyone could inject fake positions.

## Consequences

- The privacy invariant is enforced by the database and covered by pgTAP + integration tests.
- `ingest` must route each event by current visibility; visibility lookups need short caching.
- Channel-per-participant increases channel count for private runners; acceptable at MVP scale,
  revisited in M5 alongside aggregated broadcasts.
