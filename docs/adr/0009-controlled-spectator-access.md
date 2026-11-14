# ADR-0009: Controlled spectator access to positions

- **Status:** Proposed
- **Date:** 2026-11-14
- **Deciders:** to be accepted by both developers in review (affects backend and web work)

## Context

The original design (architecture §6.1) let the `anon` role read `latest_positions` directly,
through row-level security, for public participants in published races. That is simple, but:

- **The anon key is public.** Anyone can query the table with it — every public runner in every
  published race, at any time, in bulk, including after the race. Nothing limits how often or
  for how long.
- **One policy mistake exposes positions.** The table holds every participant, private ones
  included, so a single wrong RLS policy or a later column addition is a direct leak.
- **Public runners' positions are still personal data (GDPR).** Exposure should be limited to
  its purpose: following a live race, not long-term access.
- **There is no identity to act on.** Anonymous requests cannot be limited or revoked per
  spectator, and private following (§6.3) needs a user anyway.

Live updates already go through private Realtime channels (ADR-0003). This ADR covers the
**snapshot** (current positions on page load and after reconnecting) and makes channel access
follow the same rules.

## Decision

1. **No client role reads position tables.** `position_events` and `latest_positions` have RLS
   enabled with **no policies for `anon` or `authenticated`**, and those roles get no table
   privileges on them. Only server code (Edge Functions, `SECURITY DEFINER` functions) reads them.
2. **Spectators use a session.** Every spectator gets a Supabase **anonymous sign-in** session
   (no user interaction), so requests come from an `authenticated` identity that policies, rate
   limits and follower grants can refer to. Spike #5 confirms the details. If it shows anonymous
   sign-in is unsuitable, this ADR is revisited before #8.
3. **One controlled read path for snapshots.** A `SECURITY DEFINER` SQL function (working name
   `get_race_snapshot(race_id)`, fixed `search_path`), executable only by `authenticated`:
   - returns rows only if the race is **published and inside its live window** (from shortly
     before the start to shortly after the end; exact margins are set in implementation);
   - returns **public participants**, plus private participants the caller is the participant
     for or follows (`participant_followers`);
   - returns an **explicit column allow-list**: participant ID, coordinates, `recorded_at`,
     accuracy and distance along the course — no names, user IDs, device or source data, and
     no history.
4. **Realtime channels follow the same rules.** `race:{race_id}:public` can be joined by
   spectator sessions only while the race is published and inside its live window.
   `participant:{id}` is unchanged (the participant and their followers). There is still no
   `INSERT` policy on `realtime.messages`, and position tables are still not in the
   `supabase_realtime` publication (ADR-0003).
5. **Names and bibs are separate from positions.** The runner list used for search exposes only
   public participants of published races, without coordinates. Search details belong to M2 (#28).
6. **Tested like the rest of the invariant.** pgTAP asserts that `anon` and `authenticated` have
   no access to position tables, and that the snapshot function never returns a private
   participant to a non-follower, nor anything outside the live window. The Realtime integration
   test (#22) is unchanged.

## Alternatives considered

- **Direct `anon` read of `latest_positions` through RLS** (the original design) — rejected for
  the reasons above.
- **An Edge Function instead of a SQL function** — allows caching and finer rate limiting, but
  adds a deployed service and makes the privacy rules harder to test in pgTAP. It can wrap the
  same SQL function later, if load tests (M5) show snapshot caching is needed (§10).
- **A separate public table holding only public positions** — copying data into a second table
  adds write paths and its own leak surface, and still allows bulk reads with the anon key.

## Consequences

- Smaller attack surface: privacy rules live in one function and the channel policies, both
  covered by pgTAP.
- Affects backend and web issues owned by the backend/web workstream: #5 (anonymous sign-in
  becomes the main path), #6 (the acceptance criterion "anon reads `latest_positions`" is
  replaced by "no client access + snapshot function"), #8 (live window in channel policies),
  #12 and #27 (load the snapshot through the function), #31.
- Anonymous sign-in creates `auth.users` rows: they need a cleanup rule (with retention, #23),
  and Supabase's sign-in rate limits and CAPTCHA option must be checked before a public event.
- Spectators need a session before anything loads — one extra round trip on first visit.
