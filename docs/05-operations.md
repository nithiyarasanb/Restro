# 05 — Operations: deployment, checklist, runbooks

Nothing here has been deployed. These are the steps and configuration for a deployment.

## Target environment (BRD §10)

AWS: ECS Fargate (app container), RDS PostgreSQL (encrypted, Multi-AZ when justified), S3 (menu images), ALB + CloudFront + WAF, Secrets Manager / KMS, CloudWatch. Terraform is the recommended IaC tool, but it is **not yet written**. Render or Railway with managed Postgres works for a cheap pilot.

## Build and release

```bash
docker build -t restaurant-platform:$(git rev-parse --short HEAD) .
# One-off migration task before rolling out new app containers (expand/contract, DG §12):
docker run --rm -e DATABASE_URL=… restaurant-platform:<tag> npx prisma migrate deploy
```

> The runtime image contains only the standalone server. Run migrations from the build stage, or from a dedicated migration image built from the `build` stage (`docker build --target build`).

The app is stateless apart from what the next table lists. Health checks: `/api/v1/health` (liveness, no DB) and `/api/v1/ready` (data source reachable).

| State | Where | Multi-instance note |
| --- | --- | --- |
| Data | PostgreSQL | Source of truth |
| Realtime fan-out | In-process bus | **Single instance only.** Implement `RealtimeBus` with Redis pub/sub before scaling out (ADR-0002). The outbox guarantees nothing is lost meanwhile. |
| Rate limits | In-process | Per instance. Put the WAF rate rules in front, or move to Redis. |
| Uploads | Local disk (`UPLOAD_DIR`) | **Dev adapter.** Implement the S3 adapter behind `services/files.ts` before production. |
| Outbox sweep, reconciliation | `setInterval` in each instance | Safe to run on every instance (idempotent). A scheduled job is cleaner at scale. |

## Production configuration checklist

- [ ] `DATA_SOURCE=postgres`, `DATABASE_URL` from Secrets Manager, TLS to RDS, private subnets.
- [ ] `DB_POOL_MAX` sized to `max_connections ÷ instances` (RDS Proxy recommended).
- [ ] `APP_SECRET` (≥32 random bytes) and the provider webhook secret come from Secrets Manager and are rotated on staff departure. Rotating `APP_SECRET` invalidates guest tracking links and signed image URLs.
- [ ] `APP_BASE_URL` is the public HTTPS origin (QR codes, invite links and CSRF checks use it).
- [ ] `ALLOW_DEMO_MODE` unset, and **a real payment provider adapter implemented** (blocked on BRD §21 Q1/Q2). The app refuses to start in production with the mock provider.
- [ ] `SESSION_COOKIE_SECURE` defaults to true in production. Keep it.
- [ ] CloudFront/ALB forward `x-forwarded-for` (rate limiting) and keep SSE connections open: idle timeout ≥ 60 s, response buffering off.
- [ ] Content-Security-Policy with nonces (not yet configured; the other security headers are set in `next.config.ts`).
- [ ] MFA for owners and platform admins (open question 8).
- [ ] Log shipping: the app writes JSON lines (`level`, `msg`, `requestId`, `path`, `status`, `ms`). Create CloudWatch alarms on:
  - `alert = PAYMENT_MISMATCH` or `REFUND_FAILED`
  - 5xx rate
  - `/ready` failures
  - outbox rows with `dead_at` set
  - payment attempts PENDING for more than 10 minutes
- [ ] Backups: RDS automated encrypted backups and PITR. **Run a restore drill in staging and record RPO/RTO (NT-10)** before go-live.
- [ ] Data retention periods agreed (open question 5) and a scheduled purge implemented.

## Runbooks

**Payment webhook failures** (alarm on 401s or `REJECTED` outcomes)
1. 401s mean a secret mismatch. Compare the provider dashboard secret with Secrets Manager, rotate and redeploy.
2. `REJECTED` with "mismatch" (see Admin › Payments, flagged attempts) means the provider reported different facts. Investigate with the provider before any manual action, and never mark orders paid by hand.
3. If webhooks are delayed, reconciliation runs every minute. It can also be forced from Admin › Payments › Run reconciliation.

**Stuck orders**
- An order in PENDING_PAYMENT for over 30 minutes is cancelled by reconciliation. If it was actually paid, the late capture is refunded automatically and flagged.
- An order stuck in CONFIRMED/ACCEPTED: the kitchen screen may be offline. Check the board's connection pill. A manager can cancel with a reason, which refunds automatically.

**Kitchen screen shows "Connection lost"**
Check the device network. The board keeps the last known state and reloads the authoritative queue on reconnect. As a fallback, staff can use Admin › Orders on any device.

**Failed refunds**
Admin › Payments lists FAILED refunds with the provider's reason. Retry from there. Failed refunds are never shown as successful.

**Outbox backlog / dead events**
`SELECT count(*) FROM outbox_events WHERE published_at IS NULL;`. Dead rows (`dead_at` set) need investigation. Clients still recover through snapshots, so this is not a data-loss event.

**Secret rotation**
Rotate in Secrets Manager, then restart tasks. `PAYMENT_WEBHOOK_SECRET` must be changed in coordination with the provider. Rotating `APP_SECRET` logs nobody out (sessions are stored in the DB) but breaks old tracking links.

**Tenant data request / offboarding**
Suspend the tenant (Platform › tenant › Suspend). Export or delete per the agreed retention policy (not yet defined; open question 5).

## Troubleshooting (local)

| Symptom | Fix |
| --- | --- |
| `Invalid environment configuration` | Copy `.env.example` to `.env.local` and fill `APP_SECRET` (≥32 chars) and `PAYMENT_WEBHOOK_SECRET` (≥16). |
| `503 DATA_SOURCE_UNAVAILABLE` | Postgres is not running or `DATABASE_URL` is wrong. Run `npm run db:local` and check `npm run db:deploy`. |
| Demo data disappeared | Memory mode resets on restart by design. Use Postgres for persistence. |
| Pages fail with Prisma "bind message supplies…" errors | You're on the embedded `prisma dev` server. Set `DB_POOL_MAX=1`, or use Docker Postgres. |
| A branch shows "closed" | Opening hours are evaluated in the branch timezone. Lake View is 11:00–23:00 IST; Main Street is open around the clock in the demo. |
| `429 RATE_LIMITED` while testing | Raise `LOGIN_RATE_LIMIT` or `API_RATE_LIMIT_MULTIPLIER` locally (never in production). |
| Load test | `API_RATE_LIMIT_MULTIPLIER=100 npm start`, then `k6 run -e BASE=http://localhost:3000 tests/load/menu-and-orders.js` |
