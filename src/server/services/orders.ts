import type { Order, OrderStatus } from "@/types/domain";
import type { KitchenQueueView, OrderDetailView, Paginated, StaffOrderView } from "@/types/api";
import type { OrderListQuery, TransitionInput } from "@/lib/validation";
import { AUTO_COMPLETE_FROM, canApply, findTransition, ACTIVE_KITCHEN_STATUSES, type TransitionAction } from "@/lib/order-states";
import type { DataStore } from "@/server/store/types";
import { DomainError, forbidden, notFound } from "@/server/errors";
import { can, requirePermission, requireStaff, type Actor, type StaffActor } from "@/server/auth/actor";
import { enqueueOrderEvent, relayOutbox } from "@/server/realtime/outbox";
import { issueRefund, refundableMinor } from "./payments";
import { loadPricingMenu } from "./checkout";
import { isItemAvailable } from "./pricing";
import { branchNames, toAttemptView, toStaffOrder, scopedBranchIds } from "./shared";

// Order lifecycle + kitchen (FR-06, FR-07, FR-12, BR-07, NT-4, NT-6).

function dayStartIso(date: string) {
  return new Date(`${date}T00:00:00.000Z`).toISOString();
}
function dayEndIso(date: string) {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + 86_400_000).toISOString();
}

export async function listOrders(store: DataStore, actor: Actor | null, q: OrderListQuery): Promise<Paginated<StaffOrderView>> {
  const staff = requirePermission(actor, "orders.view");
  const branchIds = await scopedBranchIds(store, staff, q.branchId);
  const { items, total } = await store.listOrders(staff.tenant.id, {
    branchIds,
    statuses: q.status ? [q.status] : undefined,
    fulfillmentType: q.fulfillmentType,
    q: q.q,
    createdFrom: q.from ? dayStartIso(q.from) : undefined,
    createdTo: q.to ? dayEndIso(q.to) : undefined,
    offset: (q.page - 1) * q.pageSize,
    limit: q.pageSize,
  });
  const names = await branchNames(store, staff.tenant.id);
  return { items: items.map((o) => toStaffOrder(o, names.get(o.branchId) ?? "")), total, page: q.page, pageSize: q.pageSize };
}

async function loadScopedOrder(store: DataStore, staff: StaffActor, orderId: string): Promise<Order> {
  const order = await store.getOrder(staff.tenant.id, orderId);
  // Out-of-scope orders look exactly like missing ones (no existence leak).
  if (!order || (staff.branchScope !== "ALL" && !staff.branchScope.includes(order.branchId))) throw notFound("Order");
  return order;
}

export async function getOrderDetail(store: DataStore, actor: Actor | null, orderId: string): Promise<OrderDetailView> {
  const staff = requirePermission(actor, "orders.view");
  const order = await loadScopedOrder(store, staff, orderId);
  const [history, attempts, refunds, assignment, names, memberships] = await Promise.all([
    store.listStatusHistory(staff.tenant.id, order.id),
    store.listPaymentAttempts(staff.tenant.id, { orderId: order.id, limit: 50 }),
    store.listRefunds(staff.tenant.id, { orderId: order.id, limit: 50 }),
    store.getAssignmentForOrder(staff.tenant.id, order.id),
    branchNames(store, staff.tenant.id),
    order.fulfillmentType === "DELIVERY" ? store.listMemberships(staff.tenant.id) : Promise.resolve([]),
  ]);
  const runnerMemberships = memberships.filter((m) => m.role === "RUNNER" && m.status === "ACTIVE" && m.branchIds.includes(order.branchId));
  const users = await store.getUsersByIds([...runnerMemberships.map((m) => m.userId), ...(assignment ? [assignment.runnerUserId] : [])]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  return {
    order: toStaffOrder(order, names.get(order.branchId) ?? ""),
    history: history.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    payments: attempts.map(toAttemptView),
    refunds,
    delivery: assignment
      ? { ...assignment, runnerName: userName.get(assignment.runnerUserId) ?? "Runner", events: await store.listDeliveryEvents(staff.tenant.id, assignment.id) }
      : null,
    runners: runnerMemberships.map((m) => ({ userId: m.userId, name: userName.get(m.userId) ?? m.userId })),
    refundableMinor: can(staff, "payments.refund") ? await refundableMinor(store, order) : 0,
  };
}

const TIMESTAMP_FOR: Partial<Record<OrderStatus, keyof Order>> = {
  ACCEPTED: "acceptedAt",
  READY: "readyAt",
  SERVED: "handedOverAt",
  PICKED_UP: "handedOverAt",
  DELIVERED: "handedOverAt",
  COMPLETED: "completedAt",
};

/**
 * Apply one guarded transition inside an existing transaction:
 * status + version compare-and-set, history row and outbox event.
 * Returns null when the order moved on concurrently (→ 409).
 */
export async function applyTransition(
  tx: DataStore,
  order: Order,
  input: { action: TransitionAction; expectedVersion?: number; reason: string | null; actor: StaffActor | null; actorLabel?: string },
): Promise<Order | null> {
  const rule = findTransition(input.action);
  const now = new Date().toISOString();
  const patch: Partial<Order> = { status: rule.to };
  const ts = TIMESTAMP_FOR[rule.to];
  if (ts) (patch as Record<string, unknown>)[ts] = now;
  if (rule.to === "CANCELLED" || rule.to === "REJECTED" || rule.to === "DELIVERY_FAILED") patch.cancelReason = input.reason;
  if (rule.to === "CANCELLED" && order.status === "PENDING_PAYMENT" && order.paymentStatus !== "CAPTURED") patch.paymentStatus = "CANCELLED";

  const updated = await tx.casOrder(order.tenantId, order.id, { statuses: rule.from, version: input.expectedVersion }, patch);
  if (!updated) return null;
  await tx.addStatusHistory({
    tenantId: order.tenantId,
    orderId: order.id,
    fromStatus: order.status,
    toStatus: rule.to,
    actorKind: input.actor ? "STAFF" : "SYSTEM",
    actorUserId: input.actor?.user.id ?? null,
    actorLabel: input.actorLabel ?? input.actor?.user.name ?? "System",
    reason: input.reason,
    createdAt: now,
  });

  let final = updated;
  // Handover auto-completes in the same transaction (assumption A7).
  if (AUTO_COMPLETE_FROM.includes(rule.to)) {
    const completed = await tx.casOrder(order.tenantId, order.id, { statuses: [rule.to] }, { status: "COMPLETED", completedAt: now });
    if (completed) {
      await tx.addStatusHistory({
        tenantId: order.tenantId,
        orderId: order.id,
        fromStatus: rule.to,
        toStatus: "COMPLETED",
        actorKind: "SYSTEM",
        actorUserId: null,
        actorLabel: "System",
        reason: null,
        createdAt: now,
      });
      final = completed;
    }
  }
  await enqueueOrderEvent(tx, "order.updated", final, { previousStatus: order.status, action: input.action });
  return final;
}

export async function transitionOrder(store: DataStore, actor: Actor | null, orderId: string, input: TransitionInput) {
  const rule = findTransition(input.action);
  if (rule.permission === "SYSTEM" || rule.permission === "delivery.run") throw new DomainError("INVALID_TRANSITION", "This transition is not available here");
  const staff = requirePermission(actor, rule.permission);
  const order = await loadScopedOrder(store, staff, orderId);

  if (order.version !== input.expectedVersion)
    throw new DomainError("STALE_STATE", `Order #${order.number} was updated elsewhere. Refresh to see its current state.`, {
      currentVersion: order.version,
      currentStatus: order.status,
    });
  if (!canApply(rule, order.status, order.fulfillmentType))
    throw new DomainError("INVALID_TRANSITION", `Cannot ${rule.label.toLowerCase()} an order that is ${order.status.replaceAll("_", " ").toLowerCase()}`, {
      currentStatus: order.status,
    });
  if (rule.reasonRequired && !input.reason) throw new DomainError("VALIDATION_FAILED", "A reason is required", { field: "reason" });

  const warnings: string[] = [];
  if (input.action === "accept") {
    // BR-07: revalidate availability (and report price drift) when the kitchen accepts.
    const menu = await loadPricingMenu(store, order.tenantId, order.branchId);
    const unavailable = order.items.filter((i) => {
      const item = menu.items.get(i.menuItemId);
      return !item || !isItemAvailable(item, menu.branchItems.get(i.menuItemId));
    });
    if (unavailable.length)
      throw new DomainError(
        "ITEM_UNAVAILABLE",
        `${unavailable.map((i) => i.nameSnapshot).join(", ")} ${unavailable.length > 1 ? "are" : "is"} now unavailable. Reject the order or restore availability.`,
      );
    for (const i of order.items) {
      const item = menu.items.get(i.menuItemId)!;
      const base = menu.branchItems.get(i.menuItemId)?.priceOverrideMinor ?? item.basePriceMinor;
      const variantDelta = item.variants.find((v) => v.id === i.variantId)?.priceDeltaMinor ?? 0;
      const modifierDelta = i.modifiers.reduce((s, m) => s + m.priceDeltaMinor, 0);
      if (base + variantDelta + modifierDelta !== i.unitPriceMinor)
        warnings.push(`${i.nameSnapshot}: menu price changed since checkout; the paid price stands.`);
    }
  }

  const updated = await store.tx((tx) =>
    applyTransition(tx, order, { action: input.action, expectedVersion: input.expectedVersion, reason: input.reason, actor: staff }),
  );
  if (!updated) throw new DomainError("STALE_STATE", `Order #${order.number} was updated elsewhere. Refresh to see its current state.`);

  // Paid orders that are rejected or cancelled start the refund workflow (assumption A8).
  let refund = null;
  if ((updated.status === "REJECTED" || updated.status === "CANCELLED") && updated.paymentStatus === "CAPTURED") {
    try {
      refund = await issueRefund(store, staff, {
        order: updated,
        amountMinor: await refundableMinor(store, updated),
        reason: `Order ${updated.status.toLowerCase()}: ${input.reason ?? ""}`.trim(),
        idempotencyKey: `${updated.status.toLowerCase()}:${updated.id}`,
      });
    } catch (e) {
      console.error("[orders] automatic refund could not be created", e);
    }
  }
  await relayOutbox(store);
  const names = await branchNames(store, staff.tenant.id);
  return { order: toStaffOrder(updated, names.get(updated.branchId) ?? ""), warnings, refund };
}

export async function getKitchenQueue(store: DataStore, actor: Actor | null, branchId: string | undefined, stationId?: string): Promise<KitchenQueueView> {
  const staff = requireStaff(actor);
  if (!can(staff, "kitchen.operate") && !can(staff, "orders.view")) throw forbidden();
  const branches = await store.listBranches(staff.tenant.id);
  const allowed = branches.filter((b) => staff.branchScope === "ALL" || staff.branchScope.includes(b.id));
  const branch = branchId ? allowed.find((b) => b.id === branchId) : allowed[0];
  if (!branch) throw notFound("Branch");
  const [{ items }, stations] = await Promise.all([
    store.listOrders(staff.tenant.id, { branchIds: [branch.id], statuses: [...ACTIVE_KITCHEN_STATUSES], offset: 0, limit: 200 }),
    store.listStations(staff.tenant.id, branch.id),
  ]);
  // NT-4: only orders that reached CONFIRMED (verified payment) are ever shown.
  const tickets = items
    .filter((o) => o.confirmedAt && (!stationId || o.items.some((i) => i.stationId === stationId)))
    .sort((a, b) => a.confirmedAt!.localeCompare(b.confirmedAt!))
    .map((o) => ({
      orderId: o.id,
      number: o.number,
      version: o.version,
      status: o.status,
      fulfillmentType: o.fulfillmentType,
      tableLabel: o.tableLabel,
      customerName: o.customerName,
      confirmedAt: o.confirmedAt!,
      acceptedAt: o.acceptedAt,
      readyAt: o.readyAt,
      notes: o.notes,
      items: o.items.map((i) => ({
        name: i.nameSnapshot,
        variantName: i.variantName,
        quantity: i.quantity,
        modifiers: i.modifiers.map((m) => m.optionName),
        notes: i.notes,
        stationId: i.stationId,
      })),
    }));
  return { branch: { id: branch.id, name: branch.name }, stations, tickets, serverTime: new Date().toISOString() };
}

/** Counter view: ready-for-handover plus exceptions that need a human. */
export async function getCounterBoard(store: DataStore, actor: Actor | null, branchId?: string) {
  const staff = requirePermission(actor, "orders.view");
  const branchIds = await scopedBranchIds(store, staff, branchId);
  const [ready, pending, exceptions] = await Promise.all([
    store.listOrders(staff.tenant.id, { branchIds, statuses: ["READY"], offset: 0, limit: 100 }),
    store.listOrders(staff.tenant.id, { branchIds, statuses: ["PENDING_PAYMENT"], offset: 0, limit: 50 }),
    store.listOrders(staff.tenant.id, {
      branchIds,
      statuses: ["REJECTED", "CANCELLED", "DELIVERY_FAILED"],
      createdFrom: new Date(Date.now() - 12 * 3600_000).toISOString(),
      offset: 0,
      limit: 20,
    }),
  ]);
  const names = await branchNames(store, staff.tenant.id);
  const map = (o: Order) => toStaffOrder(o, names.get(o.branchId) ?? "");
  return {
    ready: ready.items.sort((a, b) => (a.readyAt ?? "").localeCompare(b.readyAt ?? "")).map(map),
    awaitingPayment: pending.items.map(map),
    exceptions: exceptions.items.map(map),
    serverTime: new Date().toISOString(),
  };
}
