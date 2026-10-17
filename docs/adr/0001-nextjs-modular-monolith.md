# ADR-0001: Single Next.js application with a modular service layer

- Status: Accepted (2026-10-17)
- Supersedes: Development Guide §1 "Backend API: NestJS", "Repository: pnpm + Turborepo"

## Context
The Development Guide recommends a NestJS API plus separate Next.js apps in a pnpm/Turborepo monorepo. The engineering brief for this build specifies Next.js App Router, Route Handlers, a modular server-side service layer, and npm.

## Decision
Build one Next.js application. Each BRD module (identity, tenancy, catalog, tables, checkout/orders, payments, kitchen, fulfillment, notifications, reports, platform) is a service module under `src/server/services`. Route handlers stay thin. Business rules live only in services. UIs are route groups (`(customer)`, `(staff)`, `admin`, `platform`) that call the same `/api/v1` contract.

## Consequences
- One deployable and one transaction boundary, which keeps the BRD's "orders, payments and tickets change together" property.
- No NestJS guards/DI. Guards are explicit functions (`requireActor`, `requirePermission`), unit-tested with a role matrix.
- Splitting to a separate API later is possible: services do not import Next.js APIs, and the API is versioned with an OpenAPI document.
- npm instead of pnpm (brief: "follow the existing repository; otherwise npm").
