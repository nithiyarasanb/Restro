import type { Order, PaymentAttempt, PaymentStatus, Refund } from "@/types/domain";
import type { PaymentIntentView, PaymentsOverviewView } from "@/types/api";
import type { RefundInput } from "@/lib/validation";
import type { DataStore } from "@/server/store/types";
import { UniqueViolationError } from "@/server/store/types";
import { DomainError, notFound } from "@/server/errors";
import { requirePermission, type Actor, type StaffActor } from "@/server/auth/actor";
import { enqueueOrderEvent, relayOutbox } from "@/server/realtime/outbox";
import { getProvider, type ProviderWebhookEvent } from "@/server/payments/provider";
import { verifyOrderAccess } from "./checkout";
import { audit, toAttemptView } from "./shared";

// Payments module (FR-05, BR-08, NT-2…NT-5, NT-9). A browser redirect never
// changes payment state; only a verified webhook or provider reconciliation does.

const OPEN_ATTEMPT: readonly PaymentStatus[] = ["CREATED", "PENDING", "AUTHORIZED"];
const CAPTURABLE: readonly PaymentStatus[] = ["CREATED", "PENDING", "AUTHORIZED", "FAILED", "CANCELLED"];
export const UNPAID_ORDER_TIMEOUT_MS = 30 * 60 * 1000;
const RECONCILE_AFTER_MS = 2 * 60 * 1000;

export async function createPaymentIntent(
  store: DataStore,
  input: { orderId: string; token: string | null; idempotencyKey: string; origin: string },
): Promise<PaymentIntentView> {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.idempotencyKey)) throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
  const order = await store.getOrderUnscoped(input.orderId);
  if (!order || !verifyOrderAccess(order, input.token)) throw notFound("Order");

  const existing = await store.findPaymentAttemptByIdempotencyKey(order.tenantId, input.idempotencyKey);
  if (existing) {
    if (existing.orderId !== order.id) throw new DomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key already used for another order");
    return { attemptId: existing.id, checkoutUrl: existing.checkoutUrl ?? "", status: existing.status, provider: existing.provider };
  }
  if (order.status !== "PENDING_PAYMENT") throw new DomainError("PAYMENT_NOT_ALLOWED", "This order no longer needs payment");
  const attempts = await store.listPaymentAttempts(order.tenantId, { orderId: order.id, limit: 50 });
  if (attempts.some((a) => a.status === "CAPTURED")) throw new DomainError("PAYMENT_NOT_ALLOWED", "This order is already paid");

  const connection = await store.getPaymentConnection(order.tenantId);
  if (!connection || connection.status !== "ACTIVE") throw new DomainError("PAYMENT_NOT_ALLOWED", "Online payment is not set up for this restaurant");
  const provider = await getProvider(connection.provider);

  let attempt: PaymentAttempt;
  try {
    attempt = await store.tx(async (tx) => {
      const now = new Date().toISOString();
      const a = await tx.createPaymentAttempt({
        tenantId: order.tenantId,
        orderId: order.id,
        provider: connection.provider,
        providerAccountId: connection.merchantAccountId,
        providerPaymentId: null,
        amountMinor: order.totalMinor,
        currency: order.currency,
        status: "CREATED",
        idempotencyKey: input.idempotencyKey,
        checkoutUrl: null,
        failureReason: null,
        reviewFlag: null,
        lastEventAt: null,
        createdAt: now,
        updatedAt: now,
      });
      await tx.updateOrderFields(order.tenantId, order.id, { paymentStatus: "PENDING" });
      return a;
    });
  } catch (e) {
    if (e instanceof UniqueViolationError) return createPaymentIntent(store, input);
    throw e;
  }

  const returnUrl = `/order/${order.id}?t=${encodeURIComponent(input.token ?? "")}&from=payment`;
  let intent: { paymentId: string; checkoutUrl: string };
  try {
    intent = await provider.createIntent({
      reference: attempt.id,
      amountMinor: attempt.amountMinor,
      currency: attempt.currency,
      accountId: attempt.providerAccountId,
      description: `Order #${order.number}`,
      returnUrl,
      origin: input.origin,
    });
  } catch (e) {
    await store.casPaymentAttempt(attempt.id, ["CREATED"], { status: "FAILED", failureReason: "Provider unavailable" });
    console.error("[payments] createIntent failed", e);
    throw new DomainError("PROVIDER_ERROR", "The payment provider is unavailable. Please try again.");
  }
  const updated = await store.casPaymentAttempt(attempt.id, ["CREATED"], {
    status: "PENDING",
    providerPaymentId: intent.paymentId,
    checkoutUrl: intent.checkoutUrl,
  });
  return { attemptId: attempt.id, checkoutUrl: intent.checkoutUrl, status: updated?.status ?? "PENDING", provider: provider.key };
}

type ApplyOutcome = "PROCESSED" | "IGNORED_STALE" | "REJECTED";

/** Validates provider facts against our attempt (account, reference, amount, currency). */
function mismatchReason(attempt: PaymentAttempt, ev: Pick<ProviderWebhookEvent, "accountId" | "amountMinor" | "currency" | "paymentId">): string | null {
  if (ev.accountId !== attempt.providerAccountId) return "Merchant account mismatch: the event is for a different provider account";
  if (attempt.providerPaymentId && ev.paymentId !== attempt.providerPaymentId) return "Payment id mismatch: the event refers to a different provider payment";
  if (ev.currency !== attempt.currency) return `Currency mismatch: expected ${attempt.currency}, got ${ev.currency}`;
  if (ev.amountMinor !== attempt.amountMinor) return `Amount mismatch: expected ${attempt.amountMinor}, got ${ev.amountMinor}`;
  return null;
}

async function flagForReview(store: DataStore, attempt: PaymentAttempt, reason: string) {
  await store.casPaymentAttempt(attempt.id, [...CAPTURABLE, "CAPTURED"], { reviewFlag: reason });
  await audit(store, null, {
    tenantId: attempt.tenantId,
    action: "payment.flagged_for_review",
    entityType: "payment_attempt",
    entityId: attempt.id,
    meta: { reason, orderId: attempt.orderId },
  });
  // Alert hook: in production this log line is wired to an alarm (docs/05-operations.md).
  console.warn(JSON.stringify({ level: "warn", alert: "PAYMENT_MISMATCH", attemptId: attempt.id, orderId: attempt.orderId, reason }));
}

/**
 * Apply a verified capture. One transaction: attempt CAPTURED, order CONFIRMED,
 * exactly one kitchen ticket, outbox rows. Duplicate or late captures are no-ops
 * (or trigger a refund when the order cannot take the money).
 */
export async function applyCapture(store: DataStore, attempt: PaymentAttempt, providerPaymentId: string): Promise<ApplyOutcome> {
  let refundNeeded: { order: Order; reason: string } | null = null;
  const outcome = await store.tx(async (tx): Promise<ApplyOutcome> => {
    const now = new Date().toISOString();
    const captured = await tx.casPaymentAttempt(attempt.id, CAPTURABLE, { status: "CAPTURED", providerPaymentId, lastEventAt: now, failureReason: null });
    if (!captured) return "IGNORED_STALE"; // already captured: duplicate or out-of-order delivery

    const order = await tx.getOrder(attempt.tenantId, attempt.orderId);
    if (!order) throw new Error(`Order ${attempt.orderId} missing for attempt ${attempt.id}`);
    const confirmed = await tx.casOrder(
      order.tenantId,
      order.id,
      { statuses: ["PENDING_PAYMENT"] },
      { status: "CONFIRMED", paymentStatus: "CAPTURED", confirmedAt: now },
    );
    if (!confirmed) {
      // Money arrived for an order that already moved on (cancelled by timeout, or paid by another attempt).
      refundNeeded = {
        order,
        reason:
          order.paymentStatus === "CAPTURED" ? "Duplicate payment for an already-paid order" : `Payment captured after order was ${order.status.toLowerCase()}`,
      };
      return "PROCESSED";
    }
    await tx.addStatusHistory({
      tenantId: order.tenantId,
      orderId: order.id,
      fromStatus: "PENDING_PAYMENT",
      toStatus: "CONFIRMED",
      actorKind: "SYSTEM",
      actorUserId: null,
      actorLabel: "Payment verified",
      reason: null,
      createdAt: now,
    });
    const ticket = await tx.createKitchenTicket({ tenantId: order.tenantId, branchId: order.branchId, orderId: order.id, stationId: null, createdAt: now });
    if (ticket) await enqueueOrderEvent(tx, "order.created", confirmed);
    await enqueueOrderEvent(tx, "payment.updated", confirmed);
    return "PROCESSED";
  });
  if (refundNeeded) {
    const { order, reason } = refundNeeded as { order: Order; reason: string };
    await flagForReview(store, attempt, reason);
    await issueRefund(store, null, { order, attemptId: attempt.id, amountMinor: attempt.amountMinor, reason, idempotencyKey: `auto-refund:${attempt.id}` });
  }
  await relayOutbox(store);
  return outcome;
}

export async function applyFailure(store: DataStore, attempt: PaymentAttempt, reason: string | null): Promise<ApplyOutcome> {
  const outcome = await store.tx(async (tx): Promise<ApplyOutcome> => {
    const failed = await tx.casPaymentAttempt(attempt.id, OPEN_ATTEMPT, {
      status: "FAILED",
      failureReason: reason ?? "Payment failed",
      lastEventAt: new Date().toISOString(),
    });
    if (!failed) return "IGNORED_STALE"; // e.g. a late "failed" after a capture must not undo it
    const order = await tx.getOrder(attempt.tenantId, attempt.orderId);
    if (order && order.status === "PENDING_PAYMENT" && order.paymentStatus !== "CAPTURED") {
      const updated = await tx.updateOrderFields(order.tenantId, order.id, { paymentStatus: "FAILED" });
      if (updated) await enqueueOrderEvent(tx, "payment.updated", updated);
    }
    return "PROCESSED";
  });
  await relayOutbox(store);
  return outcome;
}

/** POST /webhooks/payments/{provider}. Raw body is required for signature verification. */
export async function handleWebhook(store: DataStore, providerKey: string, rawBody: string, headers: Headers) {
  if (providerKey !== "mock") throw notFound("Provider");
  const provider = await getProvider(providerKey);
  const ev = provider.verifyWebhook(rawBody, headers); // throws 401 on bad signature — no state change

  const { inserted, event } = await store.insertWebhookEvent({
    provider: provider.key,
    eventId: ev.eventId,
    type: ev.type,
    tenantId: null,
    attemptId: null,
    outcome: "RECEIVED",
    error: null,
    receivedAt: new Date().toISOString(),
    processedAt: null,
  });
  // Persisted event id first; a second delivery of a processed event is a no-op.
  if (!inserted && event.outcome !== "RECEIVED") return { received: true, duplicate: true, outcome: "DUPLICATE" as const };

  const finish = async (outcome: "PROCESSED" | "REJECTED" | "IGNORED_STALE", error: string | null, tenantId: string | null, attemptId: string | null) => {
    await store.updateWebhookEvent(event.id, { outcome, error, processedAt: new Date().toISOString(), tenantId, attemptId });
    return { received: true, duplicate: false, outcome };
  };

  const attempt = await store.getPaymentAttemptUnscoped(ev.reference);
  if (!attempt || attempt.provider !== provider.key) return finish("REJECTED", "Unknown payment reference", null, null);
  const mismatch = mismatchReason(attempt, ev);
  if (mismatch) {
    await flagForReview(store, attempt, mismatch);
    return finish("REJECTED", mismatch, attempt.tenantId, attempt.id);
  }
  // Out-of-order protection: only move forward; ignore events older than what we already applied.
  if (attempt.lastEventAt && ev.occurredAt < attempt.lastEventAt && ev.type !== "payment.captured")
    return finish("IGNORED_STALE", "Older than the last applied event", attempt.tenantId, attempt.id);

  let outcome: ApplyOutcome = "IGNORED_STALE";
  if (ev.type === "payment.captured") outcome = await applyCapture(store, attempt, ev.paymentId);
  else if (ev.type === "payment.failed") outcome = await applyFailure(store, attempt, ev.failureReason);
  else if (ev.type === "payment.authorized") {
    const a = await store.casPaymentAttempt(attempt.id, ["CREATED", "PENDING"], { status: "AUTHORIZED", lastEventAt: ev.occurredAt });
    outcome = a ? "PROCESSED" : "IGNORED_STALE";
  }
  return finish(outcome, null, attempt.tenantId, attempt.id);
}

// ── Refunds ───────────────────────────────────────────────────────────────

async function refundableMinor(store: DataStore, order: Order): Promise<number> {
  const refunds = await store.listRefunds(order.tenantId, { orderId: order.id, limit: 100 });
  const committed = refunds.filter((r) => r.status !== "FAILED").reduce((s, r) => s + r.amountMinor, 0);
  return Math.max(0, (order.paymentStatus === "CAPTURED" || order.paymentStatus === "PARTIALLY_REFUNDED" ? order.totalMinor : 0) - committed);
}
export { refundableMinor };

/**
 * Create (idempotently) and execute a refund. The refund row is committed as
 * PENDING before calling the provider; a provider failure leaves it FAILED —
 * never reported as successful (NT-9).
 */
export async function issueRefund(
  store: DataStore,
  actor: StaffActor | null,
  input: { order: Order; attemptId?: string; amountMinor: number; reason: string; idempotencyKey: string },
): Promise<Refund> {
  const { order } = input;
  const existing = await store.findRefundByIdempotencyKey(order.tenantId, input.idempotencyKey);
  if (existing) return existing.status === "FAILED" ? executeRefund(store, existing) : existing;

  const attempts = await store.listPaymentAttempts(order.tenantId, { orderId: order.id, limit: 50 });
  const attempt = input.attemptId ? attempts.find((a) => a.id === input.attemptId) : attempts.find((a) => a.status === "CAPTURED");
  if (!attempt || !attempt.providerPaymentId || (attempt.status !== "CAPTURED" && !input.attemptId))
    throw new DomainError("REFUND_NOT_ALLOWED", "There is no captured payment to refund");
  // Auto-refunds of a stray duplicate capture are bounded by that attempt, not the order.
  const limit = input.attemptId ? attempt.amountMinor : await refundableMinor(store, order);
  if (input.amountMinor > limit) throw new DomainError("REFUND_NOT_ALLOWED", `Refund exceeds the refundable amount (${limit})`);

  const now = new Date().toISOString();
  let refund: Refund;
  try {
    refund = await store.createRefund({
      tenantId: order.tenantId,
      orderId: order.id,
      attemptId: attempt.id,
      amountMinor: input.amountMinor,
      currency: order.currency,
      status: "PENDING",
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      providerRefundId: null,
      failureReason: null,
      requestedByUserId: actor?.user.id ?? null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (e) {
    if (e instanceof UniqueViolationError) return (await store.findRefundByIdempotencyKey(order.tenantId, input.idempotencyKey))!;
    throw e;
  }
  await audit(store, actor, {
    tenantId: order.tenantId,
    action: "refund.requested",
    entityType: "refund",
    entityId: refund.id,
    meta: { orderId: order.id, amountMinor: refund.amountMinor, reason: refund.reason },
  });
  return executeRefund(store, refund);
}

async function executeRefund(store: DataStore, refund: Refund): Promise<Refund> {
  const attempt = await store.getPaymentAttempt(refund.tenantId, refund.attemptId);
  if (!attempt?.providerPaymentId) throw new DomainError("REFUND_NOT_ALLOWED", "Payment reference missing");
  const provider = await getProvider(attempt.provider);
  if (refund.status === "FAILED") await store.updateRefund(refund.tenantId, refund.id, { status: "PENDING", failureReason: null });

  let result: Awaited<ReturnType<typeof provider.refund>>;
  try {
    result = await provider.refund({
      paymentId: attempt.providerPaymentId,
      amountMinor: refund.amountMinor,
      currency: refund.currency,
      idempotencyKey: refund.idempotencyKey,
      reason: refund.reason,
    });
  } catch (e) {
    result = { ok: false, reason: e instanceof Error ? e.message : "Provider error" };
  }
  if (!result.ok) {
    const failed = await store.updateRefund(refund.tenantId, refund.id, { status: "FAILED", failureReason: result.reason });
    console.warn(JSON.stringify({ level: "warn", alert: "REFUND_FAILED", refundId: refund.id, reason: result.reason }));
    return failed!;
  }
  const providerRefundId = result.refundId;
  return store.tx(async (tx) => {
    const done = await tx.updateRefund(refund.tenantId, refund.id, { status: "SUCCEEDED", providerRefundId });
    const order = await tx.getOrder(refund.tenantId, refund.orderId);
    if (order && attempt.status === "CAPTURED" && order.paymentStatus !== "CREATED") {
      const refundedMinor = order.refundedMinor + refund.amountMinor;
      // A stray duplicate capture refunded in full leaves the order's own payment untouched.
      const strayDuplicate =
        refund.idempotencyKey.startsWith("auto-refund:") &&
        order.confirmedAt &&
        order.paymentStatus === "CAPTURED" &&
        refund.amountMinor === attempt.amountMinor;
      if (!strayDuplicate) {
        const updated = await tx.updateOrderFields(order.tenantId, order.id, {
          refundedMinor,
          paymentStatus: refundedMinor >= order.totalMinor ? "REFUNDED" : "PARTIALLY_REFUNDED",
        });
        if (updated) await enqueueOrderEvent(tx, "payment.updated", updated);
      }
    }
    return done!;
  });
}

export async function refundOrder(store: DataStore, actor: Actor | null, orderId: string, input: RefundInput, idempotencyKey: string) {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey)) throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
  const staff = requirePermission(actor, "payments.refund");
  const order = await store.getOrder(staff.tenant.id, orderId);
  if (!order) throw notFound("Order");
  requirePermission(actor, "payments.refund", order.branchId);
  const refund = await issueRefund(store, staff, { order, amountMinor: input.amountMinor, reason: input.reason, idempotencyKey });
  await relayOutbox(store);
  return refund;
}

export async function retryRefund(store: DataStore, actor: Actor | null, refundId: string) {
  const staff = requirePermission(actor, "payments.refund");
  const refunds = await store.listRefunds(staff.tenant.id, { limit: 1000 });
  const refund = refunds.find((r) => r.id === refundId);
  if (!refund) throw notFound("Refund");
  const order = await store.getOrder(staff.tenant.id, refund.orderId);
  if (!order) throw notFound("Order");
  requirePermission(actor, "payments.refund", order.branchId);
  if (refund.status !== "FAILED") throw new DomainError("CONFLICT", "Only failed refunds can be retried");
  await audit(store, staff, { tenantId: staff.tenant.id, action: "refund.retried", entityType: "refund", entityId: refund.id });
  const result = await executeRefund(store, refund);
  await relayOutbox(store);
  return result;
}

// ── Reconciliation ────────────────────────────────────────────────────────

/**
 * Polls the provider for attempts that never received a webhook and cancels
 * unpaid orders after the timeout. Runs on a schedule and on demand.
 */
export async function reconcile(store: DataStore, opts: { tenantId?: string; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const result = { checked: 0, captured: 0, failed: 0, cancelledOrders: 0 };
  const pending = await store.listPaymentAttempts(opts.tenantId ?? null, {
    statuses: ["CREATED", "PENDING", "AUTHORIZED"],
    olderThan: new Date(now.getTime() - RECONCILE_AFTER_MS).toISOString(),
    limit: 200,
  });
  for (const attempt of pending) {
    if (!attempt.providerPaymentId) continue;
    result.checked++;
    const provider = await getProvider(attempt.provider);
    const p = await provider.fetchPayment(attempt.providerPaymentId);
    if (!p) continue;
    if (p.status === "CAPTURED") {
      const mismatch = mismatchReason(attempt, { ...p, paymentId: p.paymentId });
      if (mismatch) await flagForReview(store, attempt, mismatch);
      else if ((await applyCapture(store, attempt, p.paymentId)) === "PROCESSED") result.captured++;
    } else if (p.status === "FAILED") {
      if ((await applyFailure(store, attempt, p.failureReason)) === "PROCESSED") result.failed++;
    }
  }

  // Unpaid orders past the timeout are cancelled by the system.
  const tenants = opts.tenantId ? [opts.tenantId] : (await store.listTenants()).map((t) => t.id);
  const cutoff = new Date(now.getTime() - UNPAID_ORDER_TIMEOUT_MS).toISOString();
  for (const tenantId of tenants) {
    const { items } = await store.listOrders(tenantId, { statuses: ["PENDING_PAYMENT"], createdTo: cutoff, offset: 0, limit: 200 });
    for (const order of items) {
      const cancelled = await store.tx(async (tx) => {
        const o = await tx.casOrder(
          tenantId,
          order.id,
          { statuses: ["PENDING_PAYMENT"], version: order.version },
          {
            status: "CANCELLED",
            cancelReason: "Payment not completed within 30 minutes",
            paymentStatus: order.paymentStatus === "CREATED" ? "CANCELLED" : order.paymentStatus,
          },
        );
        if (!o) return null;
        await tx.addStatusHistory({
          tenantId,
          orderId: o.id,
          fromStatus: "PENDING_PAYMENT",
          toStatus: "CANCELLED",
          actorKind: "SYSTEM",
          actorUserId: null,
          actorLabel: "System",
          reason: "Payment timeout",
          createdAt: now.toISOString(),
        });
        await enqueueOrderEvent(tx, "order.updated", o);
        return o;
      });
      if (cancelled) result.cancelledOrders++;
    }
  }
  await relayOutbox(store);
  return result;
}

export async function runReconciliation(store: DataStore, actor: Actor | null) {
  const staff = requirePermission(actor, "payments.configure");
  const result = await reconcile(store, { tenantId: staff.tenant.id });
  await audit(store, staff, {
    tenantId: staff.tenant.id,
    action: "payments.reconciliation_run",
    entityType: "tenant",
    entityId: staff.tenant.id,
    meta: result,
  });
  return result;
}

export async function paymentsOverview(store: DataStore, actor: Actor | null): Promise<PaymentsOverviewView> {
  const staff = requirePermission(actor, "payments.refund");
  const tenantId = staff.tenant.id;
  const [connection, attempts, refunds, webhookEvents, unpaid] = await Promise.all([
    store.getPaymentConnection(tenantId),
    store.listPaymentAttempts(tenantId, { limit: 50 }),
    store.listRefunds(tenantId, { limit: 50 }),
    store.listWebhookEvents(tenantId, 20),
    store.listOrders(tenantId, { statuses: ["PENDING_PAYMENT"], createdTo: new Date(Date.now() - UNPAID_ORDER_TIMEOUT_MS).toISOString(), offset: 0, limit: 1 }),
  ]);
  const scoped = staff.branchScope;
  const orderIds = new Set([...attempts.map((a) => a.orderId), ...refunds.map((r) => r.orderId)]);
  const orders = new Map<string, Order>();
  for (const id of orderIds) {
    const o = await store.getOrder(tenantId, id);
    if (o) orders.set(id, o);
  }
  const inScope = (orderId: string) => {
    const o = orders.get(orderId);
    return !!o && (scoped === "ALL" || scoped.includes(o.branchId));
  };
  const allPending = await store.listPaymentAttempts(tenantId, { statuses: ["CREATED", "PENDING", "AUTHORIZED"], limit: 1000 });
  const allAttempts = await store.listPaymentAttempts(tenantId, { limit: 5000 });
  const allRefunds = await store.listRefunds(tenantId, { limit: 5000 });
  return {
    connection: staff.role === "OWNER" ? connection : connection ? { ...connection, merchantAccountId: "••••" } : null,
    attempts: attempts.filter((a) => inScope(a.orderId)).map((a) => ({ ...toAttemptView(a), orderNumber: orders.get(a.orderId)?.number ?? null })),
    refunds: refunds.filter((r) => inScope(r.orderId)).map((r) => ({ ...r, orderNumber: orders.get(r.orderId)?.number ?? null })),
    webhookEvents: staff.role === "OWNER" ? webhookEvents : [],
    reconciliation: {
      pendingAttempts: allPending.length,
      flaggedAttempts: allAttempts.filter((a) => a.reviewFlag).length,
      failedRefunds: allRefunds.filter((r) => r.status === "FAILED").length,
      staleUnpaidOrders: unpaid.total,
    },
  };
}
