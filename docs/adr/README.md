# Architecture Decision Records

Short records of significant decisions: the context, what we decided and the consequences.
They stop the team from re-litigating settled questions and explain _why_ the code looks the way it does.

- Copy [`0000-template.md`](0000-template.md) to `NNNN-short-title.md` (next free number).
- Status: `Proposed` → `Accepted` → (`Superseded by ADR-NNNN` | `Deprecated`).
- Never rewrite an accepted ADR's decision; supersede it with a new one.

| ADR                                                     | Decision                                                    | Status   |
| ------------------------------------------------------- | ----------------------------------------------------------- | -------- |
| [0001](0001-monorepo-pnpm-turborepo.md)                 | Monorepo with pnpm workspaces and Turborepo                 | Accepted |
| [0002](0002-source-independent-ingestion.md)            | Source-independent ingestion through one contract           | Accepted |
| [0003](0003-private-realtime-channels.md)               | Private Realtime Broadcast channels, server-only publishing | Accepted |
| [0004](0004-background-location-expo-location-first.md) | Start with expo-location; real-device spike in M1           | Accepted |
| [0005](0005-position-data-retention.md)                 | 30-day configurable retention of raw positions              | Accepted |
| [0006](0006-web-react-vite.md)                          | Spectator web app with React and Vite                       | Accepted |
