# ADR-0001: Monorepo with pnpm workspaces and Turborepo

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Track has a mobile app, a web app, a Supabase backend and shared domain logic (the position-event
contract, the offline queue). Two developers work in parallel. The contract must stay identical
across all clients and the backend.

## Decision

A single repository using **pnpm workspaces** (`apps/*`, `packages/*`, `tools/*`) and
**Turborepo** for task orchestration and caching. Internal packages are consumed as TypeScript
source (no build step). `node-linker=hoisted` is used because React Native / Metro resolve most
reliably with a flat `node_modules`. React versions are pinned workspace-wide to the version
required by the current Expo SDK.

## Alternatives considered

- **Polyrepo** — contract changes would need coordinated releases across repos; too slow for two people.
- **Nx** — more powerful, but more configuration and concepts than we need.
- **npm/yarn workspaces** — workable; pnpm is faster, stricter and well supported by Expo.

## Consequences

- One PR can change the contract and its consumers atomically.
- Expo SDK upgrades also bump React for the web app (enforced by `overrides` in `pnpm-workspace.yaml`).
- Turborepo remote caching is not configured (free; can be added later).
