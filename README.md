# Snapland — Collaborative GIS Map

A collaborative GIS application where multiple users draw and analyze polygon areas
on a map in real time, switching between an OpenStreetMap base layer and a satellite
imagery layer.

## Documentation

| Doc | Covers |
|---|---|
| [docs/architecture.md](./docs/architecture.md) | System and component diagrams, state ownership, rendering, technical decisions |
| [docs/user-flows.md](./docs/user-flows.md) | Sign-in, drawing and adjustment, Finish/Save, deletion, map and theme controls |
| [docs/data-flows.md](./docs/data-flows.md) | Auth, viewport reads, draft broadcasts, durable writes, deletion, reconnect sequences |
| [docs/api-reference.md](./docs/api-reference.md) | REST endpoints and WebSocket message reference |
| [docs/database.md](./docs/database.md) | Schema, indexing strategy, migrations |
| [docs/auditing.md](./docs/auditing.md) | User-action coverage, safe metadata, UI analytics, and delivery limitations |
| [docs/security.md](./docs/security.md) | Auth/session design, validation, rate limiting, audit trail |
| [docs/deployment.md](./docs/deployment.md) | Makefile/Docker usage, port configuration, environment variables |
| [docs/testing.md](./docs/testing.md) | Testing approach, how to run each kind, the Nest+Vitest gotcha |
| [docs/roadmap.md](./docs/roadmap.md) | Known limitations and future improvements/scaling strategy |
| [docs/govmap-integration.md](./docs/govmap-integration.md) | govmap.gov.il satellite imagery requirement: full investigation of their API, why no third-party tile access exists, and what external access would still be needed |

## Current functionality

- Register or log in; choose Map or Satellite and view shared areas and presence.
- Draw a draft, drag its dots, and click translucent edge `+` handles to insert points.
- Finish with the **Finish** button, or Enter after at least three
  points; enter a name and **Save**. Escape or Cancel abandons a drawing.
- Show, hide, or dock the Areas panel; edit or delete saved areas (version-checked,
  with a confirmation dialog on delete and conflict handling on a stale edit).
- Choose Auto, Light, or Dark from the avatar menu; hover tooltips render above panels.

Saved-area editing has a full editor (Edit action in the sidebar, pre-seeded draw
session, reload-or-discard on a version conflict); the History action shows saved versions with editor, time, name, size and shape previews. Draft editing is available before saving. REST is required for
saving; the latest buffered WebSocket preview is not an offline save mechanism.
Regular previews are coalesced to 10 updates/second, with immediate drag-end updates.
The server permits 20 previews/second independently of 50 durable writes/minute
per user; see the [rate-limit interpretation](./docs/security.md#rate-limiting).

The Areas panel supports debounced server-side name search, cursor pagination
(100 rows per page), and virtualized scrolling. Map geometry loading remains
separate and bounded by the viewport query limit.

Polygon validation is shared between the editor and API. Browser regression tests
run against isolated services with `pnpm --filter @snapland/frontend test:e2e`; see
[testing](./docs/testing.md) for setup and the scope of verification.

## Monorepo layout

Turborepo orchestrates task execution (build/lint/test) across the workspace in
dependency order with caching; pnpm workspaces handle package linking underneath it.

```
apps/
  backend/     NestJS API + WebSocket gateway (TypeScript)
  frontend/    React + Vite + Leaflet client (TypeScript)
packages/
  shared/      Types shared between backend and frontend (models, DTOs, WS protocol)
infra/
  docker-compose.yml   Postgres+PostGIS, Redis, backend, frontend
  postgres/init.sql    Extension bootstrap
apps/backend/migrations/  node-pg-migrate schema migrations
turbo.json               Task pipeline (build/dev/lint/test) and caching config
Makefile                 `make up` / `make dev` / `make test` / ... — see Quick start below
docs/                     Detailed docs — see the table above
```

## Quick start

A `Makefile` wraps both ways of running this. `make help` lists everything with a
one-line description. Full details, port configuration, and running without Docker
are in [docs/deployment.md](./docs/deployment.md).

**Fully containerized** (Postgres, Redis, backend, and frontend all in Docker):

```bash
make up      # builds images, starts everything, runs migrations automatically
make logs    # tail all container logs
make down    # stop (keeps data)
```

- Frontend: http://localhost:5173
- Backend: http://localhost:4000 (`/healthz`, `/readyz`, `/metrics`)
- API docs (Swagger UI): http://localhost:4000/docs

**Local dev** (backend + frontend run natively with hot reload; only Postgres and
Redis are containerized):

```bash
pnpm install # Node.js 20+ and pnpm 9.15.9
cp apps/backend/.env.example apps/backend/.env
# Starts storage, runs migrations, then launches both native apps.
TURBO_ENV_MODE=loose make dev
```

`make dev-down` stops just the Postgres/Redis containers when you're done. Every
host port (`POSTGRES_PORT`/`REDIS_PORT`/`BACKEND_PORT`/`FRONTEND_PORT`) is
overridable via `infra/.env`. Local development currently needs the environment
pass-through workaround shown above — see [docs/deployment.md](./docs/deployment.md#configuring-ports).

Other targets: `make build` / `make lint` / `make test` (Turborepo, no infra
needed), `make migrate` (DB migrations against the containerized Postgres), and
`make test-integration` (backend integration tests against real containerized
Postgres+Redis — see [docs/testing.md](./docs/testing.md)).

## Technical decisions, performance, security, and testing

These submission-guideline topics are covered in the docs table above rather than
duplicated here: architecture & decisions in
[docs/architecture.md](./docs/architecture.md) (includes performance-relevant
choices like spatial indexing and caching), security measures in
[docs/security.md](./docs/security.md), known limitations and future
improvements/scaling strategy in [docs/roadmap.md](./docs/roadmap.md), and the
testing approach in [docs/testing.md](./docs/testing.md).
