import { beforeAll, describe, expect, it } from "vitest";
import type { DataStore } from "@/server/store/types";
import { DEMO, deliver, dineInOrderInput, menuItemId, newKey, orderWithIntent, staffFor, webhookFor } from "../support/fixtures";
import { storeCases } from "../support/stores";
import { getCustomerOrder, placeOrder, quote } from "@/server/services/checkout";
import { transitionOrder } from "@/server/services/orders";
import { setBranchMenuItem, updateMenuItem } from "@/server/services/catalog";
import { createTable, rotateTableQr, updateTable } from "@/server/services/tables";
import { refundOrder } from "@/server/services/payments";

describe.each(storeCases)("orders & checkout [$name]", ({ make }) => {
  let store: DataStore;
  beforeAll(async () => {
    store = await make();
  });

  async function confirmedOrder() {
    const { placed, attempt } = await orderWithIntent(store);
    await deliver(store, webhookFor(attempt));
    return (await store.getOrder(DEMO.tenantId, placed.order.orderId))!;
  }

  it("idempotent order creation: same key → same order; same key + different body → 422", async () => {
    const input = await dineInOrderInput(store);
    const key = newKey("order");
    const a = await placeOrder(store, input, key);
    const b = await placeOrder(store, input, key);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.order.orderId).toBe(a.order.orderId);
    expect(b.order.accessToken).toBe(a.order.accessToken);
    const concurrent = await Promise.all([1, 2, 3].map(async () => placeOrder(store, input, newKey("x")).then((r) => r.order.orderId)));
    expect(new Set(concurrent).size).toBe(3);
    await expect(placeOrder(store, { ...input, lines: [{ ...input.lines[0], quantity: 3 }] }, key)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("parallel requests with the same key create exactly one order", async () => {
    const input = await dineInOrderInput(store);
    const key = newKey("race");
    const results = await Promise.all([1, 2, 3, 4].map(() => placeOrder(store, input, key)));
    expect(new Set(results.map((r) => r.order.orderId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it("NT-6: a stale screen cannot overwrite newer state (409), and illegal transitions are refused", async () => {
    const order = await confirmedOrder();
    const kitchen = await staffFor(store, DEMO.users.kitchen);
    const accepted = await transitionOrder(store, kitchen, order.id, { action: "accept", expectedVersion: order.version, reason: null });
    // A second kitchen tablet still showing the old version tries to reject.
    await expect(transitionOrder(store, kitchen, order.id, { action: "reject", expectedVersion: order.version, reason: "OTHER" })).rejects.toMatchObject({
      code: "STALE_STATE",
      status: 409,
    });
    await expect(transitionOrder(store, kitchen, order.id, { action: "ready", expectedVersion: accepted.order.version, reason: null })).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    // Two concurrent valid requests on the same version: exactly one wins.
    const results = await Promise.allSettled(
      [1, 2].map(() => transitionOrder(store, kitchen, order.id, { action: "start", expectedVersion: accepted.order.version, reason: null })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && (r.reason as { code: string }).code === "STALE_STATE")).toHaveLength(1);
  });

  it("enforces roles server-side on transitions and refunds", async () => {
    const order = await confirmedOrder();
    const cashier = await staffFor(store, DEMO.users.cashier);
    const kitchen = await staffFor(store, DEMO.users.kitchen);
    await expect(transitionOrder(store, cashier, order.id, { action: "accept", expectedVersion: order.version, reason: null })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(transitionOrder(store, kitchen, order.id, { action: "cancel", expectedVersion: order.version, reason: "x" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(refundOrder(store, kitchen, order.id, { amountMinor: 100, reason: "x" }, newKey("r"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(transitionOrder(store, null, order.id, { action: "accept", expectedVersion: order.version, reason: null })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("branch staff cannot act on another branch's orders", async () => {
    // Manager is scoped to Main Street; create a Lake View order.
    const lakeTable = (await store.listTables(DEMO.tenantId, DEMO.lakeBranchId))[0];
    const input = { ...(await dineInOrderInput(store)), context: { kind: "table" as const, qrRef: lakeTable.qrRef } };
    const placed = await placeOrder(store, input, newKey("lake"));
    const manager = await staffFor(store, DEMO.users.manager);
    await expect(transitionOrder(store, manager, placed.order.orderId, { action: "cancel", expectedVersion: 1, reason: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("snapshots survive menu edits; accept revalidates availability (BR-03, BR-07)", async () => {
    const order = await confirmedOrder();
    const owner = await staffFor(store, DEMO.users.owner);
    const tikka = await menuItemId(store, DEMO.tenantId, "Paneer Tikka");
    const write = {
      categoryId: tikka.categoryId,
      name: tikka.name,
      description: tikka.description,
      basePriceMinor: tikka.basePriceMinor,
      dietary: tikka.dietary,
      stationId: tikka.stationId,
      imageUrl: tikka.imageUrl,
      sortOrder: tikka.sortOrder,
      variants: [],
      modifierGroupIds: tikka.modifierGroupIds,
    };
    try {
      await updateMenuItem(store, owner, tikka.id, { ...write, name: "Paneer Tikka Deluxe", basePriceMinor: 99900 });
      const after = (await store.getOrder(DEMO.tenantId, order.id))!;
      expect(after.items[0]).toMatchObject({ nameSnapshot: "Paneer Tikka", unitPriceMinor: 26000 });

      await setBranchMenuItem(store, owner, DEMO.mainBranchId, tikka.id, { isAvailable: false });
      const kitchen = await staffFor(store, DEMO.users.kitchen);
      await expect(transitionOrder(store, kitchen, order.id, { action: "accept", expectedVersion: after.version, reason: null })).rejects.toMatchObject({
        code: "ITEM_UNAVAILABLE",
      });
      await expect(
        quote(store, {
          context: { kind: "table", qrRef: DEMO.table12QrRef },
          fulfillmentType: "DINE_IN",
          lines: [{ menuItemId: tikka.id, variantId: null, modifierOptionIds: [], quantity: 1, notes: null }],
        }),
      ).rejects.toMatchObject({ code: "ITEM_UNAVAILABLE" });
    } finally {
      await updateMenuItem(store, owner, tikka.id, write);
      await setBranchMenuItem(store, owner, DEMO.mainBranchId, tikka.id, { isAvailable: true });
    }
  });

  it("revoked, rotated or disabled QR codes cannot place orders (FR-03)", async () => {
    const owner = await staffFor(store, DEMO.users.owner);
    const base = await dineInOrderInput(store);
    await expect(placeOrder(store, { ...base, context: { kind: "table", qrRef: DEMO.revokedQrRef } }, newKey("qr"))).rejects.toMatchObject({
      code: "QR_INVALID",
    });
    await expect(placeOrder(store, { ...base, context: { kind: "table", qrRef: "t_does_not_exist" } }, newKey("qr"))).rejects.toMatchObject({
      code: "QR_INVALID",
    });

    const table = await createTable(store, owner, DEMO.mainBranchId, { label: `QR test ${Date.now()}`, area: null, seats: 2 });
    const oldRef = table.qrRef;
    const rotated = await rotateTableQr(store, owner, table.id);
    await expect(placeOrder(store, { ...base, context: { kind: "table", qrRef: oldRef } }, newKey("qr"))).rejects.toMatchObject({ code: "QR_INVALID" });
    expect((await placeOrder(store, { ...base, context: { kind: "table", qrRef: rotated.qrRef } }, newKey("qr"))).created).toBe(true);
    await updateTable(store, owner, table.id, { status: "DISABLED" });
    await expect(placeOrder(store, { ...base, context: { kind: "table", qrRef: rotated.qrRef } }, newKey("qr"))).rejects.toMatchObject({ code: "QR_INVALID" });
  });

  it("customer order view requires the order token", async () => {
    const placed = await placeOrder(store, await dineInOrderInput(store), newKey("tok"));
    await expect(getCustomerOrder(store, placed.order.orderId, "x".repeat(40))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getCustomerOrder(store, placed.order.orderId, null)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getCustomerOrder(store, placed.order.orderId, placed.order.accessToken)).number).toBe(placed.order.number);
  });

  it("takeaway follows ready → picked up → completed (FR-12)", async () => {
    const tikka = await menuItemId(store, DEMO.tenantId, "Veg Spring Rolls");
    const { placed, attempt } = await orderWithIntent(store, {
      context: { kind: "branch", tenantSlug: "spice-route", branchId: DEMO.mainBranchId },
      fulfillmentType: "TAKEAWAY",
      lines: [{ menuItemId: tikka.id, variantId: null, modifierOptionIds: [], quantity: 1, notes: null }],
      customer: { name: "Test", phone: "+91 98450 11111", address: null },
      notes: null,
    });
    await deliver(store, webhookFor(attempt));
    const kitchen = await staffFor(store, DEMO.users.kitchen);
    let v = (await store.getOrder(DEMO.tenantId, placed.order.orderId))!.version;
    for (const action of ["accept", "start", "ready"] as const)
      v = (await transitionOrder(store, kitchen, placed.order.orderId, { action, expectedVersion: v, reason: null })).order.version;
    const cashier = await staffFor(store, DEMO.users.cashier);
    await expect(transitionOrder(store, cashier, placed.order.orderId, { action: "serve", expectedVersion: v, reason: null })).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    const done = await transitionOrder(store, cashier, placed.order.orderId, { action: "pickup", expectedVersion: v, reason: null });
    expect(done.order.status).toBe("COMPLETED");
  });
});
