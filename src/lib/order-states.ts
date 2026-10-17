// Order state machine (BRD §11, DG §6). Shared by the server (validation)
// and the UI (which buttons to offer). The server re-checks everything.

import type { FulfillmentType, OrderStatus, PaymentStatus } from "@/types/domain";
import type { Permission } from "@/lib/permissions";

export type TransitionAction =
  "confirm" | "accept" | "reject" | "start" | "ready" | "serve" | "pickup" | "dispatch" | "deliver" | "fail_delivery" | "complete" | "cancel";

export interface TransitionRule {
  action: TransitionAction;
  from: readonly OrderStatus[];
  to: OrderStatus;
  /** "SYSTEM" transitions cannot be requested through the public transitions endpoint. */
  permission: Permission | "SYSTEM";
  fulfillment?: readonly FulfillmentType[];
  reasonRequired?: boolean;
  label: string;
}

export const TRANSITIONS: readonly TransitionRule[] = [
  { action: "confirm", from: ["PENDING_PAYMENT"], to: "CONFIRMED", permission: "SYSTEM", label: "Confirm payment" },
  { action: "accept", from: ["CONFIRMED"], to: "ACCEPTED", permission: "kitchen.operate", label: "Accept" },
  {
    action: "reject",
    from: ["CONFIRMED"],
    to: "REJECTED",
    permission: "kitchen.operate",
    reasonRequired: true,
    label: "Reject",
  },
  { action: "start", from: ["ACCEPTED"], to: "PREPARING", permission: "kitchen.operate", label: "Start preparing" },
  { action: "ready", from: ["PREPARING"], to: "READY", permission: "kitchen.operate", label: "Mark ready" },
  {
    action: "serve",
    from: ["READY"],
    to: "SERVED",
    permission: "orders.handover",
    fulfillment: ["DINE_IN"],
    label: "Hand over",
  },
  {
    action: "pickup",
    from: ["READY"],
    to: "PICKED_UP",
    permission: "orders.handover",
    fulfillment: ["TAKEAWAY"],
    label: "Picked up",
  },
  {
    action: "dispatch",
    from: ["READY"],
    to: "OUT_FOR_DELIVERY",
    permission: "delivery.run",
    fulfillment: ["DELIVERY"],
    label: "Picked up for delivery",
  },
  {
    action: "deliver",
    from: ["OUT_FOR_DELIVERY"],
    to: "DELIVERED",
    permission: "delivery.run",
    fulfillment: ["DELIVERY"],
    label: "Delivered",
  },
  {
    action: "fail_delivery",
    from: ["OUT_FOR_DELIVERY"],
    to: "DELIVERY_FAILED",
    permission: "delivery.run",
    fulfillment: ["DELIVERY"],
    reasonRequired: true,
    label: "Delivery failed",
  },
  {
    action: "complete",
    from: ["SERVED", "PICKED_UP", "DELIVERED"],
    to: "COMPLETED",
    permission: "orders.handover",
    label: "Complete",
  },
  {
    action: "cancel",
    from: ["PENDING_PAYMENT", "CONFIRMED", "ACCEPTED", "PREPARING"],
    to: "CANCELLED",
    permission: "orders.cancel",
    reasonRequired: true,
    label: "Cancel order",
  },
];

export function findTransition(action: TransitionAction): TransitionRule {
  const rule = TRANSITIONS.find((t) => t.action === action);
  if (!rule) throw new Error(`Unknown transition: ${action}`);
  return rule;
}

export function canApply(rule: TransitionRule, status: OrderStatus, fulfillment: FulfillmentType): boolean {
  return rule.from.includes(status) && (!rule.fulfillment || rule.fulfillment.includes(fulfillment));
}

/** Staff-facing actions available for an order in its current state. */
export function availableActions(status: OrderStatus, fulfillment: FulfillmentType): TransitionRule[] {
  return TRANSITIONS.filter((t) => t.permission !== "SYSTEM" && canApply(t, status, fulfillment));
}

export const TERMINAL_STATUSES: readonly OrderStatus[] = ["COMPLETED", "REJECTED", "CANCELLED", "DELIVERY_FAILED"];
export const ACTIVE_KITCHEN_STATUSES: readonly OrderStatus[] = ["CONFIRMED", "ACCEPTED", "PREPARING", "READY"];
/** Handover states auto-complete in the same transaction (assumption A7). */
export const AUTO_COMPLETE_FROM: readonly OrderStatus[] = ["SERVED", "PICKED_UP", "DELIVERED"];

export const REJECT_REASONS = [
  { code: "OUT_OF_STOCK", label: "Item out of stock" },
  { code: "KITCHEN_CLOSED", label: "Kitchen closing / closed" },
  { code: "TOO_BUSY", label: "Kitchen too busy" },
  { code: "INVALID_ORDER", label: "Order cannot be fulfilled" },
  { code: "OTHER", label: "Other" },
] as const;

type Tone = "neutral" | "info" | "warning" | "success" | "danger" | "accent";

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; tone: Tone }> = {
  PENDING_PAYMENT: { label: "Awaiting payment", tone: "neutral" },
  CONFIRMED: { label: "New", tone: "info" },
  ACCEPTED: { label: "Accepted", tone: "accent" },
  PREPARING: { label: "Preparing", tone: "warning" },
  READY: { label: "Ready", tone: "success" },
  SERVED: { label: "Served", tone: "success" },
  PICKED_UP: { label: "Picked up", tone: "success" },
  OUT_FOR_DELIVERY: { label: "Out for delivery", tone: "accent" },
  DELIVERED: { label: "Delivered", tone: "success" },
  COMPLETED: { label: "Completed", tone: "neutral" },
  REJECTED: { label: "Rejected", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
  DELIVERY_FAILED: { label: "Delivery failed", tone: "danger" },
};

export const PAYMENT_STATUS_META: Record<PaymentStatus, { label: string; tone: Tone }> = {
  CREATED: { label: "Unpaid", tone: "neutral" },
  PENDING: { label: "Pending", tone: "warning" },
  AUTHORIZED: { label: "Authorized", tone: "info" },
  CAPTURED: { label: "Paid", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  PARTIALLY_REFUNDED: { label: "Partly refunded", tone: "warning" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
};

export const FULFILLMENT_LABELS: Record<FulfillmentType, string> = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
};
