# Track

Real-time GPS tracking for endurance events. Race organizers offer Track to their participants
and spectators: runners carry their phone, and spectators follow them live on a map.

> **Status:** M0 Foundation. Repository structure, tooling and documentation are in place;
> no application features yet. See the [roadmap](docs/roadmap.md).

## How it works

```
Runner app ─┐                                                   ┌─▶ Spectator web app
Simulator  ─┼─▶ /ingest (Edge Function) ─▶ Postgres ─▶ Realtime ─┤    (live map, search, follow)
Future     ─┘   one contract for every     (Supabase)  (private  └─▶ Authorized followers
sources         GPS source                              channels)      of private runners
```

- **Any GPS source, one pipeline:** every source sends the same versioned position-event
  contract to one ingestion endpoint ([ADR-0002](docs/adr/0002-source-independent-ingestion.md)).
- **Private by default:** private runners' positions are only delivered on authorized channels
  ([architecture §6](docs/architecture.md#6-security-privacy-and-access-control)).
- **Offline-tolerant:** the phone buffers fixes and backfills when it reconnects.

## Repository layout

```
apps/
  mobile/            Expo (React Native) runner app — background tracking
  web/               React + Vite spectator app — search, follow, live map
packages/
  shared/            Domain types + Zod schemas (the position-event contract)
  tracking-client/   Platform-neutral offline queue + batch uploader
  config/            Shared TypeScript / ESLint presets
supabase/
  migrations/        Database schema, RLS and Realtime policies
  functions/         Edge Functions (ingest + future source adapters)
  tests/             pgTAP tests for RLS and Realtime authorization
  seed.sql           Local demo data
tools/
  simulator/         Replays GPX tracks as simulated runners
docs/                Architecture, roadmap, GitHub workflow, ADRs
```

## Prerequisites

| Tool                             | Version  | Needed for                                 |
| -------------------------------- | -------- | ------------------------------------------ |
| [Node.js](https://nodejs.org)    | ≥ 22.13  | Everything (see `.nvmrc`)                  |
| [pnpm](https://pnpm.io)          | 10.x     | Package manager (pinned in `package.json`) |
| [Docker](https://www.docker.com) | recent   | Local Supabase                             |
| Xcode / Android Studio           | optional | Native dev builds (from M1)                |

Enable pnpm via Corepack (ships with Node):

```sh
corepack enable
```

If `corepack enable` is not permitted on your machine, use `npm install -g pnpm@10` instead.
The Supabase CLI is installed as a dev dependency; run it as `pnpm supabase <command>`.

## Getting started

```sh
git clone git@github.com:elsakifr/track.git
cd track
pnpm install
pnpm check          # format check, lint, typecheck, tests — same as CI
```

**Web app**

```sh
cp apps/web/.env.example apps/web/.env.local
pnpm dev:web        # http://localhost:5173
```

**Mobile app**

```sh
cp apps/mobile/.env.example apps/mobile/.env.local
pnpm dev:mobile     # scan the QR code with Expo Go (M0 placeholder only)
```

From M1, background location requires a development build (`npx expo run:ios|android` in
`apps/mobile`, or EAS). Expo Go cannot run background location.

**Local Supabase** (requires Docker running)

```sh
pnpm db:start       # starts Postgres, Auth, Realtime, Studio — prints URLs and keys
pnpm db:status      # show URLs and keys again
pnpm db:reset       # re-apply migrations + seed
pnpm db:stop
```

Studio runs at http://127.0.0.1:54323. Put the printed API URL and anon key in the `.env.local` files.

## Scripts

| Command           | Description                                         |
| ----------------- | --------------------------------------------------- |
| `pnpm check`      | Everything CI runs (format, lint, typecheck, test)  |
| `pnpm lint`       | ESLint in all workspaces                            |
| `pnpm typecheck`  | TypeScript in all workspaces                        |
| `pnpm test`       | Tests in all workspaces                             |
| `pnpm build`      | Build all buildable workspaces                      |
| `pnpm format`     | Format the repository with Prettier                 |
| `pnpm dev:web`    | Start the web app                                   |
| `pnpm dev:mobile` | Start the Expo dev server                           |
| `pnpm db:*`       | Local Supabase (`start`, `stop`, `reset`, `status`) |

## Documentation

- [Architecture](docs/architecture.md): components, ingestion contract, data model, security, scaling
- [Roadmap](docs/roadmap.md): milestones M0–M5 and proposed issues
- [GitHub workflow](docs/github-workflow.md): branching, PRs, reviews, labels, project board
- [Architecture Decision Records](docs/adr/)
- [CLAUDE.md](CLAUDE.md): instructions for Claude Code (also a useful summary of project rules)

## Contributing

Branch from `main` as `<type>/<issue>-<description>`, open a PR with a Conventional Commits title,
get one approval and a green CI, then squash merge. Details in
[docs/github-workflow.md](docs/github-workflow.md).
