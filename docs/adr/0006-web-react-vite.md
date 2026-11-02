# ADR-0006: Spectator web app with React and Vite

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

The spectator app is a client-side, real-time map application. Early development should cost
nothing to host. SEO for race pages is not an MVP requirement.

## Decision

Build `apps/web` as a **React single-page app with Vite**, deployed as static files to a free
host. Maps use **MapLibre GL** with a free tile source.

## Alternatives considered

- **Next.js** — SSR/SEO and server routes are not needed yet; adds a server runtime to host and reason about.
- **Google Maps / Mapbox** — usage-based pricing; MapLibre is open source.

## Consequences

- Hosting is free and simple. If SEO-friendly race pages become important, we can add
  prerendering or revisit this decision.
