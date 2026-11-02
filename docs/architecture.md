# Track — Architecture

> Status: **approved for the MVP** (M0). Sections marked _Validate in M1_ describe the design we
> intend to build, but depend on platform behavior we must confirm with a working prototype.
> Decisions and their rationale are recorded as ADRs in [`docs/adr/`](adr/).

## 1. Goals and constraints

Track is a B2B real-time GPS tracking platform that race organizers offer to participants and
spectators. The MVP targets running events (marathon, half-marathon).

| Requirement                    | Target                                                |
| ------------------------------ | ----------------------------------------------------- |
| Position update interval       | ~5 s per runner                                       |
| End-to-end latency (fix → map) | < 10 s                                                |
| Tracking with the phone locked | Required (iOS and Android)                            |
| Network loss                   | No data loss: buffer on device, backfill on reconnect |
| MVP scale                      | 10–100 runners per race                               |
| Long-term scale                | 50,000 runners per race, without client changes       |
| Cost during development        | Free tiers only                                       |
| Privacy                        | GDPR; private runners never exposed on public paths   |

**Design principles**

1. **Source-independent ingestion.** Every GPS source — phone, simulator, and later Garmin,
   dedicated trackers, timing mats — enters through one contract and one pipeline.
2. **Simple first, scalable by design.** Use managed Supabase features now. Keep the seams
   (contract, ingest boundary, channel naming) that let us replace internals later.
3. **Private by default.** Authorization is enforced by the database and Realtime policies,
   never by client code or obscure URLs.

## 2. System overview

```
 SOURCES                     INGESTION                       STORAGE                 DELIVERY
┌───────────────┐
│ Runner app    │─┐
│ (Expo)        │ │
├───────────────┤ │ HTTPS POST   ┌───────────────────────┐   ┌────────────────────┐
│ Simulator     │─┼────────────▶ │ Edge Function: ingest │──▶│ position_events    │ append-only
├───────────────┤ │ batched,     │  1 authenticate source│   ├────────────────────┤
│ Future:       │ │ canonical    │  2 validate contract  │──▶│ latest_positions   │ 1 row/participant
│ Garmin,       │ │ contract     │  3 dedupe (event_id)  │   └────────────────────┘
│ trackers,     │─┘              │  4 normalize + store  │
│ timing mats   │  (via adapter) │  5 publish by policy  │──▶ Supabase Realtime (private channels)
└───────────────┘                └───────────────────────┘     ├─ race:{id}:public      ─▶ spectators
                                                               └─ participant:{id}      ─▶ authorized
                                                                                           followers
                                                               Web app (React + MapLibre)
                                                               1. load snapshot (RLS-protected)
                                                               2. subscribe to channel(s)
```

## 3. Components

| Workspace                  | Responsibility                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile`              | Runner app. Sign-in, bib claim, consent, background tracking, status. No map.                                             |
| `apps/web`                 | Spectator app. Race page, runner search, follow, live map (MapLibre GL).                                                  |
| `packages/shared`          | Domain types and Zod schemas, including the **canonical position-event contract**.                                        |
| `packages/tracking-client` | Platform-neutral persistent queue + batch uploader. Storage is injected (SQLite on mobile, memory/file in the simulator). |
| `packages/config`          | Shared TypeScript and ESLint presets.                                                                                     |
| `supabase/migrations`      | Database schema, RLS policies, Realtime authorization policies. Source of truth for the DB.                               |
| `supabase/functions`       | Edge Functions (Deno). `ingest` plus future per-vendor adapters; shared code in `_shared/`.                               |
| `supabase/tests`           | pgTAP tests for RLS and Realtime authorization.                                                                           |
| `tools/simulator`          | Replays GPX tracks as N runners through the real ingest path. Dev and load testing.                                       |

**Dependency rule:** apps depend on packages; packages never depend on apps; nothing depends on
`tools/`. `packages/shared` has no dependencies other than Zod so it can be imported by Node,
React Native, the browser and Deno.

## 4. Ingestion

### 4.1 Canonical position event

Every source produces this shape, directly or through an adapter. Field list is the design;
the Zod schema in `packages/shared` (M1) is the implementation and source of truth.

| Field                                    | Type               | Notes                                                                         |
| ---------------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `event_id`                               | UUID               | Generated at the source. Idempotency key — retries never duplicate.           |
| `participant_id`                         | UUID               | Resolved from the authenticated source; never trusted from the payload alone. |
| `device_id`                              | UUID               | The registered source/device that produced the fix.                           |
| `source_type`                            | enum               | `mobile_app`, `simulator`; later `garmin`, `tracker`, `timing_mat`, …         |
| `recorded_at`                            | ISO-8601 timestamp | When the fix was taken (device clock).                                        |
| `received_at`                            | timestamp          | Set by the server. `received_at − recorded_at` = ingest latency.              |
| `lat`, `lon`                             | number (WGS84)     | Required for GPS sources.                                                     |
| `accuracy_m`                             | number \| null     | Horizontal accuracy.                                                          |
| `altitude_m`, `speed_mps`, `heading_deg` | number \| null     | Optional; sources fill what they have.                                        |
| `contract_version`                       | integer            | Lets us evolve the contract without breaking old app versions.                |

Requests carry a **batch** (1–N events). Batching is what makes offline backfill and, later,
high-throughput ingestion cheap.

Non-GPS sources (e.g. a timing mat reporting "bib 1234 crossed 21.1 km") are a separate event
kind in the same contract, added when that integration is built. The pipeline stages stay the same.

### 4.2 Pipeline (Edge Function `ingest`)

1. **Authenticate the source.** Runner app: Supabase user JWT → participant via
   `participants.user_id`. Machine sources (simulator now; trackers later): per-device API key,
   stored hashed in `devices`. The payload cannot claim a participant the caller doesn't own.
2. **Validate** against the shared contract. Reject malformed events; accept the rest of the batch.
3. **Deduplicate** on `event_id` (unique constraint, `on conflict do nothing`).
4. **Normalize and store**: insert into `position_events`; upsert `latest_positions` only if the
   event is newer than what is stored (late backfilled events must not move a runner backwards).
5. **Publish** according to the participant's visibility (§6).
6. **Respond** with accepted `event_id`s. The client deletes only acknowledged events from its queue.

### 4.3 Adding a new source

A new source never changes the pipeline, the database schema for positions, or the spectator app:

- **Push sources** (vendor webhooks, tracker gateways): a new Edge Function
  `ingest-<vendor>` that verifies the vendor's signature, maps the payload to canonical events and
  calls the shared pipeline in `supabase/functions/_shared/`.
- **Pull sources** (vendor APIs we poll): a scheduled job that does the same mapping.
- **On-device sources** (watch via phone): feed the same `tracking-client` queue.

Each source gets a `source_type` value and registers its devices in `devices`.

_Validate in M1:_ importing `packages/shared` from Deno Edge Functions. Plan: the package uses
explicit `.ts` import extensions and only depends on Zod, so Deno can import it by relative path
with an import map for `zod`.

## 5. Data model (MVP)

```
organizations ─┐
               └─< races ──< participants >── users (auth.users)
                     │            │
                     │            ├──< devices (source_type, hashed credential)
                     │            ├──< position_events (append-only, partition-ready)
                     │            ├──1 latest_positions
                     │            └──< participant_followers (private sharing)
                     └──1 courses (PostGIS LineString from GPX)
```

- **races**: name, start/end time, timezone, `is_published`, `retention_days` (default 30).
- **participants**: `race_id`, `bib`, `display_name`, `user_id` (nullable until claimed),
  `visibility` (`public` | `private`, **default `private`**), consent timestamp.
- **position_events**: columns from §4.1 plus `race_id`. Indexed by `(participant_id, recorded_at)`.
  Designed so it can be partitioned by race/time later without changing writers.
- **latest_positions**: one row per participant, also stores `distance_along_course_m`
  (PostGIS `ST_LineLocatePoint`) so spectators see "23.4 km".
- **participant_followers**: grants a user access to a private participant (§6.3).

There is no admin dashboard in the MVP: races, courses and participants are created with seed
SQL / an import script.

## 6. Security, privacy and access control

**Invariant:** _a private participant's location is never readable by anyone except the
participant and the people they have explicitly authorized — via any table, function, or Realtime
channel._

### 6.1 Threats we design against

| Threat                                                                  | Control                                                                                                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spectator subscribes to a guessed channel topic to see a private runner | All channels are **private** (Realtime Authorization); topic access is decided by RLS, not by obscurity.                                                                  |
| Spectator listens to DB changes on position tables                      | Position tables are **not** in the `supabase_realtime` publication. No `postgres_changes` on location data, ever.                                                         |
| Client forges broadcasts (fake positions) on a race channel             | No `INSERT` policy on `realtime.messages` for `anon`/`authenticated`: clients can receive, never send. Only the server publishes.                                         |
| Private runner leaks through the public race channel                    | `ingest` publishes private participants **only** to `participant:{id}`; the public race payload is built from public participants only.                                   |
| Direct table/API read of positions                                      | RLS on every table. `anon` can read `latest_positions` only for public participants in published races. `position_events` (history) is never directly readable by `anon`. |
| Payload over-sharing                                                    | Broadcast payloads carry IDs, coordinates and timestamps only — no names, emails or user IDs. Names come from RLS-protected tables.                                       |
| Leaked service key                                                      | `service_role` key lives only in Edge Function secrets. Never in `VITE_*` / `EXPO_PUBLIC_*` variables or the repo.                                                        |
| Forged positions for someone else                                       | `ingest` derives the participant from the authenticated caller, not from the payload.                                                                                     |

### 6.2 Realtime channels

| Topic                          | Who can subscribe (RLS on `realtime.messages`, `SELECT`)                            | Content                               |
| ------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------- |
| `race:{race_id}:public`        | Anyone, if the race is published                                                    | Positions of public participants only |
| `participant:{participant_id}` | The participant themself, or a user in `participant_followers` for that participant | That participant's positions          |

- Clients join with `{ config: { private: true } }`. Policies check `realtime.topic()` against
  the tables above.
- On hosted projects we disable **"Allow public access"** in Realtime settings so non-private
  channels cannot be used at all. (Manual setting per project — listed in the environment setup checklist.)
- Visibility changes take effect immediately for new positions (ingest reads current visibility,
  with at most a few seconds of caching). Positions already broadcast while public cannot be
  recalled; the app explains this when a runner switches to private.

_Validate in M1:_ subscribing to private channels as an unauthenticated spectator. If policies
for the `anon` role are not applied as expected, spectators will use **Supabase anonymous
sign-in** (no user interaction) and policies will target `authenticated`. Either way, the
invariant above is enforced by automated tests (§6.4).

### 6.3 Following a private runner

The runner shares a link containing a single-use or revocable **share token**. A spectator
redeems it through an RPC that inserts a row in `participant_followers` for their (anonymous)
user. The runner can list and revoke followers. Scheduled for M2/M3.

### 6.4 Verification

Security is tested, not assumed:

- **pgTAP tests** (`supabase/tests/`, run in CI from M1) assert, for each role, which rows of
  `latest_positions`/`position_events` are visible and which topics can be subscribed to.
- An **integration test** runs a real Realtime client as an anonymous spectator and asserts it
  cannot join `participant:{private_id}` and never receives a private participant on the race channel.
- Every PR checklist includes the invariant. Issues touching it get the `security` label.

### 6.5 GDPR and retention

- Explicit consent screen before the first tracking session; consent timestamp stored.
- Tracking is limited to the race window and stops automatically at race end (or manually).
- **Retention:** raw `position_events` are deleted `retention_days` after race end (default **30**,
  configurable per race; subject to the final privacy policy). Implemented with a daily `pg_cron`
  job. `latest_positions` and race results may be kept in aggregated/anonymized form.
- Supabase projects are hosted in an **EU region**.
- Participants can request deletion of their data (handled manually in the MVP, documented process).

## 7. Real-time delivery and latency

**Spectator flow:** load race metadata + `latest_positions` snapshot (RLS-protected REST) →
subscribe to `race:{id}:public` and any authorized `participant:{id}` channels → apply updates.
On reconnect, refetch the snapshot.

**Latency budget (target < 10 s):**

| Step                                  | Budget      |
| ------------------------------------- | ----------- |
| GPS fix → queued on device            | ~0 s        |
| Queue → upload (batch flush interval) | ≤ 5 s       |
| Network + ingest + store + publish    | ~0.5–1.5 s  |
| Realtime fan-out + render             | < 0.5 s     |
| **Total (typical)**                   | **≈ 2–7 s** |

Latency is measured, not estimated: `received_at − recorded_at` on the server, and the simulator
reports end-to-end fix-to-broadcast latency.

## 8. Mobile tracking

- **Library:** `expo-location` background location updates + `expo-task-manager`
  ([ADR-0004](adr/0004-background-location-expo-location-first.md)). Requires an Expo
  **development build**; Expo Go cannot run background location.
- **iOS:** "Always" location permission, `UIBackgroundModes: location`, appropriate accuracy and
  activity type for fitness. **Android:** foreground service with a persistent notification;
  guidance for disabling battery optimization on aggressive OEMs.
- **Buffering:** every fix is written to a persistent SQLite queue _before_ upload
  (`tracking-client`). Upload in batches; delete only acknowledged events. Survives network loss,
  app restarts and OS kills of the JS context.
- **Battery:** measured during the M1 spike and M4 pilot; target is that a typical phone survives
  a 5-hour marathon with tracking on.
- **Fallback:** if the M1 spike shows `expo-location` is not reliable enough on locked phones,
  we evaluate `react-native-background-geolocation` (paid for Android release builds). Because the
  queue/uploader is library-independent, only the location adapter changes.

## 9. Environments and cost

| Environment | Backend                                                     | Web                                                         | Mobile                          |
| ----------- | ----------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------- |
| Local       | Supabase CLI (Docker), simulator                            | Vite dev server                                             | Dev build on device / simulator |
| Staging     | Supabase **free** project (EU)                              | Free static host (e.g. Cloudflare Pages / Vercel / Netlify) | EAS `preview` channel           |
| Production  | Decided before the first public event (likely Supabase Pro) | Same host                                                   | EAS `production` channel        |

**Cost notes (development):**

- Supabase free projects **pause after a period of inactivity** and have Realtime connection and
  message quotas. Fine for development and a 10–100 runner pilot; re-check current limits before any public event.
- Map tiles: MapLibre GL (free, open source) with a free-tier or free tile source; no Google Maps.
- EAS Build free tier has a monthly build quota and queue times. Local builds
  (`npx expo run:ios|android`) are free and unlimited.
- **iOS devices:** a free Apple ID can install development builds locally via Xcode (short-lived
  provisioning). TestFlight distribution in M4 requires the Apple Developer Program (paid, yearly).
  Android devices need no paid account until Play Store distribution.

## 10. Scaling path (planned, not built)

50,000 runners × 1 fix / 5 s ≈ **10,000 events/s** at peak. The MVP pipeline will not sustain
that on a small instance; the design lets us scale in steps, each triggered by measured load-test
results (M5), without client changes:

1. **Batch writes** and partition `position_events` by race/time.
2. **Aggregate broadcasts**: publish per-race snapshots every 2–5 s instead of one message per fix;
   split channels by course segment or viewport so spectators receive only what they see.
3. **Cache/CDN snapshots** for very large spectator audiences instead of one socket per viewer.
4. **Dedicated ingestion service + queue** (e.g. Redis Streams/Kafka) in front of the database;
   the HTTP contract stays the same.

## 11. Risks and open questions

| Risk / question                                                     | Mitigation / when resolved                                     |
| ------------------------------------------------------------------- | -------------------------------------------------------------- |
| Background tracking unreliable on locked phones (esp. Android OEMs) | Real-device spike in M1, ADR-0004 fallback                     |
| Private-channel behavior for unauthenticated spectators             | Validate in M1; anonymous sign-in fallback (§6.2)              |
| Sharing `packages/shared` with Deno Edge Functions                  | Validate in M1 (§4.3)                                          |
| Supabase free-tier quotas during the pilot                          | Measure in M4; upgrade before public events                    |
| Default visibility (`private`) vs organizer expectations            | Revisit with first organizer; default stays privacy-preserving |
