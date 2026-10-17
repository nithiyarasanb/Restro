import { beforeAll, describe, expect, it } from "vitest";
import type { DataStore } from "@/server/store/types";
import { actorFor, DEMO, deliver, menuItemId, orderWithIntent, staffFor, webhookFor } from "../support/fixtures";
import { storeCases } from "../support/stores";
import { assignRunner, listMyJobs, recordDeliveryEvent } from "@/server/services/fulfillment";
import { transitionOrder } from "@/server/services/orders";
import { acceptInvitation, inviteStaff } from "@/server/services/identity";

describe.each(storeCases)("restaurant-managed delivery [$name]", ({ make }) => {
  let store: DataStore;
  beforeAll(async () => {
    store = await make();
  });

  async function readyDeliveryOrder() {
    const item = await menuItemId(store, DEMO.tenantId, "Veg Biryani");
    const { placed, attempt } = await orderWithIntent(store, {
      context: { kind: "branch", tenantSlug: "spice-route", branchId: DEMO.mainBranchId },
      fulfillmentType: "DELIVERY",
      lines: [{ menuItemId: item.id, variantId: null, modifierOptionIds: [], quantity: 1, notes: null }],
      customer: { name: "Guest", phone: "+91 98450 22222", address: "1 Test Road" },
      notes: null,
    });
    await deliver(store, webhookFor(attempt));
    const kitchen = await staffFor(store, DEMO.users.kitchen);
    let v = (await store.getOrder(DEMO.tenantId, placed.order.orderId))!.version;
    for (const action of ["accept", "start", "ready"] as const)
      v = (await transitionOrder(store, kitchen, placed.order.orderId, { action, expectedVersion: v, reason: null })).order.version;
    return placed.order.orderId;
  }

  it("assigned runner completes the job: picked up → delivered → completed", async () => {
    const orderId = await readyDeliveryOrder();
    const manager = await staffFor(store, DEMO.users.manager);
    const runner = await staffFor(store, DEMO.users.runner);
    const a = await assignRunner(store, manager, orderId, { runnerUserId: runner.user.id, note: null });
    expect((await listMyJobs(store, runner)).some((j) => j.orderId === orderId)).toBe(true);
    await recordDeliveryEvent(store, runner, a.id, { type: "PICKED_UP", note: null });
    expect((await store.getOrder(DEMO.tenantId, orderId))?.status).toBe("OUT_FOR_DELIVERY");
    await recordDeliveryEvent(store, runner, a.id, { type: "DELIVERED", note: null });
    expect((await store.getOrder(DEMO.tenantId, orderId))?.status).toBe("COMPLETED");
  });

  it("NT-8: another runner cannot see or update a job that isn't theirs", async () => {
    const orderId = await readyDeliveryOrder();
    const owner = await staffFor(store, DEMO.users.owner);
    const runner = await staffFor(store, DEMO.users.runner);
    const a = await assignRunner(store, owner, orderId, { runnerUserId: runner.user.id, note: "gate code 42" });

    // A second runner joins the same branch via invitation.
    const email = `runner2-${Date.now()}@spiceroute.demo`;
    const { inviteUrl } = await inviteStaff(store, owner, { email, role: "RUNNER", branchIds: [DEMO.mainBranchId] });
    await acceptInvitation(store, inviteUrl.split("/invite/")[1], { name: "Second Runner", password: "Runner12345" }, `t-${Date.now()}`);
    const other = await actorFor(store, email);

    expect((await listMyJobs(store, other)).some((j) => j.orderId === orderId)).toBe(false);
    await expect(recordDeliveryEvent(store, other, a.id, { type: "PICKED_UP", note: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The kitchen (non-runner) cannot either.
    await expect(recordDeliveryEvent(store, await staffFor(store, DEMO.users.kitchen), a.id, { type: "PICKED_UP", note: null })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await store.getOrder(DEMO.tenantId, orderId))?.status).toBe("READY");
  });

  it("failed delivery requires a reason and starts a refund", async () => {
    const orderId = await readyDeliveryOrder();
    const runner = await staffFor(store, DEMO.users.runner);
    const a = await assignRunner(store, await staffFor(store, DEMO.users.manager), orderId, { runnerUserId: runner.user.id, note: null });
    await recordDeliveryEvent(store, runner, a.id, { type: "PICKED_UP", note: null });
    await expect(recordDeliveryEvent(store, runner, a.id, { type: "FAILED", note: null })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await recordDeliveryEvent(store, runner, a.id, { type: "FAILED", note: "Customer unreachable" });
    const order = await store.getOrder(DEMO.tenantId, orderId);
    expect(order).toMatchObject({ status: "DELIVERY_FAILED", paymentStatus: "REFUNDED" });
  });

  it("only active runners of the order's branch can be assigned; never twice", async () => {
    const orderId = await readyDeliveryOrder();
    const manager = await staffFor(store, DEMO.users.manager);
    const kitchen = await staffFor(store, DEMO.users.kitchen);
    await expect(assignRunner(store, manager, orderId, { runnerUserId: kitchen.user.id, note: null })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const runner = await staffFor(store, DEMO.users.runner);
    const a = await assignRunner(store, manager, orderId, { runnerUserId: runner.user.id, note: null });
    await recordDeliveryEvent(store, runner, a.id, { type: "PICKED_UP", note: null });
    await expect(assignRunner(store, manager, orderId, { runnerUserId: runner.user.id, note: null })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});
