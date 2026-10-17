import type { Order } from "@/types/domain";
import type { CurrencyAmounts, OverviewView, SalesReportView } from "@/types/api";
import type { ReportQuery } from "@/lib/validation";
import type { DataStore } from "@/server/store/types";
import { scopedBranchIds } from "./shared";
import { requirePermission, type Actor } from "@/server/auth/actor";
import { ACTIVE_KITCHEN_STATUSES } from "@/lib/order-states";

// Reports (FR-11, BRD §18). Metrics are kept separate (gross, discounts,
// tax, fees, refunds, net) and every money figure is grouped by currency —
// different currencies are never summed (BR-05).

function localDateHour(iso: string, timezone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

export function todayIn(timezone: string, at = new Date()): string {
  return localDateHour(at.toISOString(), timezone).date;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function ordersInRange(store: DataStore, tenantId: string, branchIds: string[] | undefined, from: string, to: string, timezone: string) {
  // Query a padded UTC window, then filter precisely by local date.
  const { items } = await store.listOrders(tenantId, {
    branchIds,
    createdFrom: `${shiftDate(from, -1)}T00:00:00.000Z`,
    createdTo: `${shiftDate(to, 2)}T00:00:00.000Z`,
    offset: 0,
    limit: 100_000,
  });
  return items.filter((o) => {
    const d = localDateHour(o.createdAt, timezone).date;
    return d >= from && d <= to;
  });
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const secondsBetween = (a: string | null, b: string | null) => (a && b ? (new Date(b).getTime() - new Date(a).getTime()) / 1000 : null);
const isPaid = (o: Order) => o.confirmedAt !== null;

function prepTimes(orders: Order[]) {
  const accept: number[] = [];
  const prep: number[] = [];
  const handover: number[] = [];
  for (const o of orders) {
    const a = secondsBetween(o.confirmedAt, o.acceptedAt);
    const p = secondsBetween(o.acceptedAt, o.readyAt);
    const h = secondsBetween(o.readyAt, o.handedOverAt);
    if (a !== null && a >= 0) accept.push(a);
    if (p !== null && p >= 0) prep.push(p);
    if (h !== null && h >= 0) handover.push(h);
  }
  return { averageAcceptSeconds: avg(accept), averagePrepSeconds: avg(prep), averageHandoverSeconds: avg(handover), sampleSize: prep.length };
}

export async function salesReport(store: DataStore, actor: Actor | null, q: ReportQuery): Promise<SalesReportView> {
  const staff = requirePermission(actor, "reports.view");
  const tz = staff.tenant.timezone;
  const branchIds = await scopedBranchIds(store, staff, q.branchId);
  const orders = await ordersInRange(store, staff.tenant.id, branchIds, q.from, q.to, tz);
  const paid = orders.filter(isPaid);

  const refunds = (await store.listRefunds(staff.tenant.id, { limit: 100_000 })).filter((r) => r.status === "SUCCEEDED");
  const refundByOrder = new Map<string, number>();
  for (const r of refunds) refundByOrder.set(r.orderId, (refundByOrder.get(r.orderId) ?? 0) + r.amountMinor);

  const byCurrencyMap = new Map<string, CurrencyAmounts>();
  for (const o of paid) {
    const c = byCurrencyMap.get(o.currency) ?? {
      currency: o.currency,
      orders: 0,
      grossOrderValueMinor: 0,
      discountsMinor: 0,
      serviceChargeMinor: 0,
      taxMinor: 0,
      deliveryFeesMinor: 0,
      refundsMinor: 0,
      netCollectedMinor: 0,
      averageOrderValueMinor: 0,
    };
    const refunded = refundByOrder.get(o.id) ?? 0;
    c.orders += 1;
    c.grossOrderValueMinor += o.subtotalMinor;
    c.discountsMinor += o.discountMinor;
    c.serviceChargeMinor += o.serviceChargeMinor;
    c.taxMinor += o.taxMinor;
    c.deliveryFeesMinor += o.deliveryFeeMinor;
    c.refundsMinor += refunded;
    c.netCollectedMinor += o.totalMinor - refunded;
    byCurrencyMap.set(o.currency, c);
  }
  for (const c of byCurrencyMap.values()) c.averageOrderValueMinor = c.orders ? Math.round(c.grossOrderValueMinor / c.orders) : 0;

  const byDayMap = new Map<string, { date: string; currency: string; orders: number; grossOrderValueMinor: number }>();
  for (let d = q.from; d <= q.to; d = shiftDate(d, 1))
    byDayMap.set(`${d}|${staff.tenant.currency}`, { date: d, currency: staff.tenant.currency, orders: 0, grossOrderValueMinor: 0 });
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0 }));
  const statusCounts: SalesReportView["statusCounts"] = {};
  const fulfillmentCounts: SalesReportView["fulfillmentCounts"] = {};
  const items = new Map<string, { name: string; quantity: number; revenueMinor: number; currency: string }>();
  for (const o of orders) statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;
  for (const o of paid) {
    const { date, hour } = localDateHour(o.createdAt, tz);
    const key = `${date}|${o.currency}`;
    const day = byDayMap.get(key) ?? { date, currency: o.currency, orders: 0, grossOrderValueMinor: 0 };
    day.orders += 1;
    day.grossOrderValueMinor += o.subtotalMinor;
    byDayMap.set(key, day);
    byHour[hour].orders += 1;
    fulfillmentCounts[o.fulfillmentType] = (fulfillmentCounts[o.fulfillmentType] ?? 0) + 1;
    for (const i of o.items) {
      const k = `${i.nameSnapshot}|${o.currency}`;
      const row = items.get(k) ?? { name: i.nameSnapshot, quantity: 0, revenueMinor: 0, currency: o.currency };
      row.quantity += i.quantity;
      row.revenueMinor += i.lineTotalMinor;
      items.set(k, row);
    }
  }

  const attempts = (await store.listPaymentAttempts(staff.tenant.id, { limit: 100_000 })).filter((a) => orders.some((o) => o.id === a.orderId));
  const captured = attempts.filter((a) => a.status === "CAPTURED" || a.status === "REFUNDED" || a.status === "PARTIALLY_REFUNDED").length;
  const failed = attempts.filter((a) => a.status === "FAILED").length;

  const branches = (await store.listBranches(staff.tenant.id)).filter((b) => !branchIds || branchIds.includes(b.id));
  let outOfStock = 0;
  for (const b of branches) outOfStock += (await store.listBranchMenuItems(staff.tenant.id, b.id)).filter((r) => !r.isAvailable).length;

  let delivery: SalesReportView["delivery"] = null;
  if (staff.tenant.features.delivery) {
    const assignments = await store.listAssignments(staff.tenant.id, { orderIds: orders.map((o) => o.id) });
    delivery = {
      assigned: assignments.length,
      delivered: assignments.filter((a) => a.status === "DELIVERED").length,
      failed: assignments.filter((a) => a.status === "FAILED").length,
    };
  }

  return {
    from: q.from,
    to: q.to,
    branchId: q.branchId ?? null,
    byCurrency: [...byCurrencyMap.values()],
    byDay: [...byDayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byHour,
    statusCounts,
    fulfillmentCounts,
    topItems: [...items.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 10),
    payments: {
      attempts: attempts.length,
      captured,
      failed,
      pending: attempts.length - captured - failed,
      successRate: captured + failed ? captured / (captured + failed) : null,
    },
    prepTimes: prepTimes(paid),
    outOfStockItems: outOfStock,
    delivery,
  };
}

export async function overview(store: DataStore, actor: Actor | null, branchId?: string): Promise<OverviewView> {
  const staff = requirePermission(actor, "reports.view");
  const tz = staff.tenant.timezone;
  const branchIds = await scopedBranchIds(store, staff, branchId);
  const today = todayIn(tz);
  const lastWeek = shiftDate(today, -7);
  const [todayOrders, lastWeekOrders] = await Promise.all([
    ordersInRange(store, staff.tenant.id, branchIds, today, today, tz),
    ordersInRange(store, staff.tenant.id, branchIds, lastWeek, lastWeek, tz),
  ]);
  // Compare against the same weekday last week, up to the same time of day.
  const nowLocal = localDateHour(new Date().toISOString(), tz).hour;
  const lastWeekSoFar = lastWeekOrders.filter((o) => localDateHour(o.createdAt, tz).hour <= nowLocal);
  const paidToday = todayOrders.filter((o) => isPaid(o) && o.currency === staff.tenant.currency);
  const paidLastWeek = lastWeekSoFar.filter((o) => isPaid(o) && o.currency === staff.tenant.currency);
  const gross = (os: Order[]) => os.reduce((s, o) => s + o.subtotalMinor, 0);
  const pct = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 100));

  const refunds = (await store.listRefunds(staff.tenant.id, { limit: 10_000 })).filter(
    (r) => r.status === "SUCCEEDED" && r.currency === staff.tenant.currency && localDateHour(r.createdAt, tz).date === today,
  );
  const scopedRefunds = refunds.filter((r) => !branchIds || todayOrders.some((o) => o.id === r.orderId));
  const prepToday = prepTimes(paidToday).averagePrepSeconds;
  const prepLast = prepTimes(paidLastWeek).averagePrepSeconds;

  const byHour = Array.from({ length: 13 }, (_, i) => ({ hour: i + 11, orders: 0 }));
  for (const o of paidToday) {
    const h = localDateHour(o.createdAt, tz).hour;
    const slot = byHour.find((x) => x.hour === h);
    if (slot) slot.orders += 1;
  }

  const live = await store.listOrders(staff.tenant.id, { branchIds, statuses: [...ACTIVE_KITCHEN_STATUSES], offset: 0, limit: 8 });
  const names = new Map((await store.listBranches(staff.tenant.id)).map((b) => [b.id, b.name]));
  const pendingPayments = await store.listOrders(staff.tenant.id, { branchIds, statuses: ["PENDING_PAYMENT"], offset: 0, limit: 1 });
  const allRefunds = await store.listRefunds(staff.tenant.id, { limit: 10_000 });
  const flagged = (await store.listPaymentAttempts(staff.tenant.id, { limit: 10_000 })).filter((a) => a.reviewFlag).length;

  return {
    date: today,
    currency: staff.tenant.currency,
    orders: paidToday.length,
    ordersChangePct: pct(paidToday.length, paidLastWeek.length),
    grossOrderValueMinor: gross(paidToday),
    grossChangePct: pct(gross(paidToday), gross(paidLastWeek)),
    averagePrepSeconds: prepToday,
    prepChangeSeconds: prepToday !== null && prepLast !== null ? prepToday - prepLast : null,
    refundsMinor: scopedRefunds.reduce((s, r) => s + r.amountMinor, 0),
    refundCount: scopedRefunds.length,
    byHour,
    live: live.items.map((o) => ({
      id: o.id,
      number: o.number,
      label: o.tableLabel ?? (o.fulfillmentType === "TAKEAWAY" ? "Takeaway" : "Delivery"),
      status: o.status,
      branchName: names.get(o.branchId) ?? "",
    })),
    attention: { pendingPayments: pendingPayments.total, failedRefunds: allRefunds.filter((r) => r.status === "FAILED").length, flaggedPayments: flagged },
  };
}
