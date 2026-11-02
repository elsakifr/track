# CLAUDE.md

Instructions for Claude Code in the Track repository. Read this first; deeper context is in
`docs/architecture.md`, `docs/roadmap.md`, `docs/github-workflow.md` and `docs/adr/`.

## Project

Track is a B2B real-time GPS tracking platform for endurance events (MVP: marathons and
half-marathons). Runners use an Expo app that tracks in the background; spectators follow them
on a React web map. Backend is Supabase (Postgres, Auth, Realtime, Edge Functions).

Current milestone: see the top of `docs/roadmap.md`. **Only build what the current milestone and
issue ask for.**

## Repository map

- `apps/mobile` — Expo runner app. Also read `apps/mobile/AGENTS.md` (Expo-specific rules).
- `apps/web` — React + Vite spectator app.
- `packages/shared` — domain types + Zod schemas; the canonical position-event contract.
- `packages/tracking-client` — platform-neutral offline queue + uploader (storage injected).
- `packages/config` — shared tsconfig and ESLint presets.
- `supabase/` — `migrations/`, `functions/` (Deno), `tests/` (pgTAP), `seed.sql`, `config.toml`.
- `tools/simulator` — replays GPX tracks as simulated runners through `/ingest`.

## Commands

```sh
pnpm install                     # install all workspaces
pnpm check                       # format check + lint + typecheck + test (what CI runs)
pnpm format                      # fix formatting
pnpm dev:web                     # web app on http://localhost:5173
pnpm dev:mobile                  # Expo dev server
pnpm --filter @track/<pkg> <script>   # run a script in one workspace
pnpm db:start | db:reset | db:stop    # local Supabase (Docker)
pnpm supabase migration new <name>    # create a migration
pnpm supabase test db                 # run pgTAP tests
```

Run `pnpm check` before declaring work done. In `apps/mobile`, add Expo packages with
`npx expo install <pkg>` (it picks SDK-compatible versions), not `pnpm add`.

## Architecture rules (non-negotiable)

1. **All position data goes through the ingestion boundary** (`supabase/functions/ingest` or a
   source adapter) using the contract in `packages/shared`. Clients never insert into position
   tables directly. New GPS sources are adapters that map to the contract (ADR-0002).
2. **Privacy invariant:** a private participant's location must never be readable by
   unauthorized users via any table, RPC, or Realtime channel (architecture §6). Concretely:
   - Every table has RLS enabled with explicit policies.
   - All Realtime channels are private; there is no client `INSERT` policy on `realtime.messages`.
   - Position tables are never added to the `supabase_realtime` publication.
   - Private participants are published only to `participant:{id}`, never to `race:{id}:public`.
   - Broadcast payloads contain IDs, coordinates and timestamps only — no names or user data.
   - Any change touching these must include/update pgTAP tests and carry the `security` label.
3. **Schema changes only via new migrations** in `supabase/migrations/`. Never edit a merged migration.
4. **Secrets:** the `service_role` key lives only in Edge Function secrets. Never put it in
   `VITE_*` or `EXPO_PUBLIC_*` variables (those ship to clients), in code, or in commits.
   Only `.env.example` files are committed.
5. **Contract changes** (`packages/shared`) go in their own PR, are versioned
   (`contract_version`) and stay backwards compatible with released app versions.
6. **Dependency direction:** apps → packages. Packages never import from apps. Nothing imports
   from `tools/`. `packages/shared` depends only on Zod (it must run in Node, RN, browser and Deno).

## MVP scope

In scope: runner app with background tracking (~5 s), offline buffering, ingest, spectator search/
follow/live map, public/private visibility, 10–100 runners, < 10 s latency.

**Not in MVP — do not build unless an issue explicitly asks:** finish-time predictions,
organizer admin dashboard, payments, custom hardware, wearable/Garmin integrations.

## Conventions

- TypeScript strict everywhere; no `any` without a comment explaining why.
- Prettier formatting (`.prettierrc.json`), ESLint via `@track/config/eslint`.
- Type-only imports use `import type`.
- Tests: Vitest for packages and web (`*.test.ts` next to the code); pgTAP for database policies.
- React versions are pinned to what the current Expo SDK requires (`overrides` in
  `pnpm-workspace.yaml`); upgrade them only together with the Expo SDK.
- Significant architectural decisions get an ADR in `docs/adr/` (copy `0000-template.md`).
- Documentation and code comments are in English.

## Git workflow

- Never commit to or push `main` directly. Branch as `<type>/<issue>-<short-desc>`
  (types: feat, fix, chore, docs, refactor, test, spike).
- Commit messages and PR titles use Conventional Commits, e.g. `feat(web): add runner search`.
- **Do not commit, push, open PRs, or create GitHub issues/labels without the user's explicit approval.**
- **Commits are attributed only to the human developers.** Never add Claude as a co-author:
  no `Co-Authored-By: Claude` trailers and no AI attribution in commit messages or pull request
  descriptions (no "Generated with Claude Code" lines).
- Do not commit `.env*` files (except `.env.example`), keys, or generated `ios/`/`android/` folders.
