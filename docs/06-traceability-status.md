# 06 — Requirement traceability: implementation status

Legend: ✅ implemented and covered by automated tests · 🟡 partial (gap stated) · ⛔ blocked by an open stakeholder decision · ➖ out of MVP scope by the BRD.
"Both stores" means the integration test runs against the in-memory store **and** PostgreSQL 17.

## Functional requirements

| ID | Requirement | Status | Implementation | Evidence |
| --- | --- | --- | --- | --- |
| FR-01 | Multi-tenant restaurant & branch management | ✅ | `services/tenancy.ts`; Admin › Branches/Settings; Platform › Tenants/Onboard | `tenant-isolation.test.ts`; e2e onboarding |
| FR-02 | Menu & price management | ✅ | `services/catalog.ts`; Admin › Menu, item editor (variants, modifiers, image upload), branch price and availability | `orders.test.ts` (snapshot after edit, availability); `pricing.test.ts`; e2e sold-out |
| FR-03 | QR table ordering | ✅ | Opaque revocable QR refs, rotate/disable, SVG QR codes; `/q/[ref]` | `orders.test.ts` (revoked/rotated/disabled); e2e |
| FR-04 | Server-calculated checkout | ✅ | `services/pricing.ts` (pure), `checkout.ts`; schemas strip client prices | `pricing.test.ts`, `validation.test.ts` |
| FR-05 | Online payment | 🟡 | Provider adapter, signed webhooks, dedup, mismatch checks, reconciliation, refunds. **Only the mock provider exists.** | `payments.test.ts` (both stores); e2e |
| FR-06 | Order lifecycle | ✅ | `lib/order-states.ts`, guarded CAS transitions, history, auto-complete on handover | `order-states.test.ts`, `orders.test.ts` |
| FR-07 | Kitchen display | ✅ | `/kitchen`: columns, timers, accept/reject (reasons), station filter, sound | `payments.test.ts` (one ticket); e2e journey |
| FR-08 | Live updates & recovery | ✅ | Transactional outbox → SSE; heartbeats, stale banner, snapshot on reconnect | `tenant-isolation.test.ts` (channel auth); e2e reconnect |
| FR-09 | Restaurant admin | ✅ | Overview, Orders, Menu, Tables & QR, Branches, Staff, Payments, Reports, Settings, Audit | `permissions.test.ts`; e2e a11y + access |
| FR-10 | Notifications | 🟡 | In-app: live SSE toasts and kitchen sound; idempotent client dedup. **Email/SMS/push not built** (table reserved; invite links are shared manually). | e2e journey |
| FR-11 | Basic reports | ✅ | Sales by currency/day/hour, tax/fees, refunds, net, payments, prep times, top items, status counts | `tenant-isolation.test.ts` (currency, scope) |
| FR-12 | Takeaway | ✅ | `/r/[slug]`, pickup path | `orders.test.ts` (takeaway path) |
| FR-13 | Restaurant-managed delivery | ✅ | Tenant entitlement; manual assignment; `/delivery` runner app; failure → refund | `delivery.test.ts` (both stores) |
| FR-14 | Platform subscriptions | ➖ | Entitlements (delivery, max branches) exist; billing is later | — |
| FR-15 | Mobile apps | ➖ | API-first, Bearer token support, OpenAPI for client generation | — |

## Business rules

| ID | Status | Notes |
| --- | --- | --- |
| BR-01 Tenant ownership, branch scope | ✅ | Store API requires `tenantId`; branch scope verified (`scopedBranchIds`) |
| BR-02 QR is context only | ✅ | No session is created from a QR |
| BR-03 Snapshots | ✅ | `order_items` / `order_item_modifiers` copies; test edits the menu after ordering |
| BR-04 Integer minor units, ISO exponent | ✅ | `lib/money.ts`; DB `Int` + check constraints |
| BR-05 Currency on every order; never summed | ✅ | Reports grouped by currency |
| BR-06 Backend pricing authoritative | ✅ | |
| BR-07 Revalidate at checkout and at accept | ✅ | Accept fails on unavailable items; price drift reported as a warning |
| BR-08 Idempotency keys | ✅ | Orders, payment intents, refunds (DB unique per tenant) |
| BR-09 Retention; deleting items keeps history | 🟡 | Soft delete ✅; **retention periods undecided** (Q5) |
| BR-10 Customer payments vs SaaS fees separate | ✅ | No SaaS billing in MVP; nothing is mixed |
| BR-11 Provider must support the merchant before go-live | 🟡 | Go-live gate checks an ACTIVE payment connection, a menu and a table; real provider capability checks are ⛔ |

## Non-functional requirements

| ID | Status | Notes |
| --- | --- | --- |
| NFR-01 Availability 99.5 % | 🟡 | Stateless app and health/ready probes; infrastructure not provisioned |
| NFR-02 p95 < 500 ms | 🟡 | Indexed access paths; k6 script provided; **not yet measured at agreed load** (Q6) |
| NFR-03 Real-time ≤ 2 s, recovery | ✅ | Post-commit relay; e2e shows ticket arrival in about 1 s; reconnect tested |
| NFR-04 Security | 🟡 | See `04-quality.md`. MFA, CSP and shared rate limiting are pending |
| NFR-05 Tenant isolation tests | ✅ | API, files, WebSocket/SSE, reports (both stores) |
| NFR-06 Reliability | ✅ | Transactions, outbox with retries and dead-lettering, reconciliation |
| NFR-07 Backup/restore | ⛔ | Ops task (NT-10): drill in staging |
| NFR-08 Accessibility WCAG 2.2 AA | 🟡 | axe on 16 screens passes; manual screen-reader pass recommended |
| NFR-09 Observability | 🟡 | JSON logs, request IDs and alert log lines; OpenTelemetry traces and dashboards not built |
| NFR-10 Maintainability | ✅ | Versioned API, OpenAPI 3.1, migrations, ADRs, runbooks, CI workflow |

## MVP go-live gates (BRD §19)

| Gate | Status |
| --- | --- |
| Owner creates tenant and branch, adds menu, creates table QR | ✅ (e2e onboarding + admin screens) |
| Customer scans QR, orders, completes a sandbox payment | ✅ with mock provider; ⛔ real sandbox |
| Only verified server-side confirmation moves to paid | ✅ |
| One kitchen ticket in the correct queue | ✅ |
| Kitchen accept/prepare/ready; FOH handover | ✅ |
| Duplicates/retries/reconnects do not duplicate | ✅ |
| Failed payment never produces a paid kitchen order | ✅ |
| Tenant A cannot read or change tenant B | ✅ |
| Amount/currency mismatch rejected and raised | ✅ |
| Automated tests for transitions, isolation, pricing, webhooks, refund failures, reconnect | ✅ (134 Vitest tests incl. the PostgreSQL run, 34 Playwright e2e incl. axe) |
| Monitoring, alerting, backup restore, rollback, runbooks | 🟡 runbooks and alert hooks written; infrastructure pending |
| Pilot restaurant sign-off | ⛔ |

## Blocking decisions (from BRD §21 / DG §13)

1. Launch country and payment provider → real provider adapter, receipts, tax rules.
2. Tax-inclusive vs. exclusive, service charge, tips, discounts, receipts (built as exclusive tax and optional service charge, A3).
3. Kitchen tickets for pay-at-counter policies (built: paid orders only, A6).
4. Retention periods.
5. Pilot size and peak load → load-test targets and pool sizing.
