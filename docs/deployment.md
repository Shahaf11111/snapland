# Deployment & Running Locally

A `Makefile` wraps two ways of running the app; `make help` lists every target with
a one-line description. Native commands require Node.js 20+ and pnpm 9.15.9;
run `pnpm install` first. Docker workflows require Docker Compose.

## Fully containerized

Postgres, Redis, backend, and frontend all run in Docker.

```bash
make up      # builds images, starts everything, runs migrations automatically
make logs    # tail all container logs
make ps      # container status
make down    # stop (keeps data)
```

- Frontend: http://localhost:5173
- Backend: http://localhost:4000 (`/healthz`, `/readyz`, `/metrics`)
- API docs (Swagger UI): http://localhost:4000/docs

`infra/docker-compose.yml` defines four services: `postgres` (postgis/postgis image,
with `infra/postgres/init.sql` bootstrapping extensions), `redis`, `backend` (runs
migrations then starts the compiled Nest app), and `frontend` (static Vite build
served by nginx). The backend and frontend `Dockerfile`s (`apps/backend/Dockerfile`,
`apps/frontend/Dockerfile`) are multi-stage: a `deps` stage installs dependencies
(including building `packages/shared`, which the root `postinstall` hook needs — its
full source, not just `package.json`, is copied before `pnpm install` for exactly
that reason), a `build` stage compiles the app, and a slim `runtime` stage ships
the runtime files. The backend currently retains full dependencies; the frontend
runtime contains nginx and static assets only.

## Local dev (native apps, containerized storage)

Backend and frontend run natively with hot reload; only Postgres and Redis are
containerized.

```bash
cp apps/backend/.env.example apps/backend/.env
# Starts storage, runs migrations, then launches both native apps.
TURBO_ENV_MODE=loose make dev
make dev-down  # stop just the Postgres/Redis containers
```

`make dev` sets `PORT`, `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGIN`,
`FRONTEND_PORT`, `VITE_API_URL`, and `VITE_WS_URL` before invoking `pnpm dev`.
However, the current `turbo.json` does not declare backend environment inputs or
passthrough variables. The installed Turbo defaults to strict environment filtering;
Vite's `VITE_*` variables are inferred, but backend variables and `FRONTEND_PORT`
are not automatically covered. `TURBO_ENV_MODE=loose make dev` forwards the provided
values for native development. The long-term fix is explicit task environment
configuration, not relying on loose mode for cached builds.

Nest and Vite still read their workspace `.env` files; forwarded process variables
take precedence. Copy the backend example for JWT secrets and any settings that
Make does not supply. Environment validation requires database/Redis URLs and two
JWT secrets of at least 16 characters. Direct package commands bypass Turbo:

```bash
pnpm --filter @snapland/backend dev
pnpm --filter @snapland/frontend dev  # separate terminal
```

## Configuring ports

Every host-facing port is overridable via `infra/.env` (copy from
`infra/.env.example`):

```bash
POSTGRES_PORT=5432
REDIS_PORT=6379
BACKEND_PORT=4000
FRONTEND_PORT=5173
```

Both `docker compose` and the `Makefile` read this same file (the Makefile
`include`s it directly), so both workflows resolve the same port settings. Native
apps need the environment-forwarding workaround above for overrides to reach their
processes. Only the **host-side** mapping changes — containers talk to each other
over their fixed internal ports (5432/6379/4000/80), so nothing internal needs to
know about the override.

Override ports if another service already binds a default port. Update database
clients to use the selected host port.

```bash
cp infra/.env.example infra/.env
# edit infra/.env, e.g. POSTGRES_PORT=5555
make up   # or: TURBO_ENV_MODE=loose make dev
```

## Other Makefile targets

| Target | What it does |
|---|---|
| `make build` / `make lint` / `make test` | Turborepo tasks across the whole workspace — no infra required |
| `make migrate` | Runs DB migrations against the containerized Postgres (starts it first if needed) |
| `make test-integration` | Builds the backend, then runs its integration test suite against real containerized Postgres+Redis — see [testing.md](./testing.md) |
| `make clean` | Removes `dist/` build outputs and Turborepo caches |
| `make down-volumes` | **Destructive** — stops the full stack and deletes the Postgres data volume |

## Running without Docker or the Makefile at all

If you already have your own PostgreSQL+PostGIS and Redis running:

```bash
pnpm install                      # also builds packages/shared (postinstall)

cp apps/backend/.env.example apps/backend/.env
# edit apps/backend/.env: DATABASE_URL / REDIS_URL for your own Postgres/Redis

pnpm --filter @snapland/backend migrate:up

pnpm --filter @snapland/backend dev   # default http://localhost:4000
pnpm --filter @snapland/frontend dev  # default http://localhost:5173, separate terminal
# Or run both through Turbo with environment forwarding:
TURBO_ENV_MODE=loose pnpm dev
```

`apps/frontend/.env.example` documents `VITE_API_URL` / `VITE_WS_URL`, plus an
optional `VITE_GOVMAP_TILE_URL` for the satellite layer — see
[Govmap integration status](./govmap-integration.md) for the missing provider
verification and setup requirements.

## Environment variables reference

### `infra/.env` (docker-compose + Makefile)

| Variable | Default | Purpose |
|---|---|---|
| `POSTGRES_PORT` | `5432` | Host port → container's 5432 |
| `REDIS_PORT` | `6379` | Host port → container's 6379 |
| `BACKEND_PORT` | `4000` | Host port → container's 4000; also baked into the frontend's build-time `VITE_API_URL`/`VITE_WS_URL` |
| `FRONTEND_PORT` | `5173` | Host port → container's 80; also used for the backend's `CORS_ORIGIN` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | dev placeholders | **Set real values for anything beyond local testing** |
| `RATE_LIMIT_MAX_PER_MINUTE` | `50` | Per-user durable area write requests per rolling minute |
| `WS_PREVIEW_MAX_PER_SECOND` | `20` | Separate per-user preview updates per rolling second |

### `apps/backend/.env` (native backend settings)

See `apps/backend/.env.example` — `DATABASE_URL`, `REDIS_URL`, `PORT`,
`JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL_SECONDS`/
`JWT_REFRESH_TTL_SECONDS`, `CORS_ORIGIN`, `RATE_LIMIT_MAX_PER_MINUTE`,
`WS_PREVIEW_MAX_PER_SECOND`. Both rate-limit settings must be positive integers;
restart the backend after changing them. Compose passes both settings through.
The browser preview interval is 100ms in `ws/DrawPreviewSender.ts`, with immediate
drag-end updates. See [rate limiting](./security.md#rate-limiting) for budget semantics.

### `apps/frontend/.env` (native frontend settings)

See `apps/frontend/.env.example` — `VITE_API_URL`, `VITE_WS_URL`, optional
`VITE_GOVMAP_TILE_URL`.

`CORS_ORIGIN` accepts a comma-separated list. `FRONTEND_PORT` is read from the
process environment by `vite.config.ts` (default 5173, strict port binding); export
it or use Make when overriding the native dev-server port.

Frontend API/WebSocket URLs are build-time Vite settings, not runtime nginx
settings. Rebuild the frontend image after changing them. Compose currently passes
only `VITE_API_URL` and `VITE_WS_URL` as build arguments; it does not expose a
`VITE_GOVMAP_TILE_URL` build argument. The supplied deployment targets localhost
HTTP/WS; external hosting needs browser-reachable URLs and a TLS/reverse-proxy setup.
