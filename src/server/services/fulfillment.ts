import type { RunnerJobView } from "@/types/api";
import type { DataStore } from "@/server/store/types";
import { UniqueViolationError } from "@/server/store/types";
import { DomainError, notFound } from "@/server/errors";
import { requirePermission, type Actor } from "@/server/auth/actor";
import { relayOutbox } from "@/server/realtime/outbox";
import { applyTransition } from "./orders";
import { issueRefund, refundableMinor } from "./payments";
import { audit, branchNames } from "./shared";

// Restaurant-managed delivery (FR-13, NT-8). Behind the tenant "delivery"
// entitlement. Runners only ever see their own assignments.

const ASSIGNABLE = ["CONFIRMED", "ACCEPTED", "PREPARING", "READY"] as const;

export async function assignRunner(store: DataStore, actor: Actor | null, orderId: string, input: { runnerUserId: string; note: string | null }) {
  const staff = requirePermission(actor, "delivery.assign");
  if (!staff.tenant.features.delivery) throw new DomainError("FEATURE_DISABLED", "Delivery is not enabled for this restaurant");
  const order = await store.getOrder(staff.tenant.id, orderId);
  if (!order || (staff.branchScope !== "ALL" && !staff.branchScope.includes(order.branchId))) throw notFound("Order");
  if (order.fulfillmentType !== "DELIVERY") throw new DomainError("VALIDATION_FAILED", "Only delivery orders can be assigned to a runner");
  if (!(ASSIGNABLE as readonly string[]).includes(order.status)) throw new DomainError("INVALID_TRANSITION", "This order can no longer be assigned");

  const membership = (await store.listMemberships(staff.tenant.id)).find((m) => m.userId === input.runnerUserId);
  if (!membership || membership.role !== "RUNNER" || membership.status !== "ACTIVE" || !membership.branchIds.includes(order.branchId))
    throw new DomainError("VALIDATION_FAILED", "Choose an active runner assigned to this branch");

  const now = new Date().toISOString();
  const existing = await store.getAssignmentForOrder(staff.tenant.id, order.id);
  const assignment = await store.tx(async (tx) => {
    let a;
    if (existing && existing.status === "ASSIGNED") {
      // Reassignment before pickup.
      a = await tx.casDeliveryAssignment(staff.tenant.id, existing.id, ["ASSIGNED"], { runnerUserId: input.runnerUserId, note: input.note });
      if (!a) throw new DomainError("STALE_STATE", "The assignment changed; refresh and try again");
    } else {
      if (existing && existing.status === "PICKED_UP") throw new DomainError("CONFLICT", "The order is already out for delivery");
      try {
        a = await tx.createDeliveryAssignment({
          tenantId: staff.tenant.id,
          branchId: order.branchId,
          orderId: order.id,
          runnerUserId: input.runnerUserId,
          status: "ASSIGNED",
          assignedByUserId: staff.user.id,
          note: input.note,
          createdAt: now,
          updatedAt: now,
        });
      } catch (e) {
        if (e instanceof UniqueViolationError) throw new DomainError("CONFLICT", "This order already has an active runner");
        throw e;
      }
    }
    await tx.addDeliveryEvent({
      tenantId: staff.tenant.id,
      assignmentId: a.id,
      type: "ASSIGNED",
      note: input.note,
      actorUserId: staff.user.id,
      createdAt: now,
    });
    await tx.addOutboxEvent({
      tenantId: staff.tenant.id,
      branchId: order.branchId,
      orderId: order.id,
      type: "delivery.updated",
      payload: {
        orderId: order.id,
        number: order.number,
        status: order.status,
        version: order.version,
        runnerUserId: input.runnerUserId,
        assignment: "ASSIGNED",
      },
      createdAt: now,
      publishedAt: null,
      attempts: 0,
      lastError: null,
      deadAt: null,
    });
    return a;
  });
  await audit(store, staff, {
    tenantId: staff.tenant.id,
    action: "delivery.assigned",
    entityType: "order",
    entityId: order.id,
    meta: { runnerUserId: input.runnerUserId },
  });
  await relayOutbox(store);
  return assignment;
}

export async function listMyJobs(store: DataStore, actor: Actor | null): Promise<RunnerJobView[]> {
  const staff = requirePermission(actor, "delivery.run");
  // NT-8: filter by assigned_to = me, always.
  const assignments = await store.listAssignments(staff.tenant.id, { runnerUserId: staff.user.id });
  const recent = assignments.filter((a) => a.status === "ASSIGNED" || a.status === "PICKED_UP" || Date.now() - new Date(a.updatedAt).getTime() < 12 * 3600_000);
  const names = await branchNames(store, staff.tenant.id);
  const jobs: RunnerJobView[] = [];
  for (const a of recent) {
    const o = await store.getOrder(staff.tenant.id, a.orderId);
    if (!o) continue;
    jobs.push({
      assignmentId: a.id,
      status: a.status,
      note: a.note,
      orderId: o.id,
      orderNumber: o.number,
      orderStatus: o.status,
      orderVersion: o.version,
      branchName: names.get(o.branchId) ?? "",
      // Minimum customer data, and only while the job is active.
      customerName: a.status === "ASSIGNED" || a.status === "PICKED_UP" ? o.customerName : null,
      customerPhone: a.status === "ASSIGNED" || a.status === "PICKED_UP" ? o.customerPhone : null,
      deliveryAddress: a.status === "ASSIGNED" || a.status === "PICKED_UP" ? o.deliveryAddress : null,
      items: o.items.map((i) => ({ name: i.nameSnapshot, quantity: i.quantity })),
      totalMinor: o.totalMinor,
      currency: o.currency,
      paid: o.paymentStatus === "CAPTURED",
      assignedAt: a.createdAt,
    });
  }
  return jobs;
}

export async function recordDeliveryEvent(
  store: DataStore,
  actor: Actor | null,
  assignmentId: string,
  input: { type: "PICKED_UP" | "DELIVERED" | "FAILED"; note: string | null },
) {
  const staff = requirePermission(actor, "delivery.run");
  const assignment = await store.getDeliveryAssignment(staff.tenant.id, assignmentId);
  // Unassigned or someone else's job: indistinguishable from not found (NT-8).
  if (!assignment || assignment.runnerUserId !== staff.user.id) throw notFound("Delivery job");
  const order = await store.getOrder(staff.tenant.id, assignment.orderId);
  if (!order) throw notFound("Order");
  if (input.type === "FAILED" && !input.note) throw new DomainError("VALIDATION_FAILED", "Add a reason for the failed delivery");

  const plan = {
    PICKED_UP: { from: ["ASSIGNED"], orderAction: "dispatch" },
    DELIVERED: { from: ["PICKED_UP"], orderAction: "deliver" },
    FAILED: { from: ["PICKED_UP"], orderAction: "fail_delivery" },
  } as const;
  const step = plan[input.type];
  if (input.type === "PICKED_UP" && order.status !== "READY") throw new DomainError("INVALID_TRANSITION", "The order is not ready for pickup yet");

  const updatedOrder = await store.tx(async (tx) => {
    const a = await tx.casDeliveryAssignment(staff.tenant.id, assignment.id, step.from, { status: input.type, note: input.note ?? assignment.note });
    if (!a) throw new DomainError("STALE_STATE", "This job was updated elsewhere; refresh");
    await tx.addDeliveryEvent({
      tenantId: staff.tenant.id,
      assignmentId: a.id,
      type: input.type,
      note: input.note,
      actorUserId: staff.user.id,
      createdAt: new Date().toISOString(),
    });
    const o = await applyTransition(tx, order, { action: step.orderAction, reason: input.type === "FAILED" ? input.note : null, actor: staff });
    if (!o) throw new DomainError("STALE_STATE", "The order changed; refresh");
    return o;
  });
  if (updatedOrder.status === "DELIVERY_FAILED" && updatedOrder.paymentStatus === "CAPTURED") {
    await issueRefund(store, staff, {
      order: updatedOrder,
      amountMinor: await refundableMinor(store, updatedOrder),
      reason: `Delivery failed: ${input.note}`,
      idempotencyKey: `delivery_failed:${updatedOrder.id}`,
    }).catch((e) => console.error("[delivery] refund could not be created", e));
  }
  await relayOutbox(store);
  return { status: input.type, orderStatus: updatedOrder.status };
}
