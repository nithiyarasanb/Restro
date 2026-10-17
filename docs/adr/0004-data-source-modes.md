# ADR-0004: Explicit demo (memory) and PostgreSQL data sources behind one interface

- Status: Accepted (2026-10-17)

## Context
The brief requires every screen to be previewable locally without a deployed backend, using realistic mock data and typed mock services with the same contracts as the real API. It also requires no silent fallback to mock data in production.

## Decision
- `src/server/store/types.ts` defines `DataStore`. It has two implementations:
  - `MemoryStore`: in-process, seeded with DEMO data (`src/server/store/memory/seed.ts`). Transactions use a global mutex with snapshot rollback, and uniqueness constraints are mirrored in code.
  - `PrismaStore`: PostgreSQL via Prisma 7 with the `pg` driver adapter.
- The mock covers only persistence. Pricing, the state machine, webhook verification and authorisation run the same code in both modes, so the preview behaves like production.
- `DATA_SOURCE` is required, and there is no fallback. Production refuses `memory` unless `ALLOW_DEMO_MODE=true`.
- The UI shows a persistent **DEMO DATA** banner in memory mode.

## Consequences
- Every store method exists twice. Parity is enforced by running the same service test suites against both stores (`tests/integration`).
- Memory mode resets on server restart (by design).
