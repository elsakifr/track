# ADR-0004: Start with expo-location; real-device spike in M1

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Tracking must continue with the phone locked, at ~5 s intervals, for up to ~5 hours. iOS and
especially Android OEMs restrict background work. `expo-location` (+ `expo-task-manager`) is free
and first-party. `react-native-background-geolocation` (Transistor Software) is battle-tested
for this use case but requires a paid license for Android release builds.

## Decision

Start with **`expo-location`**. Run a **real-device spike early in M1** (locked iPhone and at least
two Android OEMs, 60+ minutes, including a connectivity gap), measuring interval regularity,
accuracy and battery drain. Record the outcome in a follow-up ADR.

Keep the location library behind a small adapter; the persistent queue and uploader in
`packages/tracking-client` are library-independent.

## Alternatives considered

- **Transistor `react-native-background-geolocation` from day one** — likely more reliable,
  but costs money before we know we need it.
- **Native modules of our own** — highest control, highest cost; not justified for the MVP.

## Consequences

- Requires Expo development builds (not Expo Go) from M1.
- If the spike fails its criteria, switching costs only the adapter, not the queue/upload logic.
