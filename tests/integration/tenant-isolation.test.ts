import { beforeAll, describe, expect, it } from "vitest";
import type { DataStore } from "@/server/store/types";
import type { StaffActor } from "@/server/auth/actor";
import { DEMO, menuItemId, staffFor } from "../support/fixtures";
import { storeCases } from "../support/stores";
import { getOrderDetail, listOrders, transitionOrder, getKitchenQueue } from "@/server/services/orders";
import { getAdminMenu, setBranchMenuItem, updateMenuItem } from "@/server/services/catalog";
import { listTables, rotateTableQr } from "@/server/services/tables";
import { paymentsOverview, refundOrder } from "@/server/services/payments";
import { salesReport } from "@/server/services/reports";
import { listStaff, updateMembership } from "@/server/services/identity";
import { listBranches, updateBranch, listTenantSummaries } from "@/server/services/tenancy";
import { authorizeStream } from "@/server/realtime/stream";
import { readSignedFile, resolveImageUrl } from "@/server/services/files";

// NT-1 (release blocker): tenant A cannot read or change tenant B's menu,
// orders, payment configuration, reports, files or live events.

describe.each(storeCases)("tenant isolation [$name]", ({ make }) => {
  let store: DataStore;
  let harbour: StaffActor; // tenant B owner
  let spiceOrderId: string;
  let spiceItemId: string;
  let spiceTableId: string;

  beforeAll(async () => {
    store = await make();
    harbour = await staffFor(store, DEMO.users.harbourOwner);
    spiceOrderId = DEMO.liveOrderId;
    spiceItemId = (await menuItemId(store, DEMO.tenantId, "Paneer Tikka")).id;
    spiceTableId = (await store.listTables(DEMO.tenantId, DEMO.mainBranchId))[0].id;
  });

  it("lists contain only the actor's own tenant", async () => {
    expect(harbour.tenant.id).toBe(DEMO.tenant2Id);
    const orders = await listOrders(store, harbour, { page: 1, pageSize: 100 });
    expect(orders.items.every((o) => o.tenantId === DEMO.tenant2Id)).toBe(true);
    expect(orders.items.length).toBeGreaterThan(0);
    const menu = await getAdminMenu(store, harbour);
    expect(menu.items.every((i) => i.tenantId === DEMO.tenant2Id)).toBe(true);
    expect((await listTables(store, harbour)).every((t) => t.tenantId === DEMO.tenant2Id)).toBe(true);
    expect((await listBranches(store, harbour)).every((b) => b.tenantId === DEMO.tenant2Id)).toBe(true);
    expect((await listStaff(store, harbour)).members.every((m) => m.email.endsWith("harbour.demo"))).toBe(true);
    const pay = await paymentsOverview(store, harbour);
    expect(pay.connection?.tenantId).toBe(DEMO.tenant2Id);
    expect(pay.attempts.every((a) => a.tenantId === DEMO.tenant2Id)).toBe(true);
  });

  it("direct access to another tenant's records is indistinguishable from 'not found'", async () => {
    const notFound = { code: "NOT_FOUND" };
    await expect(getOrderDetail(store, harbour, spiceOrderId)).rejects.toMatchObject(notFound);
    await expect(transitionOrder(store, harbour, spiceOrderId, { action: "cancel", expectedVersion: 1, reason: "x" })).rejects.toMatchObject(notFound);
    await expect(refundOrder(store, harbour, spiceOrderId, { amountMinor: 1, reason: "x" }, "key-isolation-1")).rejects.toMatchObject(notFound);
    await expect(rotateTableQr(store, harbour, spiceTableId)).rejects.toMatchObject(notFound);
    await expect(setBranchMenuItem(store, harbour, DEMO.mainBranchId, spiceItemId, { isAvailable: false })).rejects.toMatchObject(notFound);
    await expect(getKitchenQueue(store, harbour, DEMO.mainBranchId)).rejects.toMatchObject(notFound);
    await expect(
      updateBranch(store, harbour, DEMO.mainBranchId, {
        name: "Hacked",
        address: "x",
        phone: null,
        timezone: "UTC",
        taxRateBps: 0,
        serviceChargeBps: 0,
        takeawayEnabled: true,
        deliveryEnabled: false,
        deliveryFeeMinor: 0,
        acceptingOrders: true,
        openingHours: [],
      }),
    ).rejects.toMatchObject(notFound);
    const spiceOwnerMembership = (await store.listMemberships(DEMO.tenantId))[0];
    await expect(updateMembership(store, harbour, spiceOwnerMembership.id, { status: "DISABLED" })).rejects.toMatchObject(notFound);
  });

  it("cannot reference another tenant's category, modifiers or branch in its own writes", async () => {
    const harbourItem = (await store.listMenuItems(DEMO.tenant2Id))[0];
    const spiceCategory = (await store.listCategories(DEMO.tenantId))[0];
    await expect(
      updateMenuItem(store, harbour, harbourItem.id, {
        categoryId: spiceCategory.id,
        name: "x",
        description: "",
        basePriceMinor: 1,
        dietary: null,
        stationId: null,
        imageUrl: null,
        sortOrder: 0,
        variants: [],
        modifierGroupIds: [],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      updateMenuItem(store, harbour, harbourItem.id, {
        categoryId: harbourItem.categoryId,
        name: "x",
        description: "",
        basePriceMinor: 1,
        dietary: null,
        stationId: null,
        imageUrl: `file:${DEMO.tenantId}/00000000-0000-4000-8000-000000000001.png`,
        sortOrder: 0,
        variants: [],
        modifierGroupIds: [],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("reports only include the actor's tenant, per currency", async () => {
    const r = await salesReport(store, harbour, { from: "2020-01-01", to: "2030-01-01" });
    expect(r.byCurrency.map((c) => c.currency)).toEqual(["SGD"]);
    await expect(salesReport(store, harbour, { from: "2020-01-01", to: "2030-01-01", branchId: DEMO.mainBranchId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("live event channels are authorised per tenant and branch", async () => {
    await expect(authorizeStream(store, harbour, { channel: "kitchen", branchId: DEMO.mainBranchId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(authorizeStream(store, harbour, { channel: "order", orderId: spiceOrderId, token: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(authorizeStream(store, null, { channel: "orders", branchId: DEMO.mainBranchId })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    // The guest with the right order token may subscribe to that one order only.
    expect((await authorizeStream(store, null, { channel: "order", orderId: spiceOrderId, token: DEMO.liveOrderToken })).channels).toEqual([
      `order:${spiceOrderId}`,
    ]);
  });

  it("files are served only with a valid signature", async () => {
    const key = `${DEMO.tenantId}/00000000-0000-4000-8000-0000000000aa.png`;
    const signed = new URL(resolveImageUrl(`file:${key}`)!, "http://x");
    await expect(readSignedFile(store, key, signed.searchParams.get("exp"), "0".repeat(64))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      readSignedFile(store, `${DEMO.tenant2Id}/00000000-0000-4000-8000-0000000000aa.png`, signed.searchParams.get("exp"), signed.searchParams.get("sig")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("restaurant roles cannot use platform operations", async () => {
    await expect(listTenantSummaries(store, harbour)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
