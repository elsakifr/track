# ADR-0008: Watch-only tracking is a first-class source, built after the MVP

- **Status:** Proposed
- **Date:** 2026-11-14
- **Deciders:** product owner; to be accepted by both developers in review

## Context

Runners must eventually be able to use a compatible sports watch **instead of** carrying a phone:
the watch records GPS and its positions reach Track live, with no phone involved. The MVP ships
with the phone app only, but decisions made now — the contract, ingest authentication, the data
model and the upload protocol — must not make watch-only tracking expensive later.

Until now the architecture treated watches as an undefined future integration, and §4.3 assumed
"watch via phone". That does not meet the requirement.

Constraints that shape the design:

- **Watches run native code.** watchOS (Swift), Wear OS (Kotlin) and vendor platforms cannot run
  our TypeScript packages. What a watch can share with the phone app is the **HTTP contract and
  the upload protocol**, not `packages/tracking-client`.
- **No interactive sign-in.** A watch cannot use the phone app's email sign-in flow. It needs its
  own credential, bound to one participant.
- **Two possible delivery paths.** A watch either sends data itself over its own network
  connection, or a vendor's cloud relays it. Which platforms and vendors allow **live** data
  without a phone, and on what terms, is **not yet known**.
- **Battery and bandwidth** are tighter than on a phone.
- **Silence is normal.** The iPhone spike (#4) showed that iOS stops delivering fixes while the
  device is stationary. Watches may behave similarly (not yet verified).

## Decision

1. **Scope and timing.** Watch-only tracking is built **after the MVP**, in its own milestone
   (M6 — Watch-only tracking, after the M4 pilot). From now on, MVP work must keep it possible;
   the obligations are listed in points 3–8.
2. **Two integration paths, both through the ingestion boundary (ADR-0002):**
   - **Direct watch app:** a Track app on the watch posts canonical batches to `/ingest` over the
     watch's own network connection, authenticated with a device credential.
   - **Vendor relay:** a vendor's cloud pushes to an `ingest-<vendor>` adapter (or we poll its
     API), and the adapter maps the payload to the canonical contract.

   No platform or vendor is assumed. A **feasibility spike** decides which path(s) and which
   watches M6 targets before any watch code is written.

3. **The interface is the contract plus a language-neutral upload protocol.** `packages/shared`
   stays the source of truth for the contract. The upload protocol — batching, acknowledgement by
   `event_id`, deleting only acknowledged events, idempotent resends, retry with backoff — is
   specified in `docs/architecture.md` §4.4. `packages/tracking-client` is the TypeScript
   reference implementation, and its tests describe the expected behaviour; native watch apps
   implement the same protocol. A machine-readable schema for native clients (e.g. JSON Schema
   generated from the Zod schema) is added when M6 starts.
4. **Every source authenticates as a registered device.** A device belongs to exactly one
   participant (and so one race), has a hashed, revocable credential, and may only call ingest.
   Ingest must support device credentials alongside user sessions; device keys (#19) are a
   prerequisite for M6. Watch pairing (e.g. a short code shown in the phone app or on the web)
   is designed in M6.
5. **A participant can have several devices** (phone and watch, or a replacement device).
   Deduplication stays per participant on `event_id`. Each stored event records which device
   and `source_type` produced it. `latest_positions` keeps the fix with the most recent
   `recorded_at`, regardless of source; a source priority rule is added only if real data shows
   it is needed.
6. **Contract changes follow the existing rules.** New `source_type` values (e.g. `watch_app`
   or a vendor name) are added in their own, versioned, backwards-compatible contract PR when the
   integration is built. Contract v1 does not change for this ADR.
7. **No source is required to send heartbeats.** Any source may go silent while stationary, so
   "time since last fix" is shown to spectators as data ("last seen"), never treated as an error
   by itself.
8. **The privacy invariant applies unchanged.** A watch position is a participant position:
   ingest routes it by the participant's visibility exactly like a phone position. A vendor relay
   receives and forwards only what the participant has consented to.

## Alternatives considered

- **Watch via phone only** (the watch is a sensor, the phone uploads) — simpler, but does not
  meet the requirement that runners can leave the phone at home.
- **A separate pipeline for watches** — duplicates validation, storage and privacy logic;
  rejected by ADR-0002.
- **Build watch support in the MVP** — the platforms are unproven, it needs native apps and
  vendor agreements, and it would delay the pilot.
- **Design it later** — the first migrations and the ingest authentication would then likely
  assume one phone per runner, and merged migrations cannot be edited.

## Consequences

- MVP issues carry concrete obligations: ingest designed for device credentials (#9, #19), a
  data model with several devices per participant (#6, #19), and a documented upload protocol
  with a reference implementation (#16, #17).
- `packages/tracking-client` must keep its protocol behaviour explicit and well tested, because
  native clients will copy it.
- New roadmap milestone M6 with a feasibility spike; the GitHub milestone and issues are created
  separately.
- The spectator app needs no change for watches: it is source-independent.
