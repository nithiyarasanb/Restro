import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle } from "lucide-react";
import { requireStaffPage } from "@/server/auth/current";
import { getRequestStore } from "@/server/store/request";
import { overview } from "@/server/services/reports";
import { listBranches } from "@/server/services/tenancy";
import { formatMoney } from "@/lib/money";
import { formatDuration } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { OrderStatusBadge } from "@/components/ui/badge";
import { EmptyState, Notice, PageSkeleton } from "@/components/ui/feedback";
import { ColumnChart } from "@/components/ui/column-chart";
import { BranchFilter } from "@/features/admin/branch-filter";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage(props: PageProps<"/admin">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading overview" />}>
      <Overview searchParams={props.searchParams} />
    </Suspense>
  );
}

const pct = (n: number | null) => (n === null ? "No data last week" : `${n > 0 ? "+" : ""}${n}% vs same day last week`);

async function Overview({ searchParams }: { searchParams: PageProps<"/admin">["searchParams"] }) {
  const actor = await requireStaffPage("reports.view", "/admin");
  const sp = await searchParams;
  const store = await getRequestStore();
  const branches = await listBranches(store, actor);
  const branchId = typeof sp.branch === "string" && branches.some((b) => b.id === sp.branch) ? sp.branch : undefined;
  const data = await overview(store, actor, branchId);
  const scope = branchId ? branches.find((b) => b.id === branchId)!.name : branches.length > 1 ? "All branches" : branches[0]?.name;

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${actor.tenant.name} · ${scope} · Today`}
        actions={<BranchFilter branches={branches} value={branchId ?? ""} />}
      />
      {sp.denied === "1" && <Notice tone="warning" className="mb-4" title="You don't have access to that page." />}
      {(data.attention.pendingPayments > 0 || data.attention.failedRefunds > 0 || data.attention.flaggedPayments > 0) && (
        <div className="mb-4 flex flex-wrap gap-2" role="status">
          {data.attention.failedRefunds > 0 && <AttentionLink href="/admin/payments" text={`${data.attention.failedRefunds} failed refund(s) need a retry`} />}
          {data.attention.flaggedPayments > 0 && (
            <AttentionLink href="/admin/payments" text={`${data.attention.flaggedPayments} payment(s) flagged for review`} />
          )}
          {data.attention.pendingPayments > 0 && (
            <AttentionLink href="/admin/orders?status=PENDING_PAYMENT" text={`${data.attention.pendingPayments} order(s) awaiting payment`} />
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Orders" value={data.orders} delta={pct(data.ordersChangePct)} deltaTone={(data.ordersChangePct ?? 0) >= 0 ? "good" : "bad"} />
        <StatCard
          label="Gross order value"
          value={formatMoney(data.grossOrderValueMinor, data.currency, { compact: true })}
          delta={pct(data.grossChangePct)}
          deltaTone={(data.grossChangePct ?? 0) >= 0 ? "good" : "bad"}
        />
        <StatCard
          label="Avg prep time"
          value={formatDuration(data.averagePrepSeconds)}
          delta={
            data.prepChangeSeconds === null
              ? "No comparison"
              : `${data.prepChangeSeconds <= 0 ? "−" : "+"}${formatDuration(Math.abs(data.prepChangeSeconds))} vs last week`
          }
          deltaTone={data.prepChangeSeconds !== null && data.prepChangeSeconds <= 0 ? "good" : "bad"}
        />
        <StatCard
          label="Refunds"
          value={formatMoney(data.refundsMinor, data.currency, { compact: true })}
          delta={`${data.refundCount} order(s)`}
          deltaTone={data.refundCount > 0 ? "bad" : "neutral"}
        />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader title="Paid orders by hour" description="Today, restaurant local time (11:00–23:00)" />
          <CardBody>
            <ColumnChart
              title="Paid orders by hour today"
              valueLabel="Orders"
              data={data.byHour.map((h) => ({
                key: String(h.hour),
                label: `${((h.hour + 11) % 12) + 1}${h.hour < 12 ? "a" : "p"}`,
                value: h.orders,
                display: `${h.orders} order${h.orders === 1 ? "" : "s"}`,
              }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Live orders"
            actions={
              <Link href="/admin/orders" className="text-sm font-semibold text-brand-700 hover:underline">
                All orders
              </Link>
            }
          />
          {data.live.length === 0 ? (
            <EmptyState title="No live orders" description="Paid orders in the kitchen appear here." />
          ) : (
            <ul className="divide-y divide-line">
              {data.live.map((o) => (
                <li key={o.id}>
                  <Link href={`/admin/orders/${o.id}`} className="flex items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-canvas">
                    <span>
                      <span className="font-bold">#{o.number}</span> · {o.label}
                      {branches.length > 1 && <span className="text-muted"> · {o.branchName}</span>}
                    </span>
                    <OrderStatusBadge status={o.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function AttentionLink({ href, text }: { href: string; text: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-full border border-warn-600/30 bg-warn-50 px-3 py-1.5 text-sm font-semibold text-warn-700 hover:bg-warn-50/70"
    >
      <AlertTriangle className="size-4" aria-hidden /> {text}
    </Link>
  );
}
