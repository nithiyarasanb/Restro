import type { Branch, RestaurantTable, Tenant } from "@/types/domain";
import type { CustomerOrderView, PlacedOrderView, QuoteView } from "@/types/api";
import type { OrderContextInput, PlaceOrderInput, QuoteRequest } from "@/lib/validation";
import type { DataStore } from "@/server/store/types";
import { UniqueViolationError } from "@/server/store/types";
import { DomainError } from "@/server/errors";
import { getConfig } from "@/server/config";
import { hmacSha256Hex, safeEqualHex, sha256, stableStringify } from "@/server/crypto";
import { enqueueOrderEvent } from "@/server/realtime/outbox";
import { priceOrder, type PricingMenu, type Quote } from "./pricing";
import { isOpenNow, toLineViews } from "./shared";

// Checkout & Orders module (FR-03, FR-04, FR-12, BR-03, BR-06, BR-08).

export interface OrderContext {
  tenant: Tenant;
  branch: Branch;
  table: RestaurantTable | null;
}

/** QR / branch → tenant context. A QR ref is context only, never a credential (BR-02). */
export async function resolveOrderContext(store: DataStore, ctx: OrderContextInput): Promise<OrderContext> {
  if (ctx.kind === "table") {
    const table = await store.getTableByQrRef(ctx.qrRef);
    if (!table || table.status !== "ACTIVE") throw new DomainError("QR_INVALID", "This QR code is no longer active. Please ask a member of staff for help.");
    const tenant = await store.getTenant(table.tenantId);
    const branch = await store.getBranch(table.tenantId, table.branchId);
    if (!tenant || !branch || tenant.status !== "ACTIVE") throw new DomainError("QR_INVALID", "This restaurant is not accepting online orders.");
    return { tenant, branch, table };
  }
  const tenant = await store.getTenantBySlug(ctx.tenantSlug);
  if (!tenant || tenant.status !== "ACTIVE") throw new DomainError("NOT_FOUND", "Restaurant not found");
  const branch = await store.getBranch(tenant.id, ctx.branchId);
  if (!branch) throw new DomainError("NOT_FOUND", "Branch not found");
  return { tenant, branch, table: null };
}

export async function loadPricingMenu(store: DataStore, tenantId: string, branchId: string): Promise<PricingMenu> {
  const [items, groups, branchItems] = await Promise.all([
    store.listMenuItems(tenantId, { includeRetired: true }),
    store.listModifierGroups(tenantId, { includeRetired: true }),
    store.listBranchMenuItems(tenantId, branchId),
  ]);
  return {
    items: new Map(items.map((i) => [i.id, i])),
    groups: new Map(groups.map((g) => [g.id, g])),
    branchItems: new Map(branchItems.map((b) => [b.itemId, b])),
  };
}

function assertCanOrder(ctx: OrderContext, fulfillmentType: QuoteRequest["fulfillmentType"]) {
  const { branch, tenant } = ctx;
  if (!branch.isLive) throw new DomainError("BRANCH_NOT_ACCEPTING", `${branch.name} is not live for online orders yet.`);
  if (!branch.acceptingOrders) throw new DomainError("BRANCH_NOT_ACCEPTING", `${branch.name} is not accepting orders right now.`);
  if (!isOpenNow(branch)) throw new DomainError("BRANCH_NOT_ACCEPTING", `${branch.name} is closed at the moment.`);
  if (fulfillmentType === "DINE_IN" && !ctx.table) throw new DomainError("VALIDATION_FAILED", "Dine-in orders must be placed from a table QR code.");
  if (fulfillmentType !== "DINE_IN" && ctx.table) throw new DomainError("VALIDATION_FAILED", "Table QR orders are dine-in only.");
  if (fulfillmentType === "TAKEAWAY" && !branch.takeawayEnabled) throw new DomainError("FEATURE_DISABLED", "Takeaway is not available at this branch.");
  if (fulfillmentType === "DELIVERY" && !(branch.deliveryEnabled && tenant.features.delivery))
    throw new DomainError("FEATURE_DISABLED", "Delivery is not available at this branch.");
}

export function toQuoteView(q: Quote): QuoteView {
  return {
    currency: q.currency,
    fulfillmentType: q.fulfillmentType,
    lines: q.lines.map((l) => ({
      menuItemId: l.menuItemId,
      name: l.nameSnapshot,
      variantId: l.variantId,
      variantName: l.variantName,
      modifiers: l.modifiers.map((m) => ({ optionId: m.optionId, groupName: m.groupName, optionName: m.optionName, priceDeltaMinor: m.priceDeltaMinor })),
      unitPriceMinor: l.unitPriceMinor,
      quantity: l.quantity,
      lineTotalMinor: l.lineTotalMinor,
      notes: l.notes,
    })),
    subtotalMinor: q.subtotalMinor,
    discountMinor: q.discountMinor,
    serviceChargeMinor: q.serviceChargeMinor,
    taxMinor: q.taxMinor,
    deliveryFeeMinor: q.deliveryFeeMinor,
    totalMinor: q.totalMinor,
    taxRateBps: q.taxRateBps,
    serviceChargeBps: q.serviceChargeBps,
  };
}

export async function quote(store: DataStore, input: QuoteRequest): Promise<QuoteView> {
  const ctx = await resolveOrderContext(store, input.context);
  assertCanOrder(ctx, input.fulfillmentType);
  const menu = await loadPricingMenu(store, ctx.tenant.id, ctx.branch.id);
  return toQuoteView(priceOrder({ menu, branch: ctx.branch, currency: ctx.tenant.currency, fulfillmentType: input.fulfillmentType, lines: input.lines }));
}

/** Customer access token for an order: HMAC of the id, so idempotent replays can return it again. */
export function orderAccessToken(orderId: string): string {
  return hmacSha256Hex(getConfig().APP_SECRET, `order-access:${orderId}`).slice(0, 40);
}

export function verifyOrderAccess(order: { id: string; accessTokenHash: string }, token: string | null | undefined): boolean {
  if (!token || token.length > 128) return false;
  return safeEqualHex(sha256(token), order.accessTokenHash);
}

function placedView(order: { id: string; number: number; totalMinor: number; currency: string; status: PlacedOrderView["status"] }): PlacedOrderView {
  const accessToken = orderAccessToken(order.id);
  return {
    orderId: order.id,
    number: order.number,
    accessToken,
    trackingUrl: `/order/${order.id}?t=${accessToken}`,
    totalMinor: order.totalMinor,
    currency: order.currency,
    status: order.status,
  };
}

/**
 * Idempotent order creation. Same key + same request → same order (200).
 * Same key + different request → 422. The client never supplies prices.
 */
export async function placeOrder(store: DataStore, input: PlaceOrderInput, idempotencyKey: string): Promise<{ created: boolean; order: PlacedOrderView }> {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey)) throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
  const ctx = await resolveOrderContext(store, input.context);
  const requestHash = sha256(stableStringify(input));

  const replay = async () => {
    const existing = await store.findOrderByIdempotencyKey(ctx.tenant.id, idempotencyKey);
    if (!existing) return null;
    if (existing.requestHash !== requestHash) throw new DomainError("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different order");
    return { created: false, order: placedView(existing) };
  };
  const prior = await replay();
  if (prior) return prior;

  assertCanOrder(ctx, input.fulfillmentType);
  const menu = await loadPricingMenu(store, ctx.tenant.id, ctx.branch.id);
  const q = priceOrder({ menu, branch: ctx.branch, currency: ctx.tenant.currency, fulfillmentType: input.fulfillmentType, lines: input.lines });

  try {
    const order = await store.tx(async (tx) => {
      const number = await tx.nextOrderNumber(ctx.tenant.id, ctx.branch.id);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const created = await tx.createOrder({
        id,
        tenantId: ctx.tenant.id,
        branchId: ctx.branch.id,
        number,
        tableId: ctx.table?.id ?? null,
        tableLabel: ctx.table?.label ?? null,
        fulfillmentType: input.fulfillmentType,
        status: "PENDING_PAYMENT",
        paymentStatus: "CREATED",
        currency: q.currency,
        subtotalMinor: q.subtotalMinor,
        discountMinor: q.discountMinor,
        serviceChargeMinor: q.serviceChargeMinor,
        taxMinor: q.taxMinor,
        deliveryFeeMinor: q.deliveryFeeMinor,
        totalMinor: q.totalMinor,
        refundedMinor: 0,
        taxRateBps: q.taxRateBps,
        serviceChargeBps: q.serviceChargeBps,
        customerName: input.customer.name,
        customerPhone: input.customer.phone,
        deliveryAddress: input.fulfillmentType === "DELIVERY" ? input.customer.address : null,
        notes: input.notes,
        idempotencyKey,
        requestHash,
        accessTokenHash: sha256(orderAccessToken(id)),
        version: 1,
        cancelReason: null,
        createdAt: now,
        updatedAt: now,
        confirmedAt: null,
        acceptedAt: null,
        readyAt: null,
        handedOverAt: null,
        completedAt: null,
        // Immutable snapshot of names, variants, modifiers and prices (BR-03).
        items: q.lines.map((l) => ({
          id: crypto.randomUUID(),
          menuItemId: l.menuItemId,
          nameSnapshot: l.nameSnapshot,
          variantId: l.variantId,
          variantName: l.variantName,
          unitPriceMinor: l.unitPriceMinor,
          quantity: l.quantity,
          lineTotalMinor: l.lineTotalMinor,
          notes: l.notes,
          stationId: l.stationId,
          modifiers: l.modifiers.map((m) => ({ ...m, id: crypto.randomUUID() })),
        })),
      });
      await tx.addStatusHistory({
        tenantId: created.tenantId,
        orderId: created.id,
        fromStatus: null,
        toStatus: "PENDING_PAYMENT",
        actorKind: "CUSTOMER",
        actorUserId: null,
        actorLabel: "Customer",
        reason: null,
        createdAt: now,
      });
      await enqueueOrderEvent(tx, "order.updated", created);
      return created;
    });
    return { created: true, order: placedView(order) };
  } catch (e) {
    // Lost a race with a concurrent request using the same key.
    if (e instanceof UniqueViolationError) {
      const again = await replay();
      if (again) return again;
    }
    throw e;
  }
}

export async function getCustomerOrder(store: DataStore, orderId: string, token: string | null): Promise<CustomerOrderView> {
  const order = await store.getOrderUnscoped(orderId);
  // Same error for "missing" and "wrong token" so order ids cannot be probed.
  if (!order || !verifyOrderAccess(order, token)) throw new DomainError("NOT_FOUND", "Order not found");
  const [tenant, branch, attempts] = await Promise.all([
    store.getTenant(order.tenantId),
    store.getBranch(order.tenantId, order.branchId),
    store.listPaymentAttempts(order.tenantId, { orderId: order.id, limit: 1 }),
  ]);
  const latest = attempts[0] ?? null;
  return {
    id: order.id,
    number: order.number,
    restaurantName: tenant?.name ?? "",
    branchName: branch?.name ?? "",
    tableLabel: order.tableLabel,
    fulfillmentType: order.fulfillmentType,
    status: order.status,
    paymentStatus: order.paymentStatus,
    currency: order.currency,
    subtotalMinor: order.subtotalMinor,
    serviceChargeMinor: order.serviceChargeMinor,
    taxMinor: order.taxMinor,
    deliveryFeeMinor: order.deliveryFeeMinor,
    totalMinor: order.totalMinor,
    refundedMinor: order.refundedMinor,
    items: toLineViews(order),
    createdAt: order.createdAt,
    confirmedAt: order.confirmedAt,
    acceptedAt: order.acceptedAt,
    readyAt: order.readyAt,
    handedOverAt: order.handedOverAt,
    completedAt: order.completedAt,
    cancelReason: order.cancelReason,
    version: order.version,
    latestPayment: latest ? { status: latest.status, failureReason: latest.failureReason } : null,
    canPay: order.status === "PENDING_PAYMENT" && (!latest || latest.status !== "CAPTURED"),
    isDemo: getConfig().isDemo,
  };
}
