# Known limitations and roadmap

This page separates current behavior from possible next steps. See
[user flows](./user-flows.md), [data flows](./data-flows.md), and
[testing](./testing.md) for implemented behavior and coverage.

## Current limits

| Area | Current implementation |
|---|---|
| Saved-area editing | Draft dots can be dragged and inserted. A full saved-area editor exists (Edit action in the sidebar, pre-seeded draw session, 409/404 conflict handling with reload-or-discard) — the History action opens version snapshots with editor, timestamp, name, size and shape preview. |
| Draft validation and recovery | Shared browser/API validation rejects degenerate, self-touching, crossing and overlapping rings. Invalid drafts stay editable; failed saves retain the draft and show an inline error for retry. |
| Preview traffic | Regular client updates are coalesced to 10/second, with immediate drag-end sends. A separate server limit defaults to 20/second per user; multiple tabs share it. Full point lists and global broadcasts remain; there is no delta protocol. Per-connection outbound backpressure exists (drop droppable preview types past a soft `bufferedAmount` threshold, disconnect past a hard one — see [data-flows.md](./data-flows.md#outbound-backpressure)), but broadcast fan-out itself isn't queued or load-shed at the source. |
| Offline behavior | One latest preview/cancellation is buffered in memory, cleared on token changes/unmount. REST saves are not queued. Visible saved areas are refetched on reconnect; inbound events are not replayed. A failed refresh preserves displayed areas and retries on the next move or ready transition. |
| Socket authentication | Access token checked on connection; close code 4001 refreshes through a coordinator shared with HTTP requests in the same tab. Failed refresh or repeated rejection returns to login. Existing sockets are not closed on token expiry or logout elsewhere. |
| Presence | Redis tracks individual connections with 45-second leases. Transport heartbeats and 15-second sweeps remove abandoned connections; a user leaves only after the final connection disappears. Presence snapshots repair missed notifications. |
| Broadcast scope | Area events reach all clients. Preview/cancel events exclude the originating connection using internal Redis metadata; other tabs still receive them. Viewport rooms remain absent. |
| Bounds reads | Map bounds reads are capped by `AREAS_QUERY_LIMIT` (default 1,000; local load testing uses 11,000). The independent Areas panel uses server-side name search, 100-row cursor pages and fixed-height virtualization (see [database.md](./database.md#benchmark-results-10000-rows) for why that's a real cost at scale, not just a theoretical one). Rounded cache keys can reuse a result with different edge coverage. `BoundsAreaLoader` discards a stale response via a generation counter, so a fast pan/reconnect no longer lets an older response overwrite newer data. |
| Durable writes | The area mutation and its history row are atomic (one Postgres transaction — see [database.md](./database.md#write-ordering-and-history-access)). Cache invalidation, audit, and publication still run as separate, non-transactional steps after commit; no outbox guarantees those complete. |
| Write conflicts | Version-checked updates/deletes reject stale writes with 409 (the actual safety net — never bypassed). The frontend closes the loop on that reject: it fetches the current version and offers reload-latest-or-discard, rather than a dead-end error. An advisory `area:editing:list` WS signal (not a lock) shows who else currently has an area open for editing, to cut down on collisions before they happen; see [data-flows.md](./data-flows.md#area-editing-presence). No automatic field/geometry merge. |
| Validation boundaries | Incoming WebSocket messages have strict runtime schemas and size limits. Shared geometry validation covers closure, range, uniqueness, non-zero area and edge intersections/overlaps. The editor limits drafts to 499 vertices (500 coordinates including closure). |
| Audit coverage | Application HTTP outcomes, domain/auth events, socket lifecycle/messages and meaningful authenticated UI actions are logged. Bounded database writes fall back to structured logs with a metric; durable queuing, replay, and retention remain separate work. See [audit coverage](./auditing.md). |
| Auth and authorization | Tokens live in localStorage. Login has no rate-limit guard, lockout, email verification, or password-reset flow. Any authenticated user can update/delete any area. |
| Theme | Auto uses local 06:00–19:00 hours, not location-based sunrise/sunset. |
| Test coverage | Controller tests mock Leaflet. The Playwright suite exercises browser authentication, drawing/validation, map switching, collaboration/conflicts, history, deletion, search/pagination, reconnect and narrow-screen controls against isolated services. Third-party imagery is stubbed, so provider availability/alignment is not established. |

The satellite factory uses `VITE_GOVMAP_TILE_URL` when configured, otherwise Esri
World Imagery (the live satellite layer). There is no second fallback if Esri
fails. A full investigation (see
[Govmap integration status](./govmap-integration.md)) concluded this isn't a
credential we're simply missing: govmap.gov.il's only public API is a
JavaScript SDK that embeds its own map widget, with no tile endpoint offered
to third parties at all — so even a registered API token wouldn't produce a
Leaflet-pluggable imagery source. A real tile host (`tiles.govmap.gov.il`) was
found and confirmed to exist, but is gated behind HTTP Basic Auth with no
public registration path. Closing this requires external access this
repository can't obtain on its own.

The backend runtime image retains development dependencies. The frontend runtime
is nginx serving compiled assets and does not include Node dependencies.
Turborepo environment forwarding is not declared for backend variables in
`turbo.json`; see the native-development workaround in [deployment](./deployment.md).

## Next steps

1. Extend browser coverage to additional engines, touch gestures, provider alignment and performance budgets.
2. Consider history comparison or explicit restoration; the viewer is read-only.
3. **Optional reliability improvement (deferred):** coordinate refresh-token rotation
   across browser tabs. The assignment requires authentication/session management,
   but does not explicitly require cross-tab refresh coordination. Prioritize
   verified assignment gaps before this enhancement.
4. Define authorization rules and authentication rate limits.
5. Publish cache invalidation/WebSocket notification through an outbox so they're
   not lost if the process crashes right after commit; address refresh-session
   concurrency and bounds cache precision.
6. Add viewport-scoped subscriptions and spatial tiling for map polygons; sidebar search and pagination are implemented.
7. Declare environment inputs/passthrough in Turborepo and prune backend runtime
   dependencies. Evaluate remote task caching after task inputs are complete.
8. Verify the intended satellite provider and optionally implement actual
   sunrise/sunset-based theme switching.

## Scaling direction

Redis pub/sub already distributes events between instances, so sockets can attach
to any instance without application-level sticky sessions. This does not provide
durable delivery. Presence uses expiring connection leases with periodic cleanup. Before claiming production scaling,
measure bounds-query latency, concurrent sockets, drawing volume, and cache behavior.

For higher durable-write volume, a queue and workers could accept area commands,
persist them, and publish results, with explicit acknowledgements and idempotency.
Transient previews do not touch Postgres and are already coalesced/throttled, with
per-connection backpressure dropping stale previews for a backlogged client (see
[data-flows.md](./data-flows.md#outbound-backpressure)); broadcast fan-out itself
is still unqueued pub/sub, so a future step could move it onto Redis Streams for
durability/replay if that becomes a requirement. A geometry CRDT could later
replace version-conflict rejection if simultaneous saved-area editing becomes a
product requirement.

The existing metrics include `http_request_duration_seconds`, `ws_backpressure_events_total`,
`ws_active_connections`, `ws_messages_total`, and `draw_actions_total`.
