## What and why

<!-- What does this PR change, and why? Link the issue it closes. -->

Closes #

## How was this tested?

<!-- Commands run, devices used (model + OS version for mobile), simulator scenarios. -->

## Screenshots / recordings

<!-- Required for UI changes. Delete if not applicable. -->

## Checklist

- [ ] PR title follows Conventional Commits, e.g. `feat(web): add runner search`
- [ ] `pnpm check` passes locally
- [ ] Tests added or updated for changed behavior
- [ ] Schema changes are in a new migration under `supabase/migrations/`, with RLS on every new table
- [ ] No private participant data can reach a public channel, table or endpoint (see `docs/architecture.md` §6)
- [ ] No secrets, keys or `.env` files committed
- [ ] Docs updated (`docs/`, README, CLAUDE.md), and an ADR added if this is an architectural decision
