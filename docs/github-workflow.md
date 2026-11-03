# Track — GitHub Workflow

How two developers (and Claude Code) collaborate on Track.

## Branching: GitHub Flow

- `main` is always green and deployable. **No direct pushes.**
- All work happens on short-lived branches cut from the latest `main`:

  ```
  <type>/<issue-number>-<short-description>
  feat/14-ingest-function
  fix/22-queue-retry-backoff
  spike/9-locked-phone-tracking
  ```

  Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `spike`.

- Aim to merge within 1–3 days. Large features are split into several PRs behind the scenes
  (e.g. migration first, then function, then UI).
- **Spike branches are throwaway.** Their output is an ADR and findings, merged in a separate
  `docs/` PR. Spike code is not merged to `main` unless it is rewritten to production standard.

## Commits and pull requests

- **PR titles follow [Conventional Commits](https://www.conventionalcommits.org/):**
  `feat(web): add runner search`, `fix(mobile): flush queue on reconnect`,
  `chore(ci): add database job`. Scopes: `mobile`, `web`, `backend`, `shared`, `tracking-client`,
  `simulator`, `ci`, `docs`.
- **Squash merge only.** The PR title becomes the commit on `main`, so individual branch commits
  can be informal.
- One issue per PR; link it with `Closes #<n>`.
- Keep PRs small (guideline: < 400 changed lines excluding lockfiles and generated files).
- Fill in the PR template, including how it was tested (device + OS for mobile).
- Open a **draft PR** early for visibility; mark ready when CI passes.

## Reviews

- Every PR needs **1 approval from the other developer** and green CI.
- The author merges after approval.
- Review for: correctness, the privacy invariant (`docs/architecture.md` §6), tests, and
  whether an ADR or docs update is needed.
- PRs labeled `security` or changing `packages/shared` (the contract), `supabase/migrations/`
  or Realtime policies deserve an especially careful review.

## Working in parallel without conflicts

- **Workstreams** (see [roadmap](roadmap.md)): A = backend & web, B = mobile. Each developer
  mostly owns one, which keeps file overlap low.
- **Contract first:** changes to `packages/shared` go in their own small PR, merged before the
  code that uses them.
- **Migrations:** always create with `pnpm supabase migration new <name>` (timestamped). Never
  edit a migration that has been merged; add a new one. If both developers add migrations, the
  later PR rebases and runs `pnpm db:reset` to verify ordering.
- **Lockfile conflicts:** don't resolve by hand. Take `main`'s `pnpm-lock.yaml`, then run
  `pnpm install` and commit the result.
- **Keep branches fresh:** rebase on (or merge) `main` before requesting review.

## Issues and project management

- **Milestones:** `M1 – Ingestion core & vertical slice`, `M2 – Spectator web`,
  `M3 – Mobile tracking`, `M4 – Pilot event`, `M5 – Scale readiness` (M0 is complete). See
  [roadmap](roadmap.md).
- **Labels** (defined in `.github/labels.yml`, created with `node scripts/setup-github-labels.mjs`):
  - `type:` feature · bug · chore · docs · spike
  - `area:` mobile · web · backend · shared · infra
  - `priority:` P0 · P1 · P2
  - `security`, `blocked`, `future`
- **Templates:** Feature (user story + acceptance criteria), Bug, Spike (question, timebox,
  expected output). Blank issues are disabled.
- **Project board** ([Track](https://github.com/users/elsakifr/projects/1), GitHub Projects):
  `Todo → In Progress → In Review → Done`.
  - **Todo:** ready to start — the issue has acceptance criteria, labels and a milestone.
  - **In Progress:** someone is actively working on it (a branch exists).
  - **In Review:** a pull request is open and awaiting review.
  - **Done:** the pull request is merged or the issue is closed.
  - Board fields: Workstream (A / B / A+B), Size (S / M / L), Priority (P0 / P1 / P2).

## Releases and environments

- Web: `main` deploys to staging (configured in M2).
- Mobile: EAS channels `development`, `preview`, `production`
  (see `apps/mobile/eas.json`). Builds are triggered manually until M4 to save build quota.
- Tag releases as `vX.Y.Z` once we ship to real users (M4).

## One-time repository setup (manual, requires admin)

1. **Branch protection / ruleset on `main`:** require a PR, 1 approval, status check
   `Format, lint, typecheck, test, build`, linear history (squash), and dismiss stale approvals.
2. **Merge settings:** allow squash merge only; default commit message = PR title; auto-delete
   head branches.
3. **Labels:** `gh auth login`, then `node scripts/setup-github-labels.mjs`
   (`--dry-run` validates and prints the labels without changing GitHub).
4. **Milestones** M1–M5 and a **Project** board with the columns above.
5. **Secrets:** none needed for CI in M0. Supabase/EAS tokens are added when deployment jobs exist.
