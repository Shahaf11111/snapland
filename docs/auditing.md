# User-action audit coverage

Audit records identify the authenticated actor (or `null` when authentication has
not succeeded), action, optional entity UUID, event UUID, occurrence time, and
bounded metadata. Records are stored in PostgreSQL `audit_log`. No new schema or
migration is required.

## Recorded actions

| Source | Events | Metadata |
|---|---|---|
| HTTP boundary | `http.request` for application requests, including reads, searches, history, auth, unknown routes, failures, and aborted requests | Server-generated request ID, matched route template, method, status/outcome, duration; entity UUID when supplied in a valid path |
| Domain services | `user.register`, `user.login`, `user.refresh`, `user.logout`, `area.create`, `area.update`, `area.delete` | Actor and entity; area size or version where applicable |
| Socket lifecycle | `ws.connect`, `ws.disconnect`, `ws.transport.error` | Connection UUID when authenticated; outcome or a bounded error category |
| Incoming collaboration messages | `ws.message` for previews, cancellations, viewport updates, and editing start/stop | Validated message type, outcome, byte count, preview point count; never coordinates |
| Authenticated browser UI | `ui.*` events through `POST /audit/events` | Fixed action/value vocabulary, optional area UUID/version; `source: client` |

HTTP records are emitted on response completion or premature close, exactly once.
Auditing is installed before JSON parsing, so malformed/oversized body rejections
are included. Successful login/register/refresh requests use the server-returned
user identity. Failed unauthenticated requests stay anonymous; the client cannot
choose an actor. The response includes `X-Request-Id` for correlation. Requests
rejected before Express receives them cannot be audited here.

GET health, readiness, and metrics probes are excluded as system polling.

Domain success records and HTTP outcome records serve different purposes; do not
sum them as if each were a distinct user operation. A UI-report submission also
produces its normal HTTP record. Response/body contents are never copied into
HTTP metadata.

Socket outcomes distinguish successful processing, invalid JSON/schema,
rate limiting, superseded previews, ignored viewport updates, and infrastructure
errors. Transport-size errors are recorded when the WebSocket transport reports
an error. Periodic ping/pong and outbound broadcast recipients are not separate
user actions.

The UI vocabulary is defined in
[ui-audit.ts](../packages/shared/src/ui-audit.ts). It covers theme/menu changes,
map layer/zoom/movement, panel open/close/docking, area focus/edit/history, history
shape inspection, drawing start/finish/cancel, draft discard, conflict reload,
and opening/dismissing delete confirmation. Search and save/delete attempts are
covered by their API records; transmitted vertex changes are covered by socket
records. Map movement includes programmatic focus/pan as well as direct navigation.
Individual keystrokes, pointer movements, tooltips, and each scroll frame are not
recorded. UI events are analytics supplied by a client, not authoritative evidence
that the user performed an operation. Guest-only preferences are not sent because
there is no authenticated actor.

## Data minimization and validation

Passwords, JWTs, authorization headers, raw URLs/query strings, request bodies,
polygon coordinates, search text, and area/user names are excluded from metadata.
The audit service uses an allowlist of scalar metadata keys and truncates string
values to 256 characters. Invalid socket payloads never supply event names or
metric labels. UI bodies reject unknown fields, unsupported actions/values,
invalid entity IDs, and invalid versions. They cannot submit `userId`, arbitrary
metadata, or server domain actions such as `area.delete`.

## Delivery and failures

Domain/UI calls await their audit attempt; HTTP completion and socket logging run
asynchronously so collaboration is not delayed. A process permits at most eight
concurrent audit database writes. On capacity exhaustion or database failure the
sanitized record, with its event UUID/time, goes to a structured `audit.fallback`
server log. `audit_fallback_events_total{reason="capacity|database_error"}` counts
these records. Configure external log collection to retain that fallback trail.
Database exception details and raw payloads are not included in fallback entries.

There is no unbounded in-memory audit queue, retry worker, or transactional outbox.
The application does not fail a user operation because audit storage failed.
A process crash can lose outstanding records; structured logs require external
retention and are not replayed into PostgreSQL automatically. Client UI reporting
is best-effort: delivery failures are reported in the console, with no offline
queue or replay. It does not capture actions after a browser crash or tab close
unless their requests reached the server. These are explicit delivery limitations,
not a claim of exactly-once or compliance-grade auditing.

Audit volume now includes previews and requests. Retention, archival, and durable
queuing remain separate work. No retention policy is silently introduced here.

## Verification

- [audit.test.ts](../apps/backend/tests/audit.test.ts): bounded writes, structured
  fallback, metadata filtering, HTTP outcomes, actor attribution, and aborts.
- [ws-gateway.test.ts](../apps/backend/tests/ws-gateway.test.ts): message/lifecycle
  coverage and safe handling of rejected/failed messages.
- [areas.integration.test.ts](../apps/backend/tests/areas.integration.test.ts):
  real HTTP/WebSocket actions and their persisted PostgreSQL records, including
  malformed JSON and authenticated UI events.
- [security.spec.ts](../apps/frontend/e2e/security.spec.ts): Chromium verifies
  literal tooltip text after create/update and browser UI event submission.

## Inspect recent records

Use an authorized database connection; audit data is not exposed through a public
read endpoint:

```sql
SELECT created_at, user_id, action, entity_id,
       metadata->>'outcome' AS outcome,
       metadata->>'requestId' AS request_id,
       metadata->>'eventId' AS event_id
FROM audit_log
ORDER BY created_at DESC
LIMIT 50;
```

For structured-log fallback, filter the server logs for `audit.fallback` and monitor
`audit_fallback_events_total`. Log collection is deployment configuration, not an
implicit guarantee provided by the application.
