# 01 — Requirements Analysis

Sources analysed (all pages, tables, figures and appendices):

| Ref | Document | Pages |
| --- | --- | --- |
| **BRD** | Restaurant Ordering, Payments & Kitchen Operations Platform — BRD v2.0 (13 Oct 2026) | 19 |
| **DG** | Restaurant Platform — Development Guide v1.0 | 13 |
| **PITCH** | Restaurant Platform — Product Pitch | 6 |

The BRD is the source of truth. The DG is used for module endpoints, state machine and test lists. The pitch adds no new requirements.

---

## 1. Business objectives and scope (BRD §1–3, §5)

A **multi-tenant** restaurant operations platform. Guests scan a table QR code, order and pay online. The kitchen sees only **server-verified paid** orders on a live display. Front of house is alerted when food is ready. Owners manage menus, tables, staff and reports. A platform operator onboards restaurants.

| Objective (BRD §3) | Measure |
| --- | --- |
| O1 Reduce time/friction placing an order | Median QR-scan → paid; checkout abandonment |
| O2 Remove manual re-entry FOH → kitchen | % orders entering kitchen with no re-entry; order-error rate |
| O3 Real-time, reliable status | Payment-verified → ticket latency; reconnect recovery success |
| O4 Central management for owners | % changes made in dashboard; weekly active owners |
| O5 Scalable SaaS with isolated data | Active tenants; tenant-isolation suite green every release |
| O6 Online payment, reconciliation, refunds, no card data | Payment success rate; unresolved reconciliation exceptions; zero card data |
| O7 Multi-country foundation | Countries/currencies added by configuration, not code |

**In MVP scope (BRD §5):** tenant/branch onboarding and RBAC; the menu (categories, items, variants, modifiers, availability, branch prices, images); tables and QR codes; guest ordering without an account; server-side cart validation, taxes/fees and totals; online payment through a provider adapter; the kitchen queue; live updates with reconnect; order history, notifications and audit; the admin dashboard and basic reports; dine-in and takeaway; *optional* restaurant-managed delivery; and responsive web/PWA.

**Out of MVP (BRD §5 "Planned after"):** native apps, SaaS billing, loyalty/promotions/reviews, multiple providers, GPS dispatch, multi-language menus, advanced tax engines.

## 2. Roles and permissions (BRD §6, DG §4)

| Role | Key | Scope | Can |
| --- | --- | --- | --- |
| Platform administrator | `PLATFORM_ADMIN` | Platform | Tenants, onboarding, entitlements, audit, support. MFA (later). Every action audited. |
| Restaurant owner | `OWNER` | Own tenant, all its branches | Profile, branches, payment setup, staff, menu, tables, orders, refunds, reports, settings |
| Branch manager | `BRANCH_MANAGER` | Assigned branches | Branch operations: tables/QR, availability/branch price, orders, cancel, assign delivery, refunds (policy: allowed) |
| Cashier / front of house | `CASHIER` | Assigned branch | View orders, handle exceptions, hand over (SERVED/PICKED_UP) |
| Kitchen staff | `KITCHEN` | Assigned branch (+ station) | Kitchen queue: accept / reject (reason) / preparing / ready |
| Runner / delivery | `RUNNER` | Own assigned jobs only | View own jobs with minimum customer data; picked up / delivered / failed |
| Customer | (anonymous) | Own order (order token) + public menu | Browse, order, pay, track |

**Permission matrix** (server-enforced, `src/lib/auth/permissions.ts`):

| Permission | PA | OWNER | MGR | CASHIER | KITCHEN | RUNNER |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| `platform.manage` | ✔ | | | | | |
| `tenant.settings` | | ✔ | | | | |
| `branch.manage` (create/edit branch) | | ✔ | | | | |
| `branch.settings` (hours, availability) | | ✔ | ✔ | | | |
| `staff.manage` | | ✔ | ✔¹ | | | |
| `menu.manage` (catalog CRUD) | | ✔ | | | | |
| `menu.availability` (branch price/stock) | | ✔ | ✔ | | | |
| `tables.manage` | | ✔ | ✔ | | | |
| `orders.view` | | ✔ | ✔ | ✔ | ✔ | |
| `orders.cancel` | | ✔ | ✔ | | | |
| `orders.handover` | | ✔ | ✔ | ✔ | | |
| `kitchen.operate` | | ✔ | ✔ | | ✔ | |
| `delivery.assign` | | ✔ | ✔ | | | |
| `delivery.run` (own jobs) | | | | | | ✔ |
| `payments.refund` | | ✔ | ✔ | | | |
| `payments.configure` | | ✔ | | | | |
| `reports.view` | | ✔ | ✔ | | | |
| `audit.view` | ✔ | ✔ | | | | |

¹ A manager may invite only CASHIER/KITCHEN/RUNNER roles, and only to their own branches (assumption A9).

## 3. Functional requirements and traceability matrix

Status legend: ✅ implemented and tested · 🟡 partial (see note) · ⏳ not started · ⛔ blocked by an open decision · ➖ out of MVP scope.
The live status of each row is in [`06-traceability-status.md`](06-traceability-status.md). This table is the design baseline.

| ID | Requirement (BRD) | Pri | Screen / workflow | API / service | Rules | Test scenarios |
| --- | --- | --- | --- | --- | --- | --- |
| FR-01 | Multi-tenant restaurant and branch management | Must | Platform › Tenants, Onboard tenant; Admin › Branches, Settings | `GET/POST /platform/tenants`, `GET/POST/PATCH /branches` · `tenancy.service` | tenant_id on every row; cross-tenant read/write → 404; writes audited | Owner A cannot read/patch tenant B branch; restaurant roles get 403 on `/platform/*` |
| FR-02 | Menu and price management | Must | Admin › Menu (categories, items, variants, modifier groups), Item editor, Branch availability | `/menu/categories`, `/menu/items`, `/menu/modifier-groups`, `PATCH /branches/{id}/menu-items/{itemId}` · `catalog.service` | Branch price override; retire = soft delete; order snapshots unaffected | Branch override applied in quote; unavailable item cannot be quoted; snapshot unchanged after edit |
| FR-03 | QR table ordering | Must | Admin › Tables & QR; Customer `/q/{ref}` | `GET /public/qr/{ref}`, `/branches/{id}/tables`, `POST /tables/{id}/qr/rotate` · `tables.service` | QR is an opaque, revocable token: context only, never auth | Revoked/disabled/rotated QR → cannot quote or order |
| FR-04 | Server-calculated checkout | Must | Customer cart → checkout | `POST /public/quotes`, `POST /public/orders` · `pricing.ts`, `checkout.service` | Client sends ids, qty, modifiers only; totals recomputed; min/max modifier rules; integer minor units | Client total ignored; invalid modifier rejected; tax rounding; currency exponent |
| FR-05 | Online payment | Must | Checkout → provider page → "waiting for confirmation" | `POST /orders/{id}/payment-intents`, `POST /webhooks/payments/{provider}` · `payments.service`, `providers/mock` | Signature over raw body; event id unique; amount/currency/account check; redirect ≠ proof | Bad signature 401; duplicate → no-op; mismatch rejected + flagged; out-of-order ignored |
| FR-06 | Order lifecycle | Must | Kitchen, Counter, Admin › Order detail | `POST /orders/{id}/transitions` · `order-state-machine.ts` | Transition table (DG §6); role + scope + expected status + version guard; history row per transition | Illegal transition 422; stale version 409; history attributed |
| FR-07 | Kitchen display | Must | `/kitchen` board | `GET /branches/{id}/kitchen/queue`, `POST /kitchen/tickets/{id}/reject` · `kitchen.service` | Ticket created exactly once at CONFIRMED; queue scoped to branch/station | Failed payment never queued; duplicate webhook → one ticket |
| FR-08 | Live updates and recovery | Must | Kitchen, Counter, Order tracking (connection banner) | `GET /stream` (SSE) · outbox relay, event bus | Events from outbox after commit; scoped and authenticated; reconnect → fresh snapshot; drop by id/version | Unauthorised channel 403; reconnect refetches; stale banner after missed heartbeats |
| FR-09 | Restaurant admin | Must | Admin › Overview, Orders, Menu, Tables, Branches, Staff, Payments, Reports, Settings | Respective endpoints | Within permissions | Role matrix tests |
| FR-10 | Notifications | Should | Toasts and sound on kitchen/counter; bell in admin | SSE + `notification_jobs` (email/SMS/push adapters later) | Retry must not repeat a business action | Duplicate event deduplicated client-side |
| FR-11 | Basic reports | Should | Admin › Reports | `GET /reports/sales`, `/reports/prep-times`, `/reports/payments` · `reports.service` | Date filter; separate metrics; never sum different currencies | Mixed currencies reported separately; scope by role |
| FR-12 | Takeaway | Must | Customer `/r/{slug}` (takeaway); Counter pickup | Same order core, `fulfillmentType=TAKEAWAY` | READY → PICKED_UP → COMPLETED | Takeaway cannot go to SERVED |
| FR-13 | Restaurant-managed delivery | Should | Customer delivery option; Admin › Orders assign; `/delivery` runner | `POST /orders/{id}/delivery-assignments`, `GET /me/delivery-jobs`, `POST /delivery-jobs/{id}/events` | Feature flag per tenant (off by default); manual assignment; runner sees own jobs only | Runner cannot see or update an unassigned job |
| FR-14 | Platform subscriptions | Later | — | — | Separate money flow from customer payments | ➖ |
| FR-15 | Mobile apps | Phase 2 | — | Same `/api/v1` + OpenAPI | No duplicated business logic | ➖ (API-first design keeps it possible) |

### Business rules (BRD §13)

| ID | Rule | Enforced in |
| --- | --- | --- |
| BR-01 | Each tenant owns its data; branch membership and role scope | `requireScope()`, every repository query includes `tenantId` |
| BR-02 | QR identifies context only; not a credential | `tables.service.resolveQr` returns public context; no session issued |
| BR-03 | Names, prices, modifiers, taxes and currency are snapshotted on the order | `order_items` / `order_item_modifiers` store copies |
| BR-04 | Money in integer minor units using the ISO 4217 exponent | `src/lib/money.ts` |
| BR-05 | Every order records currency; no silent conversion | `orders.currency`; reports group by currency |
| BR-06 | Backend pricing is authoritative | `pricing.ts`; request schema has no price fields |
| BR-07 | Availability and price revalidated at checkout **and at accept** | `checkout.service`, `kitchen.service.accept` |
| BR-08 | Idempotency keys on order creation, payment initiation and refunds | unique `(tenant_id, idempotency_key)` |
| BR-09 | Retention policy; deleting a menu item never deletes snapshots | soft delete (`retiredAt`) |
| BR-10 | Customer payments and SaaS fees are separate flows | No SaaS billing in MVP; reports never mix them |
| BR-11 | A provider must support the merchant's country, currency, business type and settlement model before a branch goes live | `payment_connections.status = ACTIVE` required for `branch.isLive` |

### Non-functional requirements (BRD §14)

| ID | Area | Target | Approach |
| --- | --- | --- | --- |
| NFR-01 | Availability | 99.5%/month (proposed) | Stateless app, managed Postgres; documented in deployment guide |
| NFR-02 | Performance | p95 < 500 ms ordinary reads/writes | Indexed access paths; Server Components; k6 script provided |
| NFR-03 | Real-time | Updates within 2 s; recover after disconnect | SSE + outbox relay; heartbeat 15 s; snapshot on reconnect |
| NFR-04 | Security | HTTPS, secure sessions, least privilege, rate limits, secrets | HTTP-only SameSite cookies, Origin check (CSRF), rate limiter, env validation |
| NFR-05 | Tenant isolation | Automated negative tests via API, exports, files, WebSockets | `tests/integration/tenant-isolation.test.ts` |
| NFR-06 | Reliability | Transactions, outbox, retries, dead letter | `store.tx()`; `outbox_events.attempts`, `deadAt` |
| NFR-07 | Backup/recovery | Encrypted backups, restore test | Deployment guide (ops task) |
| NFR-08 | Accessibility | WCAG 2.2 AA where feasible | Semantic HTML, labels, focus rings, native `<dialog>`, aria-live toasts, contrast-checked tokens |
| NFR-09 | Observability | Structured logs, request IDs, metrics, traces | `x-request-id` on every response; JSON logger; error shape `{code,message,requestId}` |
| NFR-10 | Maintainability | Versioned API, tests, migrations, OpenAPI, runbooks | `/api/v1`, Prisma migrations, `/api/v1/openapi.json` |

### Release-blocking negative tests (DG §11)

| ID | Test |
| --- | --- |
| NT-1 | Tenant A cannot access tenant B menu, orders, payment settings, reports, files or live events |
| NT-2 | A browser redirect alone cannot mark a payment captured |
| NT-3 | A duplicate webhook cannot duplicate an order, payment or kitchen ticket |
| NT-4 | A failed payment never enters the paid kitchen queue |
| NT-5 | An incorrect amount or currency is rejected and logged |
| NT-6 | A stale transition cannot overwrite a newer order state |
| NT-7 | Reconnect restores current server state |
| NT-8 | A worker cannot view or update unassigned delivery jobs |
| NT-9 | A failed refund is not reported as successful |
| NT-10 | Backup restore procedure documented and tested (ops; outside the code) |

## 4. Sitemap (screens)

```
/                              Landing: what this is, demo role entry points (demo mode)
/login                         Staff sign-in
/invite/[token]                Accept staff invitation (set name + password)

Customer (public, mobile-first)
/q/[qrRef]                     Resolve table QR → dine-in menu for that table
/r/[slug]                      Restaurant landing → takeaway / delivery menu (branch picker)
/r/[slug]/b/[branchId]         Menu (categories, items, item sheet with variants/modifiers)
/checkout                      Cart, fulfilment details, server quote, pay
/pay/mock/[attemptId]          MOCK PROVIDER hosted page (test only, clearly labelled)
/order/[orderId]?t=token       Live order tracking (status timeline, connection banner)

Kitchen (tablet/large screen)
/kitchen                       Live board: NEW / ACCEPTED+PREPARING / READY; accept, reject (reason), ready, hand over

Front of house
/counter                       Ready-for-handover list + exceptions (payment pending, rejected)

Delivery (optional, flag)
/delivery                      My assigned jobs; job detail and status updates

Restaurant admin
/admin                         Overview KPIs, orders by hour, live orders
/admin/orders                  Search, filter (status, type, date), pagination
/admin/orders/[id]             Detail: items snapshot, status history, payments, refunds, assign runner, cancel
/admin/menu                    Categories + items list, availability toggles
/admin/menu/items/new          Item editor (variants, modifier groups, image)
/admin/menu/items/[id]         Item editor
/admin/menu/modifiers          Modifier groups and options
/admin/tables                  Tables per branch, QR preview/print, rotate, disable
/admin/branches                Branches list + create/edit (hours, tax, fees, delivery)
/admin/staff                   Members, roles, branch scope, invitations
/admin/payments                Payment connection status, attempts, refunds, reconciliation
/admin/reports                 Sales, payments, prep times, item sales (per currency)
/admin/settings                Tenant profile, currency, tax/service charge, features
/admin/audit                   Audit log (owner)

Platform admin
/platform                      Tenants overview
/platform/tenants/new          Onboard tenant (tenant + first branch + owner invitation)
/platform/tenants/[id]         Tenant detail: status, entitlements, branches, suspend
/platform/audit                Platform-wide audit log
```

## 5. End-to-end workflows

**A. Onboarding.** Platform admin creates the tenant, first branch and owner invitation, and gets an invite link. The owner accepts and sets a password. The owner sets currency, tax and fees, then hours. Payment connection: mock is ACTIVE in dev; real providers are ⛔ pending decision. The owner adds menu and tables and generates QR codes. A test order goes through and the branch goes **live** (requires an active payment connection, BR-11).

**B. Dine-in QR.** `/q/{ref}` resolves to tenant/branch/table, or shows an error if revoked. The guest browses the available menu and picks variants, modifiers and quantity. The cart is client-side, with a server quote on every change. Checkout: `POST /public/orders` with an Idempotency-Key creates the order as PENDING_PAYMENT with snapshots. `POST payment-intents` returns the provider URL, and the guest pays there. The redirect shows "waiting for confirmation". The provider webhook is verified, and one transaction sets the payment CAPTURED and the order CONFIRMED, creates the kitchen ticket and writes the outbox rows. The SSE update reaches the kitchen and the guest. Kitchen: accept (revalidating availability), preparing, ready. Counter is alerted and hands over: SERVED, then COMPLETED.

**C. Kitchen.** The board loads a snapshot of the queue for an authorised branch, optionally filtered by station, and subscribes to SSE. Staff accept or reject (reason code), mark preparing, mark ready. On disconnect a banner appears and the snapshot is refetched on reconnect. A stale action returns 409, and the board shows the toast "Order changed elsewhere — refreshed".

**D. Takeaway.** `/r/{slug}`: choose branch, then takeaway, then name and phone. Then pay, kitchen, ready, PICKED_UP, COMPLETED.

**E. Delivery (flag).** Address and phone are collected and the server checks the delivery fee. Pay, then the order reaches READY. A manager assigns a runner, who sees only their own jobs. PICKED_UP → OUT_FOR_DELIVERY. Then DELIVERED (→ COMPLETED) or DELIVERY_FAILED with a reason, which triggers a refund.

**F. Payment exception.** On failure or timeout the order stays PENDING_PAYMENT, and the guest can retry, creating a new attempt on the same order. Only one attempt can capture. A reconciliation job polls the provider for pending attempts. A duplicate event is a no-op. An amount or currency mismatch is rejected, flagged for review and alerted.

## 6. Data entities (BRD §15, DG §5)

`users`, `sessions`, `tenants`, `branches`, `tenant_memberships`, `branch_memberships`, `invitations`, `audit_logs` ·
`menu_categories`, `menu_items`, `menu_item_variants`, `modifier_groups`, `modifier_options`, `menu_item_modifier_groups`, `branch_menu_items` ·
`restaurant_tables` · `kitchen_stations` ·
`orders`, `order_items`, `order_item_modifiers`, `order_status_history`, `kitchen_tickets` ·
`payment_connections`, `payment_attempts`, `payment_webhook_events`, `refunds` ·
`outbox_events`, `notification_jobs` ·
`delivery_assignments`, `delivery_events` · `files`

See `prisma/schema.prisma` for keys, constraints and indexes.

## 7. Ambiguities, assumptions and questions

### Assumptions made (changeable by decision record)

| # | Assumption | Why |
| --- | --- | --- |
| A1 | **Launch currency INR**, demo tenant in India. Money and currency code are generic (INR, USD, EUR, GBP, AED, JPY, KWD… exponents table). | Mockups use ₹; BRD names Razorpay as an India candidate. Launch country is still undecided (Q1). |
| A2 | **Mock payment provider only.** The real provider adapter interface exists; no real provider is integrated. | DG: "one real sandbox provider only after the launch country is confirmed". |
| A3 | **Tax is tax-exclusive** at a configurable branch rate (basis points), rounded half-up on the order subtotal. Optional service charge (bps). No tips or discounts in MVP. | BRD §21 lists this as an open decision; the mockup shows "Tax (configured)" added on top. |
| A4 | Customer accounts are **not** required for dine-in or takeaway. Takeaway needs a name and phone; delivery needs a name, phone and address. | BRD §5 and §21 Q3. |
| A5 | Delivery is designed and implemented but **off by default** per tenant (entitlement). It is enabled for the DEMO tenant so it can be previewed. | DG "Defaults". |
| A6 | Kitchen ticket is created **only at CONFIRMED** (paid). No pay-at-counter. | DG open decision 10; BRD go-live gate. |
| A7 | Handover (SERVED / PICKED_UP / DELIVERED) **auto-completes** the order in the same transaction, with two history rows. | BRD journey B: "serves → order completed". |
| A8 | Kitchen rejection or delivery failure of a paid order **auto-requests a full refund**. A failed refund stays FAILED and can be retried by owner/manager. | "refund workflow if paid". |
| A9 | Managers can invite only CASHIER/KITCHEN/RUNNER to their own branches. Owners can invite anyone except PLATFORM_ADMIN. | Least privilege. |
| A10 | One kitchen ticket per order (not split per station). Station is an optional filter on the ticket. | BRD: "creates exactly one kitchen ticket". |
| A11 | Sessions use opaque random tokens stored **hashed** server-side, in an HTTP-only, SameSite=Lax, Secure (prod) cookie with an 12 h sliding expiry. This replaces the JWT access/refresh pair. | Revocable, simpler with SSR. ADR-0003. |
| A12 | Image storage is a local-disk adapter in dev, behind a `FileStorage` interface; S3 is a production TODO. | DG names S3; no cloud credentials. |
| A13 | Offline order creation is unsupported (BRD §21). | — |
| A14 | Order numbers are sequential per branch (e.g. #1043), separate from the UUID. | Mockups. |

### Questions requiring stakeholder clarification (BRD §21, DG §13)

1. Which country or countries host the pilot? This blocks the real payment provider, tax and receipts.
2. Which payment provider(s), and which merchant/settlement model?
3. Tax-inclusive or exclusive pricing; service charge; tips; discounts; receipt/invoice format?
4. Is delivery mandatory for the MVP?
5. Retention periods for orders, audit logs and customer contact data?
6. Pilot size, peak orders/minute, and SLA expectations? These are needed for the load targets.
7. Should a cancelled order that was paid be refunded automatically, or need manager approval? This build assumes automatic (A8).
8. MFA approach for owners and platform admins (TOTP vs. passkeys)? Not implemented in this build.

## 8. Deviations from the Development Guide (stack)

The engineering brief for this build mandates **Next.js App Router + Route Handlers + npm**. This replaces the DG's NestJS API and pnpm/Turborepo monorepo. Decisions are recorded in `docs/adr/`:

- ADR-0001: single Next.js app with a modular service layer, not a NestJS monorepo.
- ADR-0002: Server-Sent Events plus an outbox relay, not Socket.IO.
- ADR-0003: opaque server-side sessions, not JWT access/refresh.
- ADR-0004: explicit in-memory demo store vs. PostgreSQL, behind one `DataStore` interface.
