# RestaurantOS — Restaurant Ordering, Payments & Kitchen Operations Platform

A multi-tenant platform built from **BRD v2.0**. Guests scan a table QR code, order and pay on their phone. The kitchen sees only server-verified paid orders on a live display. Front of house gets ready alerts. Owners run menus, tables, staff, payments and reports. A platform operator onboards restaurants.

Built with Next.js 16 (App Router, Cache Components), TypeScript (strict), Tailwind CSS 4, React Hook Form + Zod, TanStack Query, Prisma 7 + PostgreSQL, Vitest, React Testing Library and Playwright (+ axe).

> **Demo mode** uses in-memory sample data (labelled DEMO) and a **test-only mock payment provider**. No real money moves until a launch country and payment provider are chosen (BRD §21).

---

## Quick start: preview everything without a backend (no database)

```bash
npm install
cp .env.example .env.local      # DATA_SOURCE=memory is the default
# put any 32+ char value in APP_SECRET and 16+ chars in PAYMENT_WEBHOOK_SECRET
npm run dev                     # http://localhost:3000
```

The landing page links to every role. All demo accounts use the password **`Demo@1234`**:

| Role | Email | Lands on |
| --- | --- | --- |
| Platform admin | admin@platform.demo | /platform |
| Owner, Spice Route (INR) | owner@spiceroute.demo | /admin |
| Branch manager (Main Street) | manager@spiceroute.demo | /admin |
| Cashier / front of house | cashier@spiceroute.demo | /counter |
| Kitchen | kitchen@spiceroute.demo | /kitchen |
| Runner | runner@spiceroute.demo | /delivery |
| Owner, Harbour Noodle Bar (SGD) | owner@harbour.demo | /admin |

Guest entry points: `/q/t_DEMO_main_table_12` (dine-in, Table 12) and `/r/spice-route` (takeaway/delivery).

**Try the full loop:**

1. Open the kitchen display (`kitchen@…`) in one window.
2. As a guest, order from Table 12 in another window and press **Pay** on the MockPay page.
3. Within about a second the ticket appears on the kitchen display. Accept it, start it, mark it ready.
4. Hand the order over from `/counter`. The guest's tracking page updates live.

MockPay's *Developer test controls* simulate a duplicate webhook, a tampered amount, a bad signature, and "return without paying".

## Run with PostgreSQL (real persistence)

```bash
npm run db:local                # docker compose: Postgres 17 (+ restaurant_test DB)
# .env.local: DATA_SOURCE=postgres
#             DATABASE_URL=postgresql://restaurant:restaurant@localhost:5432/restaurant
npm run db:deploy               # apply migrations (or db:migrate while developing the schema)
npm run db:seed                 # DEMO data; `npm run db:seed -- --reset` to start over
npm run dev
```

No Docker? `npx prisma dev` starts an embedded Postgres. Set `DB_POOL_MAX=1` with it, because it cannot handle parallel connections.

There is **no fallback** between data sources. If `postgres` is selected and the database is down, requests return `503 DATA_SOURCE_UNAVAILABLE`. A production build refuses `memory` and the mock provider unless `ALLOW_DEMO_MODE=true` is set.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | Route type generation + `tsc --noEmit` |
| `npm run lint` / `npm run format:check` | ESLint (incl. React Compiler rules) / Prettier |
| `npm test` | Unit + integration + component tests (memory store) |
| `npm run test:pg` | The same suites **also** against PostgreSQL (`restaurant_test`) |
| `npm run test:e2e` | Playwright: builds, starts in demo mode, runs journeys + axe scans |
| `npm run db:migrate` / `db:deploy` / `db:seed` / `db:generate` | Prisma |

## Environment variables

See [`.env.example`](.env.example). Required: `DATA_SOURCE`, `APP_SECRET` (≥32 chars), `PAYMENT_WEBHOOK_SECRET` (≥16), plus `DATABASE_URL` when `DATA_SOURCE=postgres`. Optional: `APP_BASE_URL`, `ALLOW_DEMO_MODE`, `UPLOAD_DIR`, `LOGIN_RATE_LIMIT`, `DB_POOL_MAX`, `SESSION_COOKIE_SECURE`. The environment is validated at startup with clear error messages.

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/01-requirements-analysis.md](docs/01-requirements-analysis.md) | BRD analysis: roles and permission matrix, traceability baseline, sitemap, workflows, assumptions, open questions |
| [docs/02-architecture.md](docs/02-architecture.md) | Modular monolith, request path, data-source modes, real-time, layout |
| [docs/03-api.md](docs/03-api.md) | API conventions, auth, errors, idempotency, webhooks, SSE. Live spec at `/api/v1/openapi.json` |
| [docs/04-quality.md](docs/04-quality.md) | Test strategy, release-blocker test map, accessibility and security review |
| [docs/05-operations.md](docs/05-operations.md) | Deployment, production checklist, runbooks, troubleshooting |
| [docs/06-traceability-status.md](docs/06-traceability-status.md) | **Implementation status of every BRD requirement** |
| [docs/adr/](docs/adr) | Architecture decisions (stack deviation, SSE, sessions, data sources) |

## Project layout

```
src/app/            routes: (public) (customer) (staff) admin/ platform/ api/v1/
src/features/       client UI per module (customer, kitchen, counter, menu, …)
src/components/ui/  design-system primitives
src/lib/            isomorphic: money, validation (Zod), order states, permissions, API client
src/server/         server-only: services/, store/ (memory + prisma), auth/, http/, payments/, realtime/
prisma/             schema, migrations, seed
tests/              unit/ integration/ e2e/ support/
```
