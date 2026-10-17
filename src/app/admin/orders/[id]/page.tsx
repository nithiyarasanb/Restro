import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, Flag } from "lucide-react";
import { requireStaffPage } from "@/server/auth/current";
import { getRequestStore } from "@/server/store/request";
import { isDomainError } from "@/server/errors";
import { getOrderDetail } from "@/server/services/orders";
import { permissionsFor } from "@/lib/permissions";
import { FULFILLMENT_LABELS, ORDER_STATUS_META } from "@/lib/order-states";
import { formatMoney } from "@/lib/money";
import { bpsToPercent, formatDateTime } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, OrderStatusBadge, PaymentStatusBadge } from "@/components/ui/badge";
import { PageSkeleton } from "@/components/ui/feedback";
import { DataTable, Td, Th } from "@/components/ui/table";
import { OrderActions, RetryRefundButton } from "@/features/orders/order-actions";

export const metadata: Metadata = { title: "Order" };

export default function OrderDetailPage(props: PageProps<"/admin/orders/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading order" />}>
      <Detail params={props.params} />
    </Suspense>
  );
}

async function Detail({ params }: { params: PageProps<"/admin/orders/[id]">["params"] }) {
  const { id } = await params;
  const actor = await requireStaffPage("orders.view", `/admin/orders/${id}`);
  let detail;
  try {
    detail = await getOrderDetail(await getRequestStore(), actor, id);
  } catch (e) {
    if (isDomainError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const { order } = detail;
  const tz = actor.tenant.timezone;
  const money = (m: number) => formatMoney(m, order.currency);

  return (
    <>
      <Link href="/admin/orders" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Orders
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            Order #{order.number} <OrderStatusBadge status={order.status} /> <PaymentStatusBadge status={order.paymentStatus} />
          </span>
        }
        description={`${order.branchName} · ${order.tableLabel ?? FULFILLMENT_LABELS[order.fulfillmentType]} · placed ${formatDateTime(order.createdAt, tz)}`}
      />
      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Actions" />
            <CardBody>
              <OrderActions detail={detail} permissions={[...permissionsFor(actor.role)]} deliveryEnabled={actor.tenant.features.delivery} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Items" description="Snapshot taken at checkout — later menu changes never alter it." />
            <DataTable caption="Order items">
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th className="text-right">Qty</Th>
                  <Th className="text-right">Unit</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((i) => (
                  <tr key={i.id}>
                    <Td>
                      <p className="font-semibold">{i.nameSnapshot}</p>
                      {(i.variantName || i.modifiers.length > 0) && (
                        <p className="text-xs text-muted">
                          {[i.variantName, ...i.modifiers.map((m) => `${m.optionName}${m.priceDeltaMinor ? ` (+${money(m.priceDeltaMinor)})` : ""}`)]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                      {i.notes && <p className="text-xs text-warn-700">“{i.notes}”</p>}
                    </Td>
                    <Td className="text-right tabular">{i.quantity}</Td>
                    <Td className="text-right tabular">{money(i.unitPriceMinor)}</Td>
                    <Td className="text-right font-semibold tabular">{money(i.lineTotalMinor)}</Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <dl className="space-y-1 px-5 py-4 text-sm">
              {[
                ["Subtotal", order.subtotalMinor],
                ...(order.serviceChargeMinor ? [[`Service charge (${bpsToPercent(order.serviceChargeBps)})`, order.serviceChargeMinor] as const] : []),
                [`Tax (${bpsToPercent(order.taxRateBps)})`, order.taxMinor],
                ...(order.deliveryFeeMinor ? [["Delivery fee", order.deliveryFeeMinor] as const] : []),
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between text-ink-soft">
                  <dt>{label}</dt>
                  <dd className="tabular">{money(Number(value))}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-line pt-2 text-base font-black">
                <dt>Total</dt>
                <dd className="tabular">{money(order.totalMinor)}</dd>
              </div>
              {order.refundedMinor > 0 && (
                <div className="flex justify-between font-semibold text-danger-700">
                  <dt>Refunded</dt>
                  <dd className="tabular">−{money(order.refundedMinor)}</dd>
                </div>
              )}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Payments & refunds" />
            <DataTable caption="Payment attempts">
              <thead>
                <tr>
                  <Th>Attempt</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Updated</Th>
                </tr>
              </thead>
              <tbody>
                {detail.payments.map((p) => (
                  <tr key={p.id}>
                    <Td>
                      <span className="font-mono text-xs">{p.providerPaymentId ?? p.id.slice(0, 8)}</span>
                      <span className="block text-xs text-muted">{p.provider === "mock" ? "Mock provider (test)" : p.provider}</span>
                      {p.reviewFlag && (
                        <span className="mt-1 flex items-center gap-1 text-xs font-bold text-danger-700">
                          <Flag className="size-3.5" aria-hidden /> Review: {p.reviewFlag}
                        </span>
                      )}
                      {p.failureReason && <span className="block text-xs text-danger-700">{p.failureReason}</span>}
                    </Td>
                    <Td>
                      <PaymentStatusBadge status={p.status} />
                    </Td>
                    <Td className="text-right tabular">{formatMoney(p.amountMinor, p.currency)}</Td>
                    <Td className="text-muted">{formatDateTime(p.updatedAt, tz)}</Td>
                  </tr>
                ))}
                {detail.refunds.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <span className="font-semibold">Refund</span>
                      <span className="block text-xs text-muted">{r.reason}</span>
                      {r.failureReason && <span className="block text-xs font-semibold text-danger-700">{r.failureReason}</span>}
                    </Td>
                    <Td>
                      <span className="flex items-center gap-2">
                        <Badge tone={r.status === "SUCCEEDED" ? "success" : r.status === "FAILED" ? "danger" : "warning"}>{r.status.toLowerCase()}</Badge>
                        {r.status === "FAILED" && actor.role !== "CASHIER" && <RetryRefundButton refundId={r.id} />}
                      </span>
                    </Td>
                    <Td className="text-right tabular text-danger-700">−{formatMoney(r.amountMinor, r.currency)}</Td>
                    <Td className="text-muted">{formatDateTime(r.updatedAt, tz)}</Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Card>
        </div>
        <div className="space-y-4">
          {(order.customerName || order.customerPhone || order.deliveryAddress || order.notes) && (
            <Card>
              <CardHeader title="Guest" />
              <CardBody className="space-y-1 text-sm">
                {order.customerName && <p className="font-semibold">{order.customerName}</p>}
                {order.customerPhone && <p>{order.customerPhone}</p>}
                {order.deliveryAddress && <p className="text-muted">{order.deliveryAddress}</p>}
                {order.notes && <p className="rounded-lg bg-warn-50 px-2 py-1 text-warn-700">Note: {order.notes}</p>}
              </CardBody>
            </Card>
          )}
          {detail.delivery && (
            <Card>
              <CardHeader
                title="Delivery"
                description={`Runner: ${detail.delivery.runnerName}`}
                actions={<Badge tone="accent">{detail.delivery.status.toLowerCase().replace("_", " ")}</Badge>}
              />
              <ol className="space-y-1 px-5 py-4 text-sm">
                {detail.delivery.events.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span>
                      {e.type.replace("_", " ").toLowerCase()}
                      {e.note && <span className="text-muted"> — {e.note}</span>}
                    </span>
                    <span className="text-muted">{formatDateTime(e.createdAt, tz)}</span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
          <Card>
            <CardHeader title="Status history" description="Every transition is timestamped and attributed." />
            <ol className="relative space-y-4 px-5 py-4">
              {detail.history.map((h) => (
                <li key={h.id} className="relative border-l-2 border-line pl-4">
                  <span className="absolute top-1 -left-[7px] size-3 rounded-full bg-brand-500 ring-2 ring-surface" aria-hidden />
                  <p className="text-sm font-bold">{ORDER_STATUS_META[h.toStatus].label}</p>
                  <p className="text-xs text-muted">
                    {formatDateTime(h.createdAt, tz)} · {h.actorLabel}
                    {h.reason && ` · ${h.reason}`}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
