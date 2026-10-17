import type { Branch, Invitation, Order, PaymentAttempt } from "@/types/domain";
import type { InvitationView, PublicBranch, QuoteLineView, StaffOrderView } from "@/types/api";
import type { DataStore } from "@/server/store/types";
import { branchFilter, type Actor, type StaffActor } from "@/server/auth/actor";
import { notFound } from "@/server/errors";

// Cross-module helpers: audit trail, view mappers, opening hours.

export async function audit(
  store: DataStore,
  actor: Actor | null,
  input: { tenantId: string | null; action: string; entityType: string; entityId: string | null; meta?: Record<string, unknown>; requestId?: string | null },
) {
  await store.addAudit({
    tenantId: input.tenantId,
    actorUserId: actor?.user.id ?? null,
    actorLabel: actor?.user.email ?? "system",
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    meta: input.meta ?? {},
    requestId: input.requestId ?? null,
    createdAt: new Date().toISOString(),
  });
}

function localParts(timezone: string, at: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** True when the branch is within its opening hours (no hours configured = always open). */
export function isOpenNow(branch: Pick<Branch, "openingHours" | "timezone">, at = new Date()): boolean {
  if (branch.openingHours.length === 0) return true;
  const { day, minutes } = localParts(branch.timezone, at);
  return branch.openingHours.some((h) => {
    const open = toMinutes(h.open);
    const close = toMinutes(h.close);
    if (close > open) return h.day === day && minutes >= open && minutes < close;
    // Past midnight: open on h.day evening, or the following morning.
    return (h.day === day && minutes >= open) || ((h.day + 1) % 7 === day && minutes < close);
  });
}

export function toPublicBranch(b: Branch, deliveryAllowed: boolean): PublicBranch {
  return {
    id: b.id,
    name: b.name,
    address: b.address,
    phone: b.phone,
    acceptingOrders: b.acceptingOrders,
    isOpenNow: isOpenNow(b),
    isLive: b.isLive,
    takeawayEnabled: b.takeawayEnabled,
    deliveryEnabled: b.deliveryEnabled && deliveryAllowed,
    deliveryFeeMinor: b.deliveryFeeMinor,
    taxRateBps: b.taxRateBps,
    serviceChargeBps: b.serviceChargeBps,
    openingHours: b.openingHours,
  };
}

export function toStaffOrder(o: Order, branchName: string): StaffOrderView {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { accessTokenHash, requestHash, idempotencyKey, ...rest } = o;
  return { ...rest, branchName };
}

export function toLineViews(o: Pick<Order, "items">): QuoteLineView[] {
  return o.items.map((i) => ({
    menuItemId: i.menuItemId,
    name: i.nameSnapshot,
    variantId: i.variantId,
    variantName: i.variantName,
    modifiers: i.modifiers.map((m) => ({ optionId: m.optionId, groupName: m.groupName, optionName: m.optionName, priceDeltaMinor: m.priceDeltaMinor })),
    unitPriceMinor: i.unitPriceMinor,
    quantity: i.quantity,
    lineTotalMinor: i.lineTotalMinor,
    notes: i.notes,
  }));
}

export function toAttemptView(a: PaymentAttempt): Omit<PaymentAttempt, "idempotencyKey"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { idempotencyKey, ...rest } = a;
  return rest;
}

export function toInvitationView(i: Invitation, now = new Date()): InvitationView {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tokenHash, ...rest } = i;
  const status = i.acceptedAt ? "ACCEPTED" : i.revokedAt ? "REVOKED" : new Date(i.expiresAt) < now ? "EXPIRED" : "PENDING";
  return { ...rest, status };
}

export async function branchNames(store: DataStore, tenantId: string): Promise<Map<string, string>> {
  return new Map((await store.listBranches(tenantId)).map((b) => [b.id, b.name]));
}

/**
 * Branch filter for list/report queries. A requested branch must exist in the
 * actor's tenant *and* scope; otherwise 404 (even for owners with "ALL").
 */
export async function scopedBranchIds(store: DataStore, actor: StaffActor, requested?: string): Promise<string[] | undefined> {
  const ids = branchFilter(actor, requested);
  if (requested && !(await store.getBranch(actor.tenant.id, requested))) throw notFound("Branch");
  return ids;
}
