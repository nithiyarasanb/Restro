# 03 — API

The machine-readable contract is **`GET /api/v1/openapi.json`** (OpenAPI 3.1). It is generated from the same Zod schemas the handlers use (`src/server/http/openapi.ts`), so it cannot drift from validation. This page covers the conventions.

## Basics

- Base path `/api/v1`, JSON in and out. Money is always an **integer in minor units** with an ISO 4217 `currency` beside it.
- Every response carries `x-request-id`. Send your own `x-request-id` to correlate logs.
- Errors use one shape:

```json
{ "code": "STALE_STATE", "message": "Order #1042 was updated elsewhere. Refresh to see its current state.", "requestId": "…", "details": { "currentVersion": 5 } }
```

| Status | Codes |
| --- | --- |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` |
| 401 | `UNAUTHENTICATED`, `INVALID_SIGNATURE` |
| 403 | `FORBIDDEN`, `CSRF_REJECTED` |
| 404 | `NOT_FOUND`, `QR_INVALID` (out-of-scope records also return 404) |
| 409 | `STALE_STATE`, `CONFLICT` |
| 413 | `PAYLOAD_TOO_LARGE` (64 KiB default; 3 MiB for uploads) |
| 422 | `VALIDATION_FAILED` (with `details.issues[{path,message}]`), `INVALID_TRANSITION`, `ITEM_UNAVAILABLE`, `BRANCH_NOT_ACCEPTING`, `IDEMPOTENCY_KEY_REUSED`, `PAYMENT_NOT_ALLOWED`, `REFUND_NOT_ALLOWED`, `FEATURE_DISABLED` |
| 429 | `RATE_LIMITED` (+ `retry-after`) |
| 502 / 503 | `PROVIDER_ERROR` / `DATA_SOURCE_UNAVAILABLE` |

## Authentication

- **Staff:** `POST /auth/login` sets an HTTP-only `rp_session` cookie (SameSite=Lax; Secure in production). Non-browser clients (the phase-2 mobile apps) can send the same token as `Authorization: Bearer <token>`.
- **CSRF:** cookie-authenticated mutations must send an `Origin` matching the app. Browsers do this automatically.
- **Guests:** no account. Order creation returns an `accessToken` that authorises `GET /public/orders/{id}?t=…`, payment retries and the order's live channel.
- **Authorization** is enforced in services on every call: role permission, tenant, and branch scope (docs/01 §2).

## Idempotency

`POST /public/orders`, `POST /public/orders/{id}/payment-intents` and `POST /orders/{id}/refunds` require an `Idempotency-Key` header (8–100 chars `[A-Za-z0-9_-]`).

- The same key with the same body returns the original result (200, `idempotent-replayed: true` for orders).
- The same key with a different body returns `422 IDEMPOTENCY_KEY_REUSED`.
- Keys are unique per tenant in the database, so parallel retries cannot create duplicates.

## Order transitions

`POST /orders/{id}/transitions` with `{ "action": "accept", "expectedVersion": 4, "reason": null }`.

Actions are `accept | reject | start | ready | serve | pickup | complete | cancel`. `reject` and `cancel` require a `reason`.

- The server checks role, scope, current state and fulfilment type, then applies a single guarded update (`WHERE status = … AND version = …`).
- A stale version returns **409**. Handover actions auto-complete the order.
- A paid order that is rejected or cancelled starts a full refund automatically.

## Payments and webhooks

1. `POST /public/orders/{id}/payment-intents` returns `{ checkoutUrl }` (the provider's hosted page).
2. The provider calls `POST /webhooks/payments/{provider}`. The signature is verified over the **raw body** before parsing:
   - Bad signature: 401.
   - Event id already processed: 200 `{duplicate:true}`.
   - Account, reference, amount or currency mismatch: 200 `{outcome:"REJECTED"}`, flagged for review, alert logged.
   - Otherwise one transaction marks the payment captured, the order confirmed, creates exactly one kitchen ticket and writes the outbox rows.
3. A browser redirect back to `/order/{id}` **never** changes state. Missing webhooks are resolved by reconciliation (every 60 s while running, or `POST /payments/reconciliation/run`). Unpaid orders are cancelled after 30 minutes.

The mock provider signs with `x-mock-signature: t=<unix>,v1=hex(HMAC_SHA256(PAYMENT_WEBHOOK_SECRET, "<t>.<rawBody>"))`, with a 5-minute tolerance.

## Real-time (Server-Sent Events)

`GET /stream?channel=kitchen&branchId=…` | `orders&branchId=…` | `order&orderId=…&t=<token>` | `runner`

- Events: `ready`, `heartbeat` (every 15 s), and `message` with `{eventId, type, orderId, payload:{status, version, …}}`.
- Events are **hints**. On every (re)connect, clients refetch the snapshot (e.g. `GET /branches/{id}/kitchen/queue`) and drop duplicate `eventId`s.
- Streams close after 30 minutes to force re-authorisation, and EventSource reconnects automatically.

## Example: the guest flow with curl

```bash
B=http://localhost:3000/api/v1
ITEM=$(curl -s $B/public/qr/t_DEMO_main_table_12 | jq -r '.items[] | select(.name=="Veg Spring Rolls") | .id')
curl -s -X POST $B/public/orders -H 'content-type: application/json' -H "Idempotency-Key: demo-$(date +%s)" \
  -d "{\"context\":{\"kind\":\"table\",\"qrRef\":\"t_DEMO_main_table_12\"},\"fulfillmentType\":\"DINE_IN\",\"lines\":[{\"menuItemId\":\"$ITEM\",\"quantity\":2}]}"
# → { orderId, number, accessToken, trackingUrl, totalMinor: 37800, currency: "INR", status: "PENDING_PAYMENT" }
```
