import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Search } from "lucide-react";
import { requireStaffPage } from "@/server/auth/current";
import { getRequestStore } from "@/server/store/request";
import { listOrders } from "@/server/services/orders";
import { listBranches } from "@/server/services/tenancy";
import { orderListQuerySchema } from "@/lib/validation";
import { FULFILLMENT_LABELS, ORDER_STATUS_META } from "@/lib/order-states";
import { ORDER_STATUSES, FULFILLMENT_TYPES } from "@/types/domain";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { DataTable, Td, Th, Tr } from "@/components/ui/table";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/ui/badge";
import { EmptyState, Notice, PageSkeleton } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage(props: PageProps<"/admin/orders">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading orders" />}>
      <Orders searchParams={props.searchParams} />
    </Suspense>
  );
}

const input = "h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm";

async function Orders({ searchParams }: { searchParams: PageProps<"/admin/orders">["searchParams"] }) {
  const actor = await requireStaffPage("orders.view", "/admin/orders");
  const raw = Object.fromEntries(Object.entries(await searchParams).filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, string>;
  const parsed = orderListQuerySchema.safeParse({ ...raw, branchId: raw.branch });
  const q = parsed.success ? parsed.data : orderListQuerySchema.parse({});
  const store = await getRequestStore();
  const [branches, result] = await Promise.all([listBranches(store, actor), listOrders(store, actor, q)]);
  const hrefFor = (page: number) => `/admin/orders?${new URLSearchParams({ ...raw, page: String(page) }).toString()}`;

  return (
    <>
      <PageHeader title="Orders" description="Search, filter and open any order in your branches." />
      {!parsed.success && <Notice tone="warning" className="mb-4" title="Some filters were invalid and have been ignored." />}
      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-4" role="search" aria-label="Filter orders">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Search
            <span className="relative">
              <Search className="absolute top-2.5 left-2 size-4 text-muted" aria-hidden />
              <input name="q" defaultValue={raw.q} placeholder="#, name, phone, table" className={`${input} w-52 pl-8`} />
            </span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Status
            <select name="status" defaultValue={raw.status ?? ""} className={input}>
              <option value="">Any</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ORDER_STATUS_META[s].label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Type
            <select name="fulfillmentType" defaultValue={raw.fulfillmentType ?? ""} className={input}>
              <option value="">Any</option>
              {FULFILLMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FULFILLMENT_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          {branches.length > 1 && (
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              Branch
              <select name="branch" defaultValue={raw.branch ?? ""} className={input}>
                <option value="">All</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            From
            <input type="date" name="from" defaultValue={raw.from} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            To
            <input type="date" name="to" defaultValue={raw.to} className={input} />
          </label>
          <button type="submit" className={buttonClasses("dark", "sm", "h-9")}>
            Apply
          </button>
          {Object.keys(raw).length > 0 && (
            <Link href="/admin/orders" className="h-9 px-2 text-sm leading-9 font-semibold text-muted hover:text-ink">
              Clear
            </Link>
          )}
        </form>
        {result.items.length === 0 ? (
          <EmptyState title="No orders match" description="Try a wider date range or clear the filters." />
        ) : (
          <>
            <DataTable caption="Orders">
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th>Placed</Th>
                  <Th>Where</Th>
                  {branches.length > 1 && <Th>Branch</Th>}
                  <Th>Status</Th>
                  <Th>Payment</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((o) => (
                  <Tr key={o.id}>
                    <Td>
                      <Link href={`/admin/orders/${o.id}`} className="font-bold text-brand-700 hover:underline">
                        #{o.number}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap text-muted">{formatDateTime(o.createdAt, actor.tenant.timezone)}</Td>
                    <Td>
                      {o.tableLabel ?? FULFILLMENT_LABELS[o.fulfillmentType]}
                      {o.customerName && <span className="block text-xs text-muted">{o.customerName}</span>}
                    </Td>
                    {branches.length > 1 && <Td>{o.branchName}</Td>}
                    <Td>
                      <OrderStatusBadge status={o.status} />
                    </Td>
                    <Td>
                      <PaymentStatusBadge status={o.paymentStatus} />
                    </Td>
                    <Td className="text-right font-semibold tabular">{formatMoney(o.totalMinor, o.currency)}</Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={hrefFor} />
          </>
        )}
      </Card>
    </>
  );
}
