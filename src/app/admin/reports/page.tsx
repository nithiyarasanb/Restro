import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaffPage } from "@/server/auth/current";
import { getRequestStore } from "@/server/store/request";
import { salesReport, todayIn } from "@/server/services/reports";
import { listBranches } from "@/server/services/tenancy";
import { reportQuerySchema } from "@/lib/validation";
import { FULFILLMENT_LABELS, ORDER_STATUS_META } from "@/lib/order-states";
import { formatMoney } from "@/lib/money";
import { formatDuration } from "@/lib/utils";
import type { OrderStatus, FulfillmentType } from "@/types/domain";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { DataTable, Td, Th } from "@/components/ui/table";
import { EmptyState, Notice, PageSkeleton } from "@/components/ui/feedback";
import { ColumnChart } from "@/components/ui/column-chart";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage(props: PageProps<"/admin/reports">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading reports" />}>
      <Reports searchParams={props.searchParams} />
    </Suspense>
  );
}

function shift(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function Reports({ searchParams }: { searchParams: PageProps<"/admin/reports">["searchParams"] }) {
  const actor = await requireStaffPage("reports.view", "/admin/reports");
  const sp = await searchParams;
  const today = todayIn(actor.tenant.timezone);
  const input = {
    from: typeof sp.from === "string" ? sp.from : shift(today, -13),
    to: typeof sp.to === "string" ? sp.to : today,
    branchId: typeof sp.branch === "string" && sp.branch ? sp.branch : undefined,
  };
  const parsed = reportQuerySchema.safeParse(input);
  const store = await getRequestStore();
  const branches = await listBranches(store, actor);
  const q = parsed.success ? parsed.data : { from: shift(today, -13), to: today };
  const r = await salesReport(store, actor, q);
  const field = "h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm";

  return (
    <>
      <PageHeader
        title="Reports"
        description="Order value, tax, fees, refunds and net collected are separate figures. Each currency is reported on its own — never summed."
      />
      <form className="mb-4 flex flex-wrap items-end gap-3" aria-label="Report filters">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          From
          <input type="date" name="from" defaultValue={q.from} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          To
          <input type="date" name="to" defaultValue={q.to} className={field} />
        </label>
        {branches.length > 1 && (
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Branch
            <select name="branch" defaultValue={q.branchId ?? ""} className={field}>
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className={buttonClasses("dark", "sm", "h-9")}>
          Update
        </button>
      </form>
      {!parsed.success && <Notice tone="warning" className="mb-4" title={parsed.error.issues[0].message} />}

      {r.byCurrency.length === 0 ? (
        <Card>
          <EmptyState title="No paid orders in this period" description="Try a wider date range." />
        </Card>
      ) : (
        r.byCurrency.map((c) => (
          <section key={c.currency} aria-label={`Totals in ${c.currency}`} className="mb-4">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard
                label={`Gross order value · ${c.currency}`}
                value={formatMoney(c.grossOrderValueMinor, c.currency, { compact: true })}
                hint={`${c.orders} paid orders · avg ${formatMoney(c.averageOrderValueMinor, c.currency, { compact: true })}`}
              />
              <StatCard
                label="Tax & fees"
                value={formatMoney(c.taxMinor + c.serviceChargeMinor + c.deliveryFeesMinor, c.currency, { compact: true })}
                hint={`Tax ${formatMoney(c.taxMinor, c.currency, { compact: true })} · service ${formatMoney(c.serviceChargeMinor, c.currency, { compact: true })} · delivery ${formatMoney(c.deliveryFeesMinor, c.currency, { compact: true })}`}
              />
              <StatCard
                label="Refunds"
                value={formatMoney(c.refundsMinor, c.currency, { compact: true })}
                hint={`Discounts ${formatMoney(c.discountsMinor, c.currency, { compact: true })}`}
              />
              <StatCard
                label="Net collected"
                value={formatMoney(c.netCollectedMinor, c.currency, { compact: true })}
                hint="Total charged minus refunds (before provider fees)"
              />
            </div>
          </section>
        ))
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Gross order value by day" description={`${r.from} to ${r.to} · ${actor.tenant.currency}`} />
          <CardBody>
            <ColumnChart
              title="Gross order value by day"
              valueLabel={`Gross (${actor.tenant.currency})`}
              tickCurrency={actor.tenant.currency}
              data={r.byDay
                .filter((d) => d.currency === actor.tenant.currency)
                .map((d) => ({
                  key: d.date,
                  label: d.date.slice(5),
                  value: d.grossOrderValueMinor,
                  display: formatMoney(d.grossOrderValueMinor, d.currency, { compact: true }),
                }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Paid orders by hour" description="All days in range, restaurant local time" />
          <CardBody>
            <ColumnChart
              title="Paid orders by hour of day"
              valueLabel="Orders"
              data={r.byHour
                .filter((h) => h.hour >= 7)
                .map((h) => ({ key: String(h.hour), label: String(h.hour).padStart(2, "0"), value: h.orders, display: `${h.orders} orders` }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Kitchen times" description={`Averages over ${r.prepTimes.sampleSize} orders`} />
          <CardBody>
            <dl className="grid grid-cols-3 gap-4 text-center">
              {[
                ["Time to accept", r.prepTimes.averageAcceptSeconds],
                ["Preparation", r.prepTimes.averagePrepSeconds],
                ["Ready → handover", r.prepTimes.averageHandoverSeconds],
              ].map(([label, v]) => (
                <div key={String(label)}>
                  <dt className="text-xs font-semibold text-muted uppercase">{label}</dt>
                  <dd className="mt-1 text-xl font-black tabular">{formatDuration(v as number | null)}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Payments" />
          <CardBody>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted">Attempts</dt>
                <dd className="text-xl font-black tabular">{r.payments.attempts}</dd>
              </div>
              <div>
                <dt className="text-muted">Captured</dt>
                <dd className="text-xl font-black tabular">{r.payments.captured}</dd>
              </div>
              <div>
                <dt className="text-muted">Failed</dt>
                <dd className="text-xl font-black tabular">{r.payments.failed}</dd>
              </div>
              <div>
                <dt className="text-muted">Success rate</dt>
                <dd className="text-xl font-black tabular">{r.payments.successRate === null ? "—" : `${Math.round(r.payments.successRate * 100)}%`}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Top items" />
          <DataTable caption="Top items by quantity">
            <thead>
              <tr>
                <Th>Item</Th>
                <Th className="text-right">Qty</Th>
                <Th className="text-right">Revenue</Th>
              </tr>
            </thead>
            <tbody>
              {r.topItems.map((i) => (
                <tr key={`${i.name}-${i.currency}`}>
                  <Td>{i.name}</Td>
                  <Td className="text-right tabular">{i.quantity}</Td>
                  <Td className="text-right tabular">{formatMoney(i.revenueMinor, i.currency, { compact: true })}</Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
        <Card>
          <CardHeader title="Orders by status & type" description={`${r.outOfStockItems} item(s) currently marked sold out`} />
          <CardBody className="grid gap-6 sm:grid-cols-2">
            <dl className="space-y-1 text-sm">
              {(Object.entries(r.statusCounts) as Array<[OrderStatus, number]>).map(([s, n]) => (
                <div key={s} className="flex justify-between">
                  <dt>{ORDER_STATUS_META[s].label}</dt>
                  <dd className="font-semibold tabular">{n}</dd>
                </div>
              ))}
            </dl>
            <dl className="space-y-1 text-sm">
              {(Object.entries(r.fulfillmentCounts) as Array<[FulfillmentType, number]>).map(([t, n]) => (
                <div key={t} className="flex justify-between">
                  <dt>{FULFILLMENT_LABELS[t]}</dt>
                  <dd className="font-semibold tabular">{n}</dd>
                </div>
              ))}
            </dl>
            {r.delivery && (
              <p className="mt-2 border-t border-line pt-2 text-sm text-muted sm:col-span-2">
                Delivery: {r.delivery.assigned} assigned · {r.delivery.delivered} delivered · {r.delivery.failed} failed
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
