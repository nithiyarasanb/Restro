# 02 — Architecture

## Shape

One Next.js (App Router) application containing the UIs **and** a versioned REST API (`/api/v1`). The server side is a *modular monolith*: each BRD module is a service file that owns its rules. Every service talks to persistence only through the `DataStore` interface.

```
 Browser (customer PWA · admin · kitchen · counter · delivery · platform)
        │  HTML/RSC (Server Components)        │  fetch /api/v1 (JSON) · EventSource /api/v1/stream (SSE)
        ▼                                       ▼
 ┌───────────────────────────── Next.js server (Node runtime) ─────────────────────────────┐
 │  app/**/page.tsx (RSC)     app/api/v1/**/route.ts (thin: parse → guard → service → map) │
 │            └──────────────┬──────────────┘                                             │
 │                  src/server/services/*  (business rules, one per BRD module)           │
 │   identity · tenancy · catalog · tables · checkout · orders · payments · kitchen ·     │
 │   fulfillment · notifications(outbox) · reports · platform                             │
 │                  │                          │                       │                  │
 │      DataStore interface          PaymentProvider adapter    Realtime bus + outbox     │
 │      ├─ MemoryStore (demo)        ├─ MockProvider (test)      relay (after commit)      │
 │      └─ PrismaStore (PostgreSQL)  └─ (Razorpay … ⛔ decision)                            │
 └────────────────────────────────────────────────────────────────────────────────────────┘
```

## Request path (mirrors DG §2)

1. `withApi()` attaches/propagates `x-request-id` and checks the `Origin` for cookie-authenticated mutations (CSRF). It also applies the rate limit and payload size limit.
2. `requireActor()` resolves the session and user. `requirePermission(actor, perm, {tenantId, branchId})` checks role and scope.
3. Zod parses the body, query and params. Malformed input → `422 VALIDATION_FAILED`.
4. The service runs the use case inside `store.tx()` when state changes. Outbox rows are written in the same transaction.
5. After commit, `relayOutbox()` publishes events to the in-process bus, and SSE subscribers in authorised channels receive them.
6. Responses are JSON. Errors are `{ code, message, requestId, details? }` with appropriate HTTP status.

## Data source switching (ADR-0004)

`DATA_SOURCE=memory` (default for local preview) uses a seeded in-process store and needs no database. `DATA_SOURCE=postgres` uses Prisma with `DATABASE_URL`. The mode is read once at startup:

- There is **no automatic fallback**. If postgres is selected and unreachable, requests fail with `503 DATA_SOURCE_UNAVAILABLE`.
- `NODE_ENV=production` with `DATA_SOURCE=memory` refuses to start unless `ALLOW_DEMO_MODE=true` is set (for a throwaway preview deploy). Every page then shows a **DEMO DATA** banner.

Both stores implement the same contract and run the same service code. The service unit tests run against the memory store. The integration tests run the same suites against PostgreSQL.

## Real-time (ADR-0002)

- Channels: `kitchen:{tenantId}:{branchId}`, `orders:{tenantId}:{branchId}` (staff, session-authorised) and `order:{orderId}` (customer, order-token-authorised). `runner:{tenantId}:{userId}` is the delivery channel.
- Events: `order.created | order.updated | payment.updated | delivery.updated`. Each carries `eventId`, `orderId`, `status`, `version` and `at`.
- The client loads the snapshot through REST first, then applies events whose `version` is greater than the cached one, deduplicating by `eventId`. On `open` after a reconnect it refetches the snapshot.
- There is a heartbeat every 15 s. After 2 missed heartbeats the UI shows a "Connection lost — showing last known state" banner.
- In-process bus: one app instance is fine for the pilot. For multiple instances, swap the bus for Redis pub/sub (interface `RealtimeBus`). The outbox stays the source of truth.

## Directory layout

```
src/
  app/                    routes (RSC pages, layouts, route handlers)
    (public)/             landing, login, invite
    (customer)/           q/, r/, checkout/, order/, pay/mock/
    (staff)/              kitchen/, counter/, delivery/
    admin/                restaurant admin (sidebar shell)
    platform/             platform admin (separate shell + guard)
    api/v1/               REST API
  components/ui/          design-system primitives (Button, Field, Dialog, Table, Badge…)
  components/layout/      shells, nav, banners
  features/<module>/      client components + hooks per module (catalog, checkout, kitchen…)
  lib/                    isomorphic: money, validation schemas, api client, utils, order states
  server/                 server-only
    auth/                 sessions, password hashing, guards, permissions
    http/                 route-handler wrapper, errors, rate limit
    store/                DataStore interface, memory/, prisma/
    services/             business modules
    payments/             provider interface + mock provider
    realtime/             bus, outbox relay, SSE helpers
  types/                  domain types shared by client and server
prisma/                   schema, migrations, seed
tests/                    unit/, integration/, e2e/
docs/                     analysis, architecture, API, ADRs, ops
```
