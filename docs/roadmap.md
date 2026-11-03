# Track — Development Roadmap

Each milestone maps 1:1 to a [GitHub milestone](https://github.com/elsakifr/track/milestones).
Issues are tracked on GitHub and on the
[Track project board](https://github.com/users/elsakifr/projects/1); this document gives the
overview and the order of work. Work is split into two parallel **workstreams** so the two
developers rarely edit the same files:

- **Workstream A — Backend & web:** `supabase/`, `packages/shared`, `apps/web`, `tools/simulator`
- **Workstream B — Mobile:** `apps/mobile`, `packages/tracking-client`

The contract in `packages/shared` is the meeting point; changes to it are reviewed by both.

**Top priorities throughout:** the locked-phone GPS test and the privacy/security tests
(issues labeled `priority:P0` and `security`).

---

## M0 — Foundation ✅ Completed

**Goal:** a repository two developers can work in from day one.

- Monorepo (pnpm workspaces + Turborepo), shared TypeScript/ESLint/Prettier config
- Scaffolded `apps/web` (Vite + React) and `apps/mobile` (Expo), placeholder screens only
- Supabase CLI project (`supabase/`), empty migrations
- CI: format, lint, typecheck, test, build
- Docs: README, CLAUDE.md, architecture, roadmap, GitHub workflow, ADRs 0001–0006
- Issue templates, PR template, label definitions
- GitHub setup: `main` protected by the "Protect main" ruleset, labels, milestones M1–M5,
  issues for M1–M2 and the project board

Merged in [#1](https://github.com/elsakifr/track/pull/1). The Supabase staging project and the
Expo development build are tracked as issues in M1 ([#24](https://github.com/elsakifr/track/issues/24),
[#3](https://github.com/elsakifr/track/issues/3)).

---

## [M1 — Ingestion core & vertical slice](https://github.com/elsakifr/track/milestone/1)

**Goal:** positions flow end to end without a phone, a simulated runner moves on a live map, and
we know whether locked-phone tracking works with `expo-location`.

**Vertical-slice demo ([#13](https://github.com/elsakifr/track/issues/13)):** as early as possible,
a simulated runner moves on a live map using the real architecture — the simulator sends positions
through `/ingest`, they are stored and published on the private race channel, and the web map
shows them. The slice is privacy-safe from the start: ingest v1 publishes only public
participants, and the demo verifies that a seeded private runner never appears. The slice is
built from thin first versions of the real components, which later issues complete:

| Part           | Vertical slice                                                                   | Completed by                                                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database       | Core schema v1 + access rules ([#6](https://github.com/elsakifr/track/issues/6)) | Private runner channels ([#18](https://github.com/elsakifr/track/issues/18)), device keys ([#19](https://github.com/elsakifr/track/issues/19)), courses ([#20](https://github.com/elsakifr/track/issues/20)) |
| Channel access | Race channel, no client sends ([#8](https://github.com/elsakifr/track/issues/8)) | Private runner channels ([#18](https://github.com/elsakifr/track/issues/18))                                                                                                                                 |
| Ingest         | v1, public runners only ([#9](https://github.com/elsakifr/track/issues/9))       | Private routing ([#18](https://github.com/elsakifr/track/issues/18)), device keys ([#19](https://github.com/elsakifr/track/issues/19))                                                                       |
| Simulator      | One runner ([#11](https://github.com/elsakifr/track/issues/11))                  | Up to 100 runners + latency report ([#21](https://github.com/elsakifr/track/issues/21))                                                                                                                      |
| Web            | Minimal live map ([#12](https://github.com/elsakifr/track/issues/12))            | M2 spectator features ([#25](https://github.com/elsakifr/track/issues/25)–[#33](https://github.com/elsakifr/track/issues/33))                                                                                |

**Order of work:**

1. Contract first ([#2](https://github.com/elsakifr/track/issues/2), reviewed by both). In
   parallel, the locked-phone test starts immediately: [#3](https://github.com/elsakifr/track/issues/3)
   → [#4](https://github.com/elsakifr/track/issues/4).
2. Slice path: [#5](https://github.com/elsakifr/track/issues/5), [#6](https://github.com/elsakifr/track/issues/6)
   → [#7](https://github.com/elsakifr/track/issues/7), [#8](https://github.com/elsakifr/track/issues/8)
   → [#9](https://github.com/elsakifr/track/issues/9), [#10](https://github.com/elsakifr/track/issues/10)
   → [#11](https://github.com/elsakifr/track/issues/11), [#12](https://github.com/elsakifr/track/issues/12)
   → **demo [#13](https://github.com/elsakifr/track/issues/13)**. Mobile continues with
   [#14](https://github.com/elsakifr/track/issues/14) → [#15](https://github.com/elsakifr/track/issues/15)
   (ADR-0007) and [#16](https://github.com/elsakifr/track/issues/16).
3. Complete M1: [#17](https://github.com/elsakifr/track/issues/17)–[#24](https://github.com/elsakifr/track/issues/24),
   including the security integration test [#22](https://github.com/elsakifr/track/issues/22).

| Issue                                              | Title                                                                                                                  | WS  | Size | Priority | Blocked by                                                                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --- | ---- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#2](https://github.com/elsakifr/track/issues/2)   | feat(shared): position-event contract v1 (Zod) + tests                                                                 | A+B | M    | P0       | —                                                                                                                                                    |
| [#3](https://github.com/elsakifr/track/issues/3)   | chore(mobile): Expo development build on a real iOS and Android device                                                 | B   | S    | P0       | —                                                                                                                                                    |
| [#4](https://github.com/elsakifr/track/issues/4)   | spike(mobile): background location on a locked phone with expo-location (5 s, 60+ min, airplane-mode gap)              | B   | L    | P0       | [#3](https://github.com/elsakifr/track/issues/3)                                                                                                     |
| [#5](https://github.com/elsakifr/track/issues/5)   | spike(backend): import @track/shared in Deno + private-channel access for anonymous spectators                         | A   | M    | P0       | [#2](https://github.com/elsakifr/track/issues/2)                                                                                                     |
| [#6](https://github.com/elsakifr/track/issues/6)   | feat(backend): core schema v1 (races, participants, position_events, latest_positions) + access rules + database tests | A   | M    | P0       | [#2](https://github.com/elsakifr/track/issues/2)                                                                                                     |
| [#7](https://github.com/elsakifr/track/issues/7)   | chore(ci): database job (supabase start, db reset, database tests)                                                     | A   | S    | P1       | [#6](https://github.com/elsakifr/track/issues/6)                                                                                                     |
| [#8](https://github.com/elsakifr/track/issues/8)   | feat(backend): race channel authorization (private channels, no client sends) + database tests                         | A   | M    | P0       | [#5](https://github.com/elsakifr/track/issues/5), [#6](https://github.com/elsakifr/track/issues/6)                                                   |
| [#9](https://github.com/elsakifr/track/issues/9)   | feat(backend): ingest v1 (runner login, validate, deduplicate, store, publish public runners only)                     | A   | M    | P0       | [#2](https://github.com/elsakifr/track/issues/2), [#6](https://github.com/elsakifr/track/issues/6), [#8](https://github.com/elsakifr/track/issues/8) |
| [#10](https://github.com/elsakifr/track/issues/10) | chore(backend): seed demo race (GPX file, public and private test runners, local test logins)                          | A   | S    | P1       | [#6](https://github.com/elsakifr/track/issues/6)                                                                                                     |
| [#11](https://github.com/elsakifr/track/issues/11) | feat(simulator): replay a GPX track as one runner through /ingest                                                      | A   | M    | P1       | [#9](https://github.com/elsakifr/track/issues/9), [#10](https://github.com/elsakifr/track/issues/10)                                                 |
| [#12](https://github.com/elsakifr/track/issues/12) | feat(web): minimal live map page (MapLibre; markers from current positions + live updates)                             | A   | M    | P1       | [#8](https://github.com/elsakifr/track/issues/8), [#9](https://github.com/elsakifr/track/issues/9)                                                   |
| [#13](https://github.com/elsakifr/track/issues/13) | demo: vertical slice — simulated runner moves on the live map; private runner never visible                            | A+B | S    | P0       | [#11](https://github.com/elsakifr/track/issues/11), [#12](https://github.com/elsakifr/track/issues/12)                                               |
| [#14](https://github.com/elsakifr/track/issues/14) | spike(mobile): battery, accuracy and update-interval measurements (1 iPhone + 2 Android brands)                        | B   | M    | P0       | [#4](https://github.com/elsakifr/track/issues/4)                                                                                                     |
| [#15](https://github.com/elsakifr/track/issues/15) | docs(adr): ADR-0007 — outcome of the background-location spike                                                         | B   | S    | P0       | [#4](https://github.com/elsakifr/track/issues/4), [#14](https://github.com/elsakifr/track/issues/14)                                                 |
| [#16](https://github.com/elsakifr/track/issues/16) | feat(tracking-client): queue interface + in-memory implementation + tests                                              | B   | M    | P1       | [#2](https://github.com/elsakifr/track/issues/2)                                                                                                     |
| [#17](https://github.com/elsakifr/track/issues/17) | feat(tracking-client): batch uploader with acknowledgement, retry and backoff (tested against a mock)                  | B   | M    | P1       | [#16](https://github.com/elsakifr/track/issues/16)                                                                                                   |
| [#18](https://github.com/elsakifr/track/issues/18) | feat(backend): private runner channels + ingest routing + database tests                                               | A   | M    | P0       | [#8](https://github.com/elsakifr/track/issues/8), [#9](https://github.com/elsakifr/track/issues/9)                                                   |
| [#19](https://github.com/elsakifr/track/issues/19) | feat(backend): device API keys for machine sources; simulator switches to a key                                        | A   | M    | P1       | [#9](https://github.com/elsakifr/track/issues/9)                                                                                                     |
| [#20](https://github.com/elsakifr/track/issues/20) | feat(backend): courses (PostGIS) + distance along the course                                                           | A   | M    | P2       | [#6](https://github.com/elsakifr/track/issues/6)                                                                                                     |
| [#21](https://github.com/elsakifr/track/issues/21) | feat(simulator): up to 100 runners + latency report                                                                    | A   | M    | P1       | [#11](https://github.com/elsakifr/track/issues/11), [#19](https://github.com/elsakifr/track/issues/19)                                               |
| [#22](https://github.com/elsakifr/track/issues/22) | test(security): anonymous spectator never receives a private runner's positions (integration test)                     | A   | M    | P0       | [#18](https://github.com/elsakifr/track/issues/18), [#21](https://github.com/elsakifr/track/issues/21)                                               |
| [#23](https://github.com/elsakifr/track/issues/23) | feat(backend): retention job (pg_cron, retention_days)                                                                 | A   | S    | P1       | [#6](https://github.com/elsakifr/track/issues/6)                                                                                                     |
| [#24](https://github.com/elsakifr/track/issues/24) | chore(infra): Supabase staging project (EU), Realtime public access off, secrets                                       | A   | S    | P1       | —                                                                                                                                                    |

**Done when:** the vertical-slice demo is shown; 100 simulated runners stream with a latency
report; database and integration tests prove private positions are unreachable for spectators;
ADR-0007 (background location) is written.

---

## [M2 — Spectator web](https://github.com/elsakifr/track/milestone/2)

**Goal:** spectators can find and follow runners live.

| Issue                                              | Title                                                                                        | WS  | Size | Priority | Blocked by                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- | --- | ---- | -------- | ------------------------------------------------------------------------------------------------------ |
| [#25](https://github.com/elsakifr/track/issues/25) | feat(web): app structure (Supabase client, env config, routing), building on the slice       | A   | S    | P1       | [#12](https://github.com/elsakifr/track/issues/12)                                                     |
| [#26](https://github.com/elsakifr/track/issues/26) | feat(web): race map with course line + choice of free tile source                            | A   | M    | P1       | [#20](https://github.com/elsakifr/track/issues/20), [#25](https://github.com/elsakifr/track/issues/25) |
| [#27](https://github.com/elsakifr/track/issues/27) | feat(web): reliable live updates (reconnect, reload snapshot, handle out-of-order positions) | A   | M    | P1       | [#25](https://github.com/elsakifr/track/issues/25)                                                     |
| [#28](https://github.com/elsakifr/track/issues/28) | feat(web): search runners by name or bib number                                              | A   | S    | P1       | [#25](https://github.com/elsakifr/track/issues/25)                                                     |
| [#29](https://github.com/elsakifr/track/issues/29) | feat(web): follow runners (saved in the browser) + highlight them on the map                 | A   | M    | P1       | [#27](https://github.com/elsakifr/track/issues/27), [#28](https://github.com/elsakifr/track/issues/28) |
| [#30](https://github.com/elsakifr/track/issues/30) | feat(backend): share tokens + participant_followers + redeem function + database tests       | A   | M    | P0       | [#18](https://github.com/elsakifr/track/issues/18)                                                     |
| [#31](https://github.com/elsakifr/track/issues/31) | feat(web): follow a private runner via share link (anonymous sign-in)                        | A   | M    | P0       | [#5](https://github.com/elsakifr/track/issues/5), [#30](https://github.com/elsakifr/track/issues/30)   |
| [#32](https://github.com/elsakifr/track/issues/32) | feat(web): "last updated" indicator per runner                                               | A   | S    | P2       | [#27](https://github.com/elsakifr/track/issues/27)                                                     |
| [#33](https://github.com/elsakifr/track/issues/33) | chore(infra): deploy web to a free static host against staging                               | A   | S    | P1       | [#24](https://github.com/elsakifr/track/issues/24)                                                     |

**Done when:** simulated runners move on the staging map with < 10 s latency; search and follow
work; a private runner is visible only via a valid share link.

---

## [M3 — Mobile tracking](https://github.com/elsakifr/track/milestone/3)

**Goal:** a real phone in a runner's pocket reports positions reliably.

Planned scope (issues will be refined after M1 and M2):

- Sign-in (magic link) and bib claim
- Consent screen + privacy settings (public/private, share link, revoke followers)
- Background tracking per ADR-0007 outcome, 5 s interval, race-window auto-stop
- SQLite-backed `tracking-client` queue, batch upload, backoff, acknowledgement handling
- Tracking status UI (GPS, queue size, last upload, battery hint)
- Android battery-optimization guidance; iOS permission flow

**Done when:** a locked phone tracks a 60-minute run, an offline period is backfilled without loss
or duplicates, and battery use is documented.

---

## [M4 — Pilot event](https://github.com/elsakifr/track/milestone/4)

**Goal:** one real run with 10–100 participants.

Planned scope (issues will be refined after M1 and M2):

- Internal distribution: TestFlight (requires Apple Developer Program) and Play internal testing
- Monitoring: ingest errors, latency percentiles, queue backlogs, Realtime connections
- Privacy policy text, consent copy, data-deletion process
- Free-tier quota check; decide on production plan
- Race import script (participants + course), since there is no admin dashboard
- Pilot runbook (before / during / after the event) and post-pilot report

**Done when:** a real event is tracked end to end and latency, data loss and battery results are
documented.

---

## [M5 — Scale readiness](https://github.com/elsakifr/track/milestone/5)

**Goal:** prove the path from 100 to 50,000 participants.

Planned scope (issues will be refined after M1 and M2):

- Simulator load tests at 1k / 5k / 10k runners, with reports
- Partition `position_events`; batched writes
- Aggregated race snapshots; segment/viewport channels
- ADR: next-step ingestion infrastructure based on measured limits

**Done when:** throughput limits are measured and the scaling plan is backed by data.

---

## Later (not in MVP)

Official timing-system adapter · Garmin / wearable integrations · dedicated GPS trackers ·
organizer dashboard · finish-time predictions · payments.
