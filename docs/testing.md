# Testing

Run commands from the repository root after `pnpm install`. The package `lint`
scripts run TypeScript checks; they are not ESLint rules or browser checks.

## Frontend

```bash
pnpm --filter @snapland/frontend test
pnpm --filter @snapland/frontend build
```

The current suite has 51 tests across eight files:

| File | Coverage |
|---|---|
| [DrawController.test.ts](../apps/frontend/src/map/DrawController.test.ts) | Drag updates, first-dot click no longer finishes, explicit completion, midpoint insertion including the closing edge, shifted vertex indexes, cancellation, immediate click placement and double-click not completing, minimum point count, zoom handler calls, invalid-draft recovery, vertex limits, whole-shape dragging, and destruction cleanup |
| [DrawPreviewSender.test.ts](../apps/frontend/src/ws/DrawPreviewSender.test.ts) | Fake-timer checks for 10/second coalescing, immediate final updates, cancellation, offline replacement, reconnect flushing, and reset cleanup |
| [refreshSession.test.ts](../apps/frontend/src/api/refreshSession.test.ts) | Shared HTTP/socket refresh, late rejections, logout/account replacement races, failed refresh, repeated socket rejection, recovery after readiness, and preserving login after an unrelated API error |
| [BoundsAreaLoader.test.ts](../apps/frontend/src/map/BoundsAreaLoader.test.ts) | Ready-transition refresh, current bounds, periodic presence updates, out-of-order responses, live mutations/deletions during a request, failure recovery, and teardown |
| [geoArea.test.ts](../apps/frontend/src/map/geoArea.test.ts) | Incomplete drafts and a plausible Turf area estimate |
| [AreaSearchLoader.test.ts](../apps/frontend/src/components/AreaSearchLoader.test.ts) | Cursor ordering, duplicate suppression, retry, aborts and stale response protection |
| [virtualRange.test.ts](../apps/frontend/src/components/virtualRange.test.ts) | Bounded row counts, partial rows and shrinking datasets |
| [daylight.test.ts](../apps/frontend/src/theme/daylight.test.ts) | Local-clock light/dark boundaries |

Authentication tests mock fetch and exercise the shared coordinator and socket recovery guard; they do not mount the React hook or open browser sockets.

Drawing tests mock Leaflet. They exercise controller events and
callbacks, not browser pointer dispatch, actual projection math, rendered dimensions,
Radix focus behavior, tile networking, or CSS stacking. A Playwright browser suite is configured under `apps/frontend/e2e`. A passing build includes TypeScript checking and Vite bundling.

## Backend unit tests

```bash
pnpm --filter @snapland/backend test
```

[geo.test.ts](../apps/backend/tests/geo.test.ts) covers polygon validation and WKT
conversion. [rateLimit.test.ts](../apps/backend/tests/rateLimit.test.ts) exercises
admission logic and failed Redis transactions against a fake Redis client.
[ws-validation.test.ts](../apps/backend/tests/ws-validation.test.ts) checks strict
message schemas, incomplete drafts, coordinate/bounds rules, and vertex limits.
[ws-gateway.test.ts](../apps/backend/tests/ws-gateway.test.ts) constructs the gateway
with fake services and sockets to cover rejection before side effects, Redis errors,
continued processing, setup/cleanup failures, connection accounting, socket
send failures, outbound backpressure (dropping droppable preview types past the
soft threshold, disconnecting past the hard one), and area-editing-presence
start/stop/disconnect broadcasts. It also checks the separate one-second preview
budget and prevents an older preview from publishing after cancellation. It does
not bootstrap a Nest testing module. It verifies origin-only exclusion across two
mocked gateways, same-user tabs, and durable-event delivery.
[pubsub.test.ts](../apps/backend/tests/pubsub.test.ts) checks internal routing
metadata round-trips separately from public messages and plain broadcasts remain supported.
Fake-clock gateway tests cover pong renewal, silent sockets, ping failures, Redis
failures/slow sweeps, disconnect during registration, initialization ordering, and
timer teardown.
[transaction.test.ts](../apps/backend/tests/transaction.test.ts) covers
`withTransaction`'s commit path, rollback-and-rethrow on failure, and that a
failing `ROLLBACK` still releases the connection without masking the original
error. [areas.repository.test.ts](../apps/backend/tests/areas.repository.test.ts)
drives `AreasRepository` against a mocked pg client to force a history-insert
failure mid-transaction for create/update/delete, asserting `ROLLBACK` (not
`COMMIT`) ran and the connection was released — plus that a version mismatch
commits an empty transaction without writing history.

These **136 unit tests** need no running services. 16 integration tests (across
areas, area-editing presence, and presence) are skipped unless
`RUN_INTEGRATION_TESTS=1`.

## Backend integration tests

```bash
make test-integration
```

This target starts Postgres/Redis, waits for readiness, migrates the database,
builds the workspace, then runs the backend suite with integration tests enabled.
It uses a live database and leaves test users/areas behind; use development storage.
The subprocess listens on port **4123**, independent of `BACKEND_PORT`.

To use an already configured database/Redis without Make:

```bash
# Export DATABASE_URL and REDIS_URL for the intended test services first.
pnpm --filter @snapland/shared build
pnpm --filter @snapland/backend migrate:up
pnpm --filter @snapland/backend build
RUN_INTEGRATION_TESTS=1 pnpm --filter @snapland/backend test
```

[areas.integration.test.ts](../apps/backend/tests/areas.integration.test.ts) spawns
`dist/main.js`, registers a user, and tests create/geodesic size, update and stale
version rejection, invalid geometry, bounds reads, and refresh-token rotation.
It also opens real WebSocket connections to verify coded validation errors,
continued processing and preview/cancel broadcasts after invalid input, and the
64 KiB transport limit (close code 1009). A separate test exhausts a preview budget
of two updates per second, confirms cancellation still works, and saves an area
with 49 of 50 REST requests still available. These socket checks exercise the compiled
Nest adapter with real Redis. Two connections for the same user verify that
preview/cancel events reach the other tab without echoing to the sender, and
area creation reaches both sockets. Another live socket test closes two tabs in
sequence and checks presence stays online until the final tab closes. They do not automate multiple backend processes,
browser interactions, deletion, or history; infrastructure failures are injected in the
unit tests instead of disrupting live Redis.

[presence.integration.test.ts](../apps/backend/tests/presence.integration.test.ts)
executes the real Redis Lua script using isolated keys and a private channel. It
checks deduplication, first-join/final-leave events, idempotent removal, lease renewal,
expiry cleanup, and concurrent old/new connections. Expiry is simulated by setting
lease scores in the past, without waiting 45 seconds or killing a backend process.

[area-editing.integration.test.ts](../apps/backend/tests/area-editing.integration.test.ts)
exercises `AreaEditingService` against real Redis with isolated keys: tracking a
lease through `list()`, a stop only clearing a lease it still owns, a newer start
taking over from a different connection, and `renew`/expiry using faked timers
against the service's 30-second app-level lease (not a Redis key TTL).

### Why the integration test spawns a subprocess instead of using `@nestjs/testing`

Vitest transforms TypeScript with esbuild, which does not emit the
`design:paramtypes` metadata needed by this app's Nest constructor injection.
`nest build` uses the TypeScript compiler and emits that metadata. The tests start
the compiled server and use HTTP instead of bootstrapping a Nest testing module
from Vitest-transformed source.

## Performance benchmarking

```bash
make dev-storage-up && make wait-for-storage   # or `make up` for the full stack
pnpm --filter @snapland/backend build
DATABASE_URL=... pnpm --filter @snapland/backend bench:seed       # seeds 10,000 polygons
DATABASE_URL=... pnpm --filter @snapland/backend bench:query      # DB-only, EXPLAIN ANALYZE + latency
BASE_URL=http://localhost:4000 pnpm --filter @snapland/backend bench:http  # concurrent HTTP load test
DATABASE_URL=... pnpm --filter @snapland/backend bench:cleanup    # removes only the seeded rows
```

These are standalone scripts in `apps/backend/scripts/`, not part of the test
suite — they seed/query/clean up directly via SQL and HTTP rather than
asserting anything, and are meant to be run manually. Results and methodology
are written up in [database.md](./database.md#benchmark-results-10000-rows).

## Whole workspace

```bash
pnpm test
make build && make lint && make test
```

Root commands use the repository's Turborepo tasks and cache; package-filtered
commands above invoke package scripts directly. Integration tests remain opt-in.
For native development environment forwarding, see [deployment](./deployment.md).

## Browser and collaboration suite

Start isolated test storage (separate ports, volumes and Redis instance from the app):

```bash
POSTGRES_PORT=55432 REDIS_PORT=56379 docker compose -p snapland-browser -f infra/docker-compose.yml up -d postgres redis
pnpm --filter @snapland/frontend exec playwright install chromium
pnpm --filter @snapland/frontend test:e2e
```

Playwright starts a compiled test backend on **4124** and Vite on **5174**, migrates
its dedicated database, and stops both app processes afterward. Storage containers
remain running; stop them with `docker compose -p snapland-browser -f infra/docker-compose.yml stop`.
Use `E2E_DATABASE_URL` / `E2E_REDIS_URL` to override test storage only. The suite
creates uniquely named test users/areas and retains them in that test database.
It never uses the normal app database or Redis instance by default.

Six Chromium scenarios cover:

- Browser registration, reload, logout and login.
- Invalid polygon recovery, basemap switching and whole-shape dragging.
- Two separate browser contexts: live previews, editing presence, concurrent-edit
  conflict/reload, version history and shape previews, history-load retry,
  cancelled deletion and confirmed deletion.
- Narrow-screen panel docking, search, close/reopen and drawing controls.
- Real server search and 100-row pagination with 105 fixture areas, bounded DOM
  row count while scrolling, and searching for an initially unloaded result.
- A real socket disconnect plus browser offline/reconnect, missed saved changes,
  and preservation of an active drawing.

HTTP, Postgres, Redis and WebSocket collaboration run for real. The history-retry
check temporarily returns a simulated 503, then retries against the real API.
Third-party raster tile images are replaced with a deterministic image; this verifies layer
switching and overlay preservation, **not provider availability or alignment**.
The suite runs Chromium at desktop and narrow viewport sizes, not touch emulation
or a cross-browser matrix. Failure screenshots and traces go to
`apps/frontend/test-results`; the HTML report is in `apps/frontend/playwright-report`.

Latest local verification: all six scenarios passed on 2026-10-04. See the generated
report for individual timings. Type checks and unit tests remain separate checks.

## Additional browser regression checklist

These are checks to perform, not claims that they have already passed in a browser.

| Scenario | Expected behavior |
|---|---|
| Log in/register; reload; log out | Map opens, stored session is used, logout returns to auth screen |
| Switch Map → Satellite → Map, then pan/zoom | Map container remains visible; selected tiles and saved overlays remain present |
| Draw three points, drag every point including the first | Outline, midpoint positions and area estimate update; clicking first dot does not finish |
| Click edge `+`, including closing edge; drag new and original dots | New vertex is inserted in edge order, existing vertices still move correctly |
| Finish via the checkmark button or Enter | Opens name dialog with at least three points; no completion with fewer points |
| Click and double-click map/handles | Points appear immediately; double-click does not finish or zoom the map |
| Cancel with Escape/button or leave map | Handles and draft disappear; drawing listeners are removed |
| Name and Save; try invalid/self-intersecting geometry | Valid area appears; invalid save shows an inline error in the dialog and keeps the draft for retry |
| Two users draw, finish, save, delete | Shared previews update, completion clears preview, area broadcasts update both views |
| User A opens an area via Edit while User B views the sidebar | B sees an "Editing: {A's name}" badge next to that area's size within one heartbeat tick (≤15s) or immediately if both are already connected |
| Edit an area, let another tab/user save a change to it first, then Save | Dialog shows the conflict message and a "Reload latest version" button instead of Save; reloading re-seeds the draft from the fresh version |
| Delete an area from the sidebar | Confirmation dialog appears; Cancel leaves it untouched, confirming Delete removes it for all clients |
| Continuous dragging and drag end | Local drawing stays immediate; regular network previews are at most 10/second, and final coordinates send immediately |
| Finish/cancel before the next scheduled preview | Cancellation sends and no delayed preview revives the draft |
| Disconnect/reconnect | Only the latest preview/cancel flushes after presence initialization; visible saved areas refetch automatically without clearing the current drawing or edit |
| Hover toolbar/sidebar/avatar controls with panel on either side | Shared tooltips have a 12px gap and appear above the panel |
| Open avatar menu, then click outside or press Escape | Focus returns without reopening status tooltip; theme options fill menu width |
| Auto/Light/Dark; hide and dock panel; reload | Preferences persist; auto follows the local-clock boundary |

Record results separately when running these checks. Unit tests and compilation
alone do not establish end-to-end or cross-browser correctness.

## Input validation and auditing checks

[input-validation.test.ts](../apps/backend/tests/input-validation.test.ts) runs the
real Nest validation pipe over malformed bounds, null/missing geometry, names,
versions, UUIDs, and client audit events. [audit.test.ts](../apps/backend/tests/audit.test.ts)
checks request outcomes, secret filtering, and fallback under failure/capacity.
The live API integration suite verifies their records in PostgreSQL.

Run the targeted tooltip/UI audit browser regression with local test infrastructure:

```bash
pnpm --filter @snapland/frontend test:e2e e2e/security.spec.ts
```

The test uses real Chromium, REST, WebSockets, and Postgres. External raster tiles
are blocked, and the bounds response is restricted to the persisted test fixture.
It checks both initial tooltip creation and live updates using HTML-like names,
then verifies theme/layer analytics requests. See [audit coverage](./auditing.md).
