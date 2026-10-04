# API Reference

All request/response bodies are JSON. Authenticated endpoints require
`Authorization: Bearer <accessToken>`. Types referenced below (`Area`, `PublicUser`,
`AreaGeometry`, etc.) are defined in `packages/shared/src`.

An interactive OpenAPI (Swagger) UI for the REST endpoints below is served at
`/docs` by the running backend (e.g. http://localhost:4000/docs), with the raw
spec at `/docs-json`. DTO schemas there are inferred at build time from the
`class-validator`/TypeScript definitions in `apps/backend/src/**/dto` via the
`@nestjs/swagger` CLI plugin (`apps/backend/nest-cli.json`), so they stay in
sync with the DTOs without duplicated annotations. The WebSocket gateway isn't
representable in OpenAPI and stays documented below and in
[data-flows.md](./data-flows.md).

## REST

### Auth — `apps/backend/src/auth/`

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/auth/register` | – | `{ email, password, name }` | `201` `{ user, accessToken, refreshToken, expiresIn }` |
| POST | `/auth/login` | – | `{ email, password }` | `201` `{ user, accessToken, refreshToken, expiresIn }` |
| POST | `/auth/refresh` | – | `{ refreshToken }` | `201` `{ user, accessToken, refreshToken, expiresIn }` (rotates the session; the old refresh token is invalidated) |
| POST | `/auth/logout` | ✓ | `{ refreshToken }` | `204` |
| GET | `/auth/me` | ✓ | – | `{ user }` |

`password` must be at least 8 characters. Login returns `401` on bad credentials;
registration returns `409` on duplicate email. Invalid DTOs return `400`. See [security.md](./security.md) for the
token/session design.

### UI audit events

Authenticated `POST /audit/events` accepts a fixed `action`, optional enum `value`,
optional `areaId` UUID, and optional positive integer `version`. It returns 204.
For example: `{ "action": "ui.theme.change", "value": "dark" }`.
The server assigns the actor and marks the entry client-reported. Unknown fields
(including `userId`), arbitrary actions, and invalid values return 400.
See the [event vocabulary and delivery limits](./auditing.md).
Application HTTP responses include a server-generated `X-Request-Id` recorded in
request audit metadata; request bodies and credentials are not stored.

### Areas — `apps/backend/src/areas/`

All endpoints require auth. Mutating endpoints (`POST`/`PUT`/`DELETE`) are also
rate-limited — see [security.md](./security.md).

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/areas?bbox=minLng,minLat,maxLng,maxLat` | — | `{ areas: Area[] }` — newest nondeleted rows, capped by `AREAS_QUERY_LIMIT` (default 1,000); bounds-cached for 30s |
| GET | `/areas/search?search=name&limit=100&cursor=uuid` | — | `{ areas: Area[], total: number, nextCursor: string \| null }` — case-insensitive literal name substring search across all nondeleted areas; UUID ascending cursor order; limit 1–200 (default 100). Omit cursor for the first page. |
| GET | `/areas/:id` | — | `{ area: Area }` or `404` |
| GET | `/areas/:id/history` | — | `{ history: AreaHistoryEntry[] }` (versions in ascending order) |
| POST | `/areas` | `{ name, geometry }` | `201` `{ area }` |
| PUT | `/areas/:id` | `{ name?, geometry?, version }` | `{ area }`, or `409` if `version` doesn't match the current row |
| DELETE | `/areas/:id?version=N` | — | `204`, or `409` on version mismatch (soft delete) |

REST `bbox` requires exactly four finite decimal coordinates, with
`-180 <= west <= east <= 180` and `-90 <= south <= north <= 90`.
Malformed bounds or area UUIDs return 400. Area names are trimmed, nonempty, at
most 200 characters, and may not contain NUL. Names are rendered as text, not HTML.

`geometry` is a GeoJSON `Polygon` with a single (no-hole) closed ring:

```json
{
  "type": "Polygon",
  "coordinates": [[[34.78, 32.08], [34.79, 32.08], [34.79, 32.09], [34.78, 32.09], [34.78, 32.08]]]
}
```

Rejected with `400` if: fewer than 3 distinct vertices, the ring isn't closed,
coordinates are out of range, vertices are duplicated, or the ring self-intersects
(`apps/backend/src/common/utils/geo.util.ts`). Only one ring is accepted, with
4–500 coordinate pairs including the repeated closing point; pairs must be finite
numbers. Shared browser/API validation also rejects zero-area rings, backtracking,
nonadjacent touching, and collinear overlapping edges. Collinear subdivisions
along an otherwise valid boundary remain allowed.

`Area` shape (response):

```ts
{
  id: string; name: string; geometry: AreaGeometry; sizeKm2: number;
  version: number; createdBy: string; createdAt: string; updatedAt: string;
  deletedAt: string | null;
}
```

The browser supports creating, editing, deleting and viewing saved-area history.
History entries include `name`, `editorName`, `editedBy`, `editedAt`, `version`,
`changeType`, `sizeKm2` and the geometry snapshot. Any authenticated
user can operate on any area; there is no creator-only authorization check. After
soft deletion, area lookup returns `404`; the history endpoint remains available
with the retained creation/update/deletion snapshots. REST write limits return `429` with `X-RateLimit-Limit` and
`X-RateLimit-Remaining` headers.

### Health & Ops — `apps/backend/src/health/`

| Method | Path | Response |
|---|---|---|
| GET | `/healthz` | `{ status: "ok" }` — liveness only |
| GET | `/readyz` | `{ status, db, redis }` — `503` if either dependency is down |
| GET | `/metrics` | Prometheus text format |

## WebSocket protocol

Connect to `wss://<host>/ws?token=<JWT access token>`. Connections without a valid
token are closed immediately (code `4001`). Message envelope is `{ type, payload }`
(defined in `packages/shared/src/ws-protocol.ts`) — **not** Nest's default
`{event, data}` `@SubscribeMessage` convention; the gateway parses this by hand (see
[architecture.md](./architecture.md)).

### Client → server

| `type` | `payload` | Notes |
|---|---|---|
| `draw:progress` | `{ points: [lng, lat][] }` | 0–499 draft vertices; separate per-user preview limit, default 20/second. |
| `draw:cancel` | `{}` | Clear preview after cancellation or finishing, before naming/saving. |
| `viewport:update` | `{ bbox: [minLng, minLat, maxLng, maxLat] }` | Reserved for future viewport-scoped fan-out; currently a no-op server-side. |
| `area:editing:start` | `{ areaId: string }` | Sent when a user opens a saved area in the editor. Advisory only — see [data-flows.md](./data-flows.md#area-editing-presence). |
| `area:editing:stop` | `{ areaId: string }` | Sent on cancel, save, or discard. |

### Server → client

| `type` | `payload` | When |
|---|---|---|
| `presence:list` | `{ users: PresenceUser[] }` | Sent on connect and every 15 seconds after successful presence cleanup. |
| `presence:join` | `{ user: PresenceUser }` | The first active connection for a user joined; connecting clients receive an initial list. |
| `presence:leave` | `{ userId: string }` | The last active connection for a user disconnected or expired. |
| `draw:progress` | `{ userId: string, points: [lng, lat][] }` | Relayed to every connection except the originating socket; other tabs for the same user receive it. |
| `draw:cancel` | `{ userId: string }` | Clears the preview on other connections; the originating socket clears its local drawing directly. |
| `area:created` / `area:updated` | `{ area: Area }` | After a successful `POST`/`PUT /areas` (by any user, any instance). |
| `area:deleted` | `{ areaId: string }` | After a successful `DELETE /areas/:id`. |
| `area:editing:list` | `{ editing: Record<string, PresenceUser> }` | Full snapshot of who's editing which area (by `areaId`). Resent on every start/stop and on each 15-second heartbeat tick. |
| `error` | `{ code?: WebSocketErrorCode, message: string }` | Validation, authentication, rate-limit, or internal processing failure. The gateway supplies `code`; the shared type keeps it optional for compatibility. |

`PresenceUser` is `{ userId, name, color }` — `color` is a deterministic hash of the
user id, so the same user always gets the same color across sessions.

### Runtime validation

The gateway validates messages with Zod before counting message-type metrics,
checking the drawing limit, or publishing. The source of truth is
[client-message.schema.ts](../apps/backend/src/websocket/client-message.schema.ts).

- Both the envelope and payload are strict objects: unknown fields are rejected.
  A client cannot supply its own `userId`; the server takes identity from the token.
- `draw:progress.points` is an array of 0–499 coordinate pairs. Each pair contains
  exactly two finite numbers: longitude in `[-180, 180]`, latitude in `[-90, 90]`.
  Empty, one-point, and two-point previews are valid. The draft need not be closed
  or geometrically valid yet; saved polygons still use REST geometry validation.
- The 499-vertex limit leaves space for the repeated closing coordinate within
  REST's 500-point ring limit. The frontend does not yet prevent exceeding this
  limit locally; rejected preview messages currently appear in the console.
- `draw:cancel.payload` must be an empty object.
- `viewport:update.bbox` must contain four finite, in-range numbers with
  `minLng <= maxLng` and `minLat <= maxLat`. Wrapped antimeridian bounds are not
  supported. A valid viewport message remains a no-op, without an acknowledgement.
- WebSocket messages are limited to **64 KiB** at the transport boundary, including
  fragmented messages. An oversized message closes the socket with **1009** rather
  than returning a JSON error.

### Preview cadence and separate budgets

The browser sends regular `draw:progress` updates at most once every 100ms, retaining
only the latest points between sends. Drag end sends its final coordinates
immediately. These final updates may occur within that 100ms interval and remain
subject to the server limit.

The gateway limits previews to **20 per rolling second per user**, configured by
`WS_PREVIEW_MAX_PER_SECOND`. This is independent of the **50 per rolling minute**
REST create/update/delete allowance (`RATE_LIMIT_MAX_PER_MINUTE`). This is the
project's interpretation of the assignment's drawing-action budget: saved-area
mutations are actions; ephemeral previews are transport updates. Both limits use
separate Redis keys, shared across connections and backend instances.

An exhausted preview budget returns `rate_limited` with a message such as
`Rate limit exceeded: max 20 preview updates/sec`. `draw:cancel` does not consume
these budgets, so finishing/cancelling can still remove a preview. It also
supersedes older previews still waiting on the limiter.

While disconnected or awaiting `presence:list`, the frontend holds only the latest
preview or cancellation. Reconnect sends that single state after server setup,
not a backlog of every movement. Finishing/cancelling removes any pending preview
timer; unmount or an access-token change clears pending state entirely. REST
writes are not queued, and there is still no replay of missed inbound events.

### Error responses and connection behavior

```json
{
  "type": "error",
  "payload": {
    "code": "invalid_message",
    "message": "Invalid WebSocket message: expected a supported type and valid payload"
  }
}
```

| Code | Trigger | Connection behavior |
|---|---|---|
| `invalid_json` | Cannot parse JSON | Reject message; keep connection open |
| `invalid_message` | Unsupported type, missing/extra fields, invalid coordinates, bounds, or point count | Reject before metrics/Redis; keep connection open |
| `rate_limited` | Preview budget exhausted | Do not broadcast; keep connection open |
| `internal_error` | Limiter or publication operation fails | Do not acknowledge success; send a generic error and keep connection open |
| `internal_error` | Presence/connection initialization fails | Send a generic error when possible, close with **1011**, and attempt cleanup |
| `unauthorized` | Missing/invalid access token | Send an error when possible and close with **4001** |

Async failures are logged server-side with the operation and, for incoming
messages, the validated message type and authenticated user ID. Client responses
do not include infrastructure exception details. Raw payloads and access tokens
are not explicitly logged by the gateway.

Disconnect cleanup atomically removes a connection and publishes a leave only when
no connections remain for that user. Connection accounting is
idempotent; rejected authentication does not decrement the active-connection gauge.
Socket send failures are logged without stopping delivery to other clients.
Failed cleanup is recovered through 45-second connection leases and 15-second
sweeps once Redis and a backend are available. Periodic presence lists repair
missed presence events. Other publication errors have no delivery guarantee or replay.

Broadcasts still have no viewport filtering, replay, or acknowledgement protocol.
The frontend logs `error` messages to the console. See [data flows](./data-flows.md)
for consumers and reconnect behavior.
