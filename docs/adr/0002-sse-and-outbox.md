# ADR-0002: Server-Sent Events + transactional outbox instead of Socket.IO

- Status: Accepted (2026-10-17)

## Context
The DG recommends Socket.IO with a Redis adapter. Next.js Route Handlers cannot upgrade to WebSockets without a custom server. All live flows in the BRD are server → client (new ticket, status changed, payment updated); client → server actions are ordinary REST calls with version checks.

## Decision
- `GET /api/v1/stream` returns `text/event-stream`. Channel authorisation reuses the REST guards (session for staff, order token for the customer).
- Domain changes write `outbox_events` in the same DB transaction. After commit, a relay publishes pending rows to an in-process `RealtimeBus` and marks them published. A periodic sweep (every 5 s) republishes anything missed, e.g. after a crash between commit and publish. Rows that fail 10 times are marked dead (`deadAt`).
- Events are hints. Clients refetch the snapshot on (re)connect.

## Consequences
- No custom server; works on any Node host.
- With more than one instance, `RealtimeBus` must be backed by Redis pub/sub (interface ready, not implemented). Documented in the deployment checklist.
- EventSource reconnects automatically. Heartbeats drive the stale-connection banner.
