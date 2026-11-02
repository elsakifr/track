# Track — Development Roadmap

Each milestone maps 1:1 to a GitHub milestone. Issues below are the proposed backlog; they are
created on GitHub only after review. Work is split into two parallel **workstreams** so the two
developers rarely edit the same files:

- **Workstream A — Backend & web:** `supabase/`, `packages/shared`, `apps/web`, `tools/simulator`
- **Workstream B — Mobile:** `apps/mobile`, `packages/tracking-client`

The contract in `packages/shared` is the meeting point; changes to it are reviewed by both.

---

## M0 — Foundation ✅ (this PR)

**Goal:** a repository two developers can work in from day one.

- Monorepo (pnpm workspaces + Turborepo), shared TypeScript/ESLint/Prettier config
- Scaffolded `apps/web` (Vite + React) and `apps/mobile` (Expo), placeholder screens only
- Supabase CLI project (`supabase/`), empty migrations
- CI: format, lint, typecheck, test, build
- Docs: README, CLAUDE.md, architecture, roadmap, GitHub workflow, ADRs 0001–0006
- Issue templates, PR template, label definitions

**Done when:** a new developer can clone, `pnpm install`, `pnpm check`, run the web app and the
mobile app, and start local Supabase.

**Remaining M0 tasks (manual, after the PR is merged):** branch protection on `main`, create
labels/milestones/project board, create Supabase staging project (EU), Expo account + EAS project.

---

## M1 — Ingestion core + background-location spike

**Goal:** positions flow end to end without a phone, and we know whether locked-phone tracking
works with `expo-location`.

**Workstream B (starts first, highest risk):**

| #   | Issue                                                                                                                                                | Type    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| B1  | Spike: background location on a **locked** iPhone and Android phone with `expo-location` (dev build, 5 s interval, 60+ min, airplane-mode gap) → ADR | spike   |
| B2  | Spike: battery drain and fix accuracy/interval measurements on at least 2 Android OEMs + 1 iPhone                                                    | spike   |
| B3  | `tracking-client`: persistent queue interface + in-memory implementation + tests                                                                     | feature |

**Workstream A:**

| #   | Issue                                                                                       | Type              |
| --- | ------------------------------------------------------------------------------------------- | ----------------- |
| A1  | Canonical position-event contract (Zod) + tests in `packages/shared`                        | feature           |
| A2  | Migration: races, courses, participants, devices, position_events, latest_positions + RLS   | feature           |
| A3  | Realtime authorization policies (private channels, no client sends) + pgTAP tests           | feature, security |
| A4  | Spike: private-channel subscribe as anonymous spectator; import `packages/shared` from Deno | spike             |
| A5  | Edge Function `ingest`: auth, validate, dedupe, store, publish by visibility                | feature           |
| A6  | Seed: demo race with course (GPX) and 100 participants                                      | chore             |
| A7  | Simulator: replay GPX as N runners via `/ingest`; report latency                            | feature           |
| A8  | CI: `database` job (supabase start, db reset, pgTAP)                                        | chore             |
| A9  | Retention job (`pg_cron`, `retention_days`)                                                 | feature           |

**Done when:** the simulator streams 100 runners, data lands in `latest_positions`, public and
private participants are delivered on the correct channels, pgTAP proves private data is
unreachable for spectators, and the locked-phone spike has a written conclusion (ADR).

---

## M2 — Spectator web

**Goal:** spectators can find and follow runners live.

- Race page: course line + live positions (MapLibre GL, free tile source)
- Runner search by name or bib (public participants)
- Follow one or more runners; follow list persisted locally
- Snapshot-then-subscribe with reconnect handling
- Follow a private runner via share link (`participant_followers`, redeem RPC)
- Latency indicator (time since last update per runner)
- Deploy web to a free static host against staging

**Done when:** simulated runners move on the map with < 10 s latency on staging, and a private
runner is visible only via a valid share link.

---

## M3 — Mobile tracking

**Goal:** a real phone in a runner's pocket reports positions reliably.

- Sign-in (magic link) and bib claim
- Consent screen + privacy settings (public/private, share link, revoke followers)
- Background tracking per ADR-0004 outcome, 5 s interval, race-window auto-stop
- SQLite-backed `tracking-client` queue, batch upload, backoff, acknowledgement handling
- Tracking status UI (GPS, queue size, last upload, battery hint)
- Android battery-optimization guidance; iOS permission flow

**Done when:** a locked phone tracks a 60-minute run, an offline period is backfilled without loss
or duplicates, and battery use is documented.

---

## M4 — Pilot event

**Goal:** one real run with 10–100 participants.

- Internal distribution: TestFlight (requires Apple Developer Program) and Play internal testing
- Monitoring: ingest errors, latency percentiles, queue backlogs, Realtime connections
- Privacy policy text, consent copy, data-deletion process
- Free-tier quota check; decide on production plan
- Pilot runbook (before / during / after the event) and post-pilot report

**Done when:** a real event is tracked end to end and latency, data loss and battery results are
documented.

---

## M5 — Scale readiness

**Goal:** prove the path from 100 to 50,000 participants.

- Simulator load tests at 1k / 5k / 10k runners, with reports
- Partition `position_events`; batched writes
- Aggregated race snapshots; segment/viewport channels
- ADR: next-step ingestion infrastructure based on measured limits

**Done when:** throughput limits are measured and the scaling plan is backed by data.

---

## Later (not in MVP)

Official timing-system adapter · Garmin / wearable integrations · dedicated GPS trackers ·
organizer dashboard · finish-time predictions · payments.
