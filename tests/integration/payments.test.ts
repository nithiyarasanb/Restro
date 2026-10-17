import { beforeAll, describe, expect, it } from "vitest";
import type { DataStore } from "@/server/store/types";
import { DEMO, deliver, dineInOrderInput, newKey, orderWithIntent, staffFor, webhookFor } from "../support/fixtures";
import { storeCases } from "../support/stores";
import { getCustomerOrder, placeOrder } from "@/server/services/checkout";
import { createPaymentIntent, handleWebhook, reconcile, refundOrder, retryRefund } from "@/server/services/payments";
import { getKitchenQueue, transitionOrder } from "@/server/services/orders";
import { buildMockWebhook, MOCK_REFUND_FAILURE_MARKER, settleMockPaymentSilently } from "@/server/payments/mock-provider";
import { DomainError } from "@/server/errors";

describe.each(storeCases)("payments [$name]", ({ make }) => {
  let store: DataStore;
  beforeAll(async () => {
    store = await make();
  });

  it("happy path: verified webhook confirms, creates one ticket, kitchen → handover → completed (journey B)", async () => {
    const { placed, attempt } = await orderWithIntent(store);
    expect(placed.order.totalMinor).toBe(54600); // 2 × ₹260 + 5 % tax
    expect((await deliver(store, webhookFor(attempt))).outcome).toBe("PROCESSED");

    const kitchen = await staffFor(store, DEMO.users.kitchen);
    const ticket = (await getKitchenQueue(store, kitchen, DEMO.mainBranchId)).tickets.find((t) => t.orderId === placed.order.orderId)!;
    expect(ticket.status).toBe("CONFIRMED");
    let v = ticket.version;
    for (const action of ["accept", "start", "ready"] as const)
      v = (await transitionOrder(store, kitchen, placed.order.orderId, { action, expectedVersion: v, reason: null })).order.version;
    const done = await transitionOrder(store, await staffFor(store, DEMO.users.cashier), placed.order.orderId, {
      action: "serve",
      expectedVersion: v,
      reason: null,
    });
    expect(done.order.status).toBe("COMPLETED");
    const history = await store.listStatusHistory(DEMO.tenantId, placed.order.orderId);
    expect(history.map((h) => h.toStatus)).toEqual(["PENDING_PAYMENT", "CONFIRMED", "ACCEPTED", "PREPARING", "READY", "SERVED", "COMPLETED"]);
  });

  it("NT-2: a browser redirect alone never confirms a payment", async () => {
    const { placed } = await orderWithIntent(store);
    // The customer returns from the provider page (no webhook arrives).
    const view = await getCustomerOrder(store, placed.order.orderId, placed.order.accessToken);
    expect(view.status).toBe("PENDING_PAYMENT");
    expect(view.paymentStatus).toBe("PENDING");
    expect(await store.countKitchenTickets(DEMO.tenantId, placed.order.orderId)).toBe(0);
  });

  it("NT-3: duplicate and concurrent webhooks create one capture and one ticket", async () => {
    const { placed, attempt } = await orderWithIntent(store);
    const hook = webhookFor(attempt);
    const results = await Promise.all([deliver(store, hook), deliver(store, hook), deliver(store, hook)]);
    expect(results.filter((r) => r.outcome === "PROCESSED")).toHaveLength(1);
    expect(results.filter((r) => r.duplicate || r.outcome === "IGNORED_STALE")).toHaveLength(2);
    // A different event id for the same capture is also a no-op.
    expect((await deliver(store, webhookFor(attempt))).outcome).toBe("IGNORED_STALE");
    expect(await store.countKitchenTickets(DEMO.tenantId, placed.order.orderId)).toBe(1);
    const order = await store.getOrder(DEMO.tenantId, placed.order.orderId);
    expect(order?.status).toBe("CONFIRMED");
  });

  it("NT-4: a failed payment never reaches the kitchen; the guest can retry on the same order", async () => {
    const { placed, attempt } = await orderWithIntent(store);
    expect((await deliver(store, webhookFor(attempt, "payment.failed"))).outcome).toBe("PROCESSED");
    const kitchen = await staffFor(store, DEMO.users.kitchen);
    expect((await getKitchenQueue(store, kitchen, DEMO.mainBranchId)).tickets.some((t) => t.orderId === placed.order.orderId)).toBe(false);
    const view = await getCustomerOrder(store, placed.order.orderId, placed.order.accessToken);
    expect(view).toMatchObject({ status: "PENDING_PAYMENT", paymentStatus: "FAILED", canPay: true });

    const retry = await createPaymentIntent(store, {
      orderId: placed.order.orderId,
      token: placed.order.accessToken,
      idempotencyKey: newKey("retry"),
      origin: "http://localhost:3000",
    });
    const second = (await store.getPaymentAttemptUnscoped(retry.attemptId))!;
    expect(second.id).not.toBe(attempt.id);
    await deliver(store, webhookFor(second));
    expect((await store.getOrder(DEMO.tenantId, placed.order.orderId))?.status).toBe("CONFIRMED");
  });

  it("out-of-order: a late 'failed' event cannot undo a capture", async () => {
    const { placed, attempt } = await orderWithIntent(store);
    await deliver(store, webhookFor(attempt));
    expect((await deliver(store, webhookFor(attempt, "payment.failed"))).outcome).toBe("IGNORED_STALE");
    expect((await store.getOrder(DEMO.tenantId, placed.order.orderId))?.paymentStatus).toBe("CAPTURED");
  });

  it.each([
    ["amount", { amountMinor: 100 }],
    ["currency", { currency: "USD" }],
    ["merchant account", { accountId: "acct_someone_else" }],
  ])("NT-5: %s mismatch is rejected, flagged and audited; the order stays unconfirmed", async (_, overrides) => {
    const { placed, attempt } = await orderWithIntent(store);
    const r = await deliver(store, webhookFor(attempt, "payment.captured", overrides));
    expect(r.outcome).toBe("REJECTED");
    const a = await store.getPaymentAttemptUnscoped(attempt.id);
    expect(a?.status).toBe("PENDING");
    expect(a?.reviewFlag).toMatch(/mismatch/i);
    expect((await store.getOrder(DEMO.tenantId, placed.order.orderId))?.status).toBe("PENDING_PAYMENT");
    const audit = await store.listAudit({ tenantId: DEMO.tenantId, limit: 20, offset: 0 });
    expect(audit.items.some((x) => x.action === "payment.flagged_for_review" && x.entityId === attempt.id)).toBe(true);
  });

  it("rejects an invalid signature with 401 and changes nothing", async () => {
    const { placed, attempt } = await orderWithIntent(store);
    const forged = buildMockWebhook(
      {
        id: `evt_${crypto.randomUUID()}`,
        type: "payment.captured",
        data: {
          paymentId: attempt.providerPaymentId,
          reference: attempt.id,
          accountId: attempt.providerAccountId,
          amountMinor: attempt.amountMinor,
          currency: attempt.currency,
        },
      },
      "wrong-secret-wrong-secret",
    );
    await expect(handleWebhook(store, "mock", forged.rawBody, forged.headers)).rejects.toMatchObject({ code: "INVALID_SIGNATURE", status: 401 });
    // Tampering with the body after signing also fails.
    const good = webhookFor(attempt);
    await expect(handleWebhook(store, "mock", good.rawBody.replace(String(attempt.amountMinor), "1"), good.headers)).rejects.toMatchObject({
      code: "INVALID_SIGNATURE",
    });
    expect((await store.getOrder(DEMO.tenantId, placed.order.orderId))?.status).toBe("PENDING_PAYMENT");
  });

  it("idempotent payment initiation: the same key returns the same attempt", async () => {
    const placed = await placeOrder(store, await dineInOrderInput(store), newKey("order"));
    const key = newKey("pay");
    const a = await createPaymentIntent(store, {
      orderId: placed.order.orderId,
      token: placed.order.accessToken,
      idempotencyKey: key,
      origin: "http://localhost:3000",
    });
    const b = await createPaymentIntent(store, {
      orderId: placed.order.orderId,
      token: placed.order.accessToken,
      idempotencyKey: key,
      origin: "http://localhost:3000",
    });
    expect(b.attemptId).toBe(a.attemptId);
    await expect(
      createPaymentIntent(store, { orderId: placed.order.orderId, token: "wrong-token-123", idempotencyKey: newKey("pay"), origin: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reconciliation resolves a payment whose webhook never arrived, and cancels stale unpaid orders", async () => {
    const { placed, attempt } = await orderWithIntent(store);
    settleMockPaymentSilently(attempt.providerPaymentId!, "CAPTURED");
    const future = new Date(Date.now() + 3 * 60_000);
    await reconcile(store, { tenantId: DEMO.tenantId, now: future });
    expect((await store.getOrder(DEMO.tenantId, placed.order.orderId))?.status).toBe("CONFIRMED");
    expect(await store.countKitchenTickets(DEMO.tenantId, placed.order.orderId)).toBe(1);

    const unpaid = await placeOrder(store, await dineInOrderInput(store), newKey("order"));
    await reconcile(store, { tenantId: DEMO.tenantId, now: new Date(Date.now() + 31 * 60_000) });
    const cancelled = await store.getOrder(DEMO.tenantId, unpaid.order.orderId);
    expect(cancelled).toMatchObject({ status: "CANCELLED", paymentStatus: "CANCELLED" });
  });

  it("NT-9: a failed refund is recorded as FAILED, never as successful, and can be retried", async () => {
    const { placed, attempt } = await orderWithIntent(store);
    await deliver(store, webhookFor(attempt));
    const owner = await staffFor(store, DEMO.users.owner);
    const failed = await refundOrder(
      store,
      owner,
      placed.order.orderId,
      { amountMinor: 10000, reason: `Cold food ${MOCK_REFUND_FAILURE_MARKER}` },
      newKey("refund"),
    );
    expect(failed.status).toBe("FAILED");
    expect(failed.failureReason).toBeTruthy();
    let order = await store.getOrder(DEMO.tenantId, placed.order.orderId);
    expect(order).toMatchObject({ refundedMinor: 0, paymentStatus: "CAPTURED" });

    const ok = await refundOrder(store, owner, placed.order.orderId, { amountMinor: 10000, reason: "Cold food" }, newKey("refund"));
    expect(ok.status).toBe("SUCCEEDED");
    order = await store.getOrder(DEMO.tenantId, placed.order.orderId);
    expect(order).toMatchObject({ refundedMinor: 10000, paymentStatus: "PARTIALLY_REFUNDED" });
    // The failed refund keeps failing while the marker is in its reason — still never "successful".
    expect((await retryRefund(store, owner, failed.id)).status).toBe("FAILED");
  });

  it("refunds are idempotent and cannot exceed what was paid", async () => {
    const { placed, attempt } = await orderWithIntent(store);
    await deliver(store, webhookFor(attempt));
    const owner = await staffFor(store, DEMO.users.owner);
    const key = newKey("refund");
    const a = await refundOrder(store, owner, placed.order.orderId, { amountMinor: 54600, reason: "Full refund" }, key);
    const b = await refundOrder(store, owner, placed.order.orderId, { amountMinor: 54600, reason: "Full refund" }, key);
    expect(b.id).toBe(a.id);
    await expect(refundOrder(store, owner, placed.order.orderId, { amountMinor: 1, reason: "More" }, newKey("refund"))).rejects.toBeInstanceOf(DomainError);
    expect((await store.getOrder(DEMO.tenantId, placed.order.orderId))?.paymentStatus).toBe("REFUNDED");
  });

  it("kitchen rejection of a paid order starts an automatic full refund (A8)", async () => {
    const { placed, attempt } = await orderWithIntent(store);
    await deliver(store, webhookFor(attempt));
    const kitchen = await staffFor(store, DEMO.users.kitchen);
    const order = (await store.getOrder(DEMO.tenantId, placed.order.orderId))!;
    const r = await transitionOrder(store, kitchen, order.id, { action: "reject", expectedVersion: order.version, reason: "OUT_OF_STOCK" });
    expect(r.order.status).toBe("REJECTED");
    expect(r.refund?.status).toBe("SUCCEEDED");
    expect((await store.getOrder(DEMO.tenantId, order.id))?.paymentStatus).toBe("REFUNDED");
  });

  it("a second capture for an already-paid order is refunded automatically and flagged", async () => {
    const { placed, attempt } = await orderWithIntent(store);
    const second = (await store.getPaymentAttemptUnscoped(
      (
        await createPaymentIntent(store, {
          orderId: placed.order.orderId,
          token: placed.order.accessToken,
          idempotencyKey: newKey("pay"),
          origin: "http://localhost:3000",
        })
      ).attemptId,
    ))!;
    await deliver(store, webhookFor(attempt));
    await deliver(store, webhookFor(second));
    const refunds = await store.listRefunds(DEMO.tenantId, { orderId: placed.order.orderId, limit: 10 });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ attemptId: second.id, status: "SUCCEEDED" });
    expect((await store.getPaymentAttemptUnscoped(second.id))?.reviewFlag).toMatch(/Duplicate payment/);
    expect((await store.getOrder(DEMO.tenantId, placed.order.orderId))?.paymentStatus).toBe("CAPTURED");
  });
});
