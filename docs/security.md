# Security

## Authentication & sessions

- Passwords are hashed with **bcrypt** (cost 10); never stored or logged in plaintext.
- **Access tokens**: JWT, 15 minutes (`JWT_ACCESS_TTL_SECONDS`), signed with
  `JWT_ACCESS_SECRET`. Verified per-request via Passport's `passport-jwt` strategy
  (`apps/backend/src/auth/jwt.strategy.ts`) and `JwtAuthGuard`.
- **Refresh tokens**: JWT, 30 days by default (`JWT_REFRESH_TTL_SECONDS`), signed with
  a *different* secret (`JWT_REFRESH_SECRET`). Only a bcrypt hash of the refresh
  token is stored server-side (in `sessions.refresh_token_hash`) — a leaked database
  dump alone doesn't yield usable tokens.
- **Rotation**: every `POST /auth/refresh` call revokes the old session and issues a
  brand-new access+refresh pair. Reusing a rotated-out refresh token is rejected with
  `401` (covered by an integration test).
- **Session id / JWT consistency**: the session's `id` is generated in application
  code (`crypto.randomUUID()`) and embedded in the refresh JWT *before* the session
  row is inserted with that same id — avoiding a class of bug where a DB-generated id
  and a pre-signed JWT's embedded id could drift apart.
- **Logout**: revokes the session server-side (`sessions.revoked_at`), so the refresh
  token can't be used again even though the JWT itself hasn't expired yet.
- **WebSocket auth**: the `/ws` upgrade requires a valid access token as a `?token=`
  query parameter; connections without one are closed immediately with code `4001`.
  Existing sockets are not revalidated on expiry or session revocation.
- **Browser storage**: user details and both tokens are persisted in localStorage,
  not HttpOnly cookies. Logout clears the local session even if server revocation
  fails; issued access tokens remain valid until expiry.

## Input validation

- For REST, a global `ValidationPipe` (`whitelist: true, forbidNonWhitelisted: true`) runs every
  request body/query through `class-validator` DTOs — unknown fields are rejected,
  not silently dropped or accepted.
- Polygon geometry gets a second, domain-specific validation pass in the service
  layer (shared implementation in `packages/shared/src/polygon-validation.ts`), independent of DTO shape
  checks: coordinate ranges (`-180..180`, `-90..90`), ring closure, minimum 3 distinct
  vertices, no duplicate vertices, and an O(n²) self-intersection check (acceptable
  since rings are limited to 500 points including closure). Validation rejects
  non-zero-length overlapping edges, nonadjacent touching, backtracking and
  zero-area rings. The browser uses the same validator before Finish and limits
  vertex insertion to 499, keeping invalid drafts open for correction.
- WebSocket messages use strict Zod schemas independently of the REST DTO pipe:
  supported types only, exact coordinate pairs with finite values and geographic
  bounds, 0–499 draft vertices, empty cancellation payloads, and ordered viewport
  bounds. Extra envelope/payload fields are rejected before metrics or Redis.
- WebSocket transport limits messages to 64 KiB and closes oversized messages with
  code 1009. Preview validation permits unfinished shapes; topology is validated
  when saving through REST.
- Rejected geometry surfaces the *specific* reason (e.g. `"polygon is
  self-intersecting"`) rather than a generic validation failure, since deep geometric
  rules aren't expressible as declarative DTO decorators.

REST bounds require exactly four finite coordinates within longitude/latitude
ranges and ordered west/south/east/north values. Blank components, invalid numbers,
extra coordinates and wrapped bounds return 400. Area IDs must be PostgreSQL UUIDs
before database access. Names are trimmed and cannot be empty or contain NUL;
missing create geometry and explicit null update fields are rejected.

Saved-area tooltip names are assigned through DOM `textContent`, including updates.
This avoids interpreting stored names as HTML in Leaflet; names can legitimately
contain angle brackets and ampersands. React renders names in other views as text.

## Rate limiting

The assignment's **50 drawing actions per minute per user** is interpreted as
requests to create, update, or delete saved areas. Transient preview packets are
not counted as durable actions; they have their own abuse limit.

| Traffic | Default limit | Configuration | Redis key |
|---|---|---|---|
| `POST/PUT/DELETE /areas` | 50 per user per rolling minute | `RATE_LIMIT_MAX_PER_MINUTE` | `ratelimit:draw:<userId>` |
| `draw:progress` | 20 per user per rolling second | `WS_PREVIEW_MAX_PER_SECOND` | `ratelimit:preview:<userId>` |
| `draw:cancel` | Exempt from these two budgets | — | — |

Both budgets use the Redis sliding-window utility and are shared across backend
instances and connections belonging to the same user. Both configuration values
must be positive integers. Admitted REST write attempts consume the durable
budget even if later validation or processing fails. Exceeding the preview limit
does not consume the REST budget or prevent cancellation.

The browser coalesces regular previews to at most one every 100ms. Drag-end updates
send immediately and may exceed that client cadence, but still count toward the
server's preview limit. Local geometry and area estimates update immediately on
every edit. Cancellation bypasses preview throttling and discards unsent drafts.
The server also drops previews superseded by a newer edit or cancellation while
waiting for the limiter. Cancellation is not currently rate-limited separately.

The REST guard fails open if Redis is unavailable. WebSocket limiter failures
return `internal_error` without deliberately bypassing the limit. Redis transaction
command errors are propagated rather than treated as zero counts. Auth endpoints
do not use these drawing guards.

## Audit trail

Application HTTP requests, domain writes/authentication, incoming collaboration
messages, socket lifecycle, and meaningful authenticated UI actions are recorded.
Rejected requests and messages are included. Metadata excludes credentials,
raw payloads, names, search text, and geometry. Database errors or audit capacity
exhaustion emit sanitized structured fallback records and increment a metric.
See [audit coverage and delivery limits](./auditing.md) for the exact event catalog,
actor attribution, exclusions, and failure behavior.

## Transport & request hygiene

- **CORS** uses the comma-separated origin list in `CORS_ORIGIN`.
- **Request timeout** middleware installs a 10s response/socket timeout and attempts
  a `503` response. It does not cancel in-flight database or application work.
- Domain errors (validation, conflict, not-found) are thrown as Nest's built-in
  `HttpException` subclasses with a structured `{error, message}` body; anything
  unexpected falls through to Nest's default handler as a generic `500` (no internal
  error details leaked to the client).

## WebSocket failure containment

The gateway catches asynchronous limiter/publication errors, returns generic
coded errors, and logs operation context server-side. Connection-setup failures
close with 1011 and attempt cleanup. Disconnect cleanup removes the connection and publishes a leave only for the
final connection, in one Redis Lua script. Failed cleanup is logged and its lease
expires; another healthy instance can perform cleanup. Socket send errors are caught
or handled through callbacks so one failed recipient does not stop the broadcast.
Invalid requests do not add arbitrary message-type metric labels. These controls
do not add durable event delivery or replay. Presence separately uses 45-second
leases, transport ping/pong, and periodic snapshots for recovery. See [error responses](./api-reference.md#error-responses-and-connection-behavior).

## Known gaps / not implemented

See [roadmap.md](./roadmap.md) for the full list — most relevant here:

- No brute-force/lockout protection or rate-limit guard on `/auth/login`.
- All authenticated users can update/delete any area; creator-only or role-based
  authorization is not implemented.
- No email verification or password-reset flow (out of scope for the assignment).
- Presence expiry depends on Redis availability and a running backend sweep.
  During an outage the displayed user list can be stale; it converges after recovery.
