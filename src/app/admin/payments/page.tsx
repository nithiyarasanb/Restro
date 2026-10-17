import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Flag } from "lucide-react";
import { requireStaffPage } from "@/server/auth/current";
import { getRequestStore } from "@/server/store/request";
import { can } from "@/server/auth/actor";
import { paymentsOverview } from "@/server/services/payments";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { Badge, PaymentStatusBadge } from "@/components/ui/badge";
import { EmptyState, Notice, PageSkeleton } from "@/components/ui/feedback";
import { DataTable, Td, Th, Tr } from "@/components/ui/table";
import { ReconcileButton } from "@/features/payments/reconcile-button";
import { RetryRefundButton } from "@/features/orders/order-actions";

export const metadata: Metadata = { title: "Payments" };

export default function PaymentsPage() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading payments" />}>
      <Payments />
    </Suspense>
  );
}

async function Payments() {
  const actor = await requireStaffPage("payments.refund", "/admin/payments");
  const data = await paymentsOverview(await getRequestStore(), actor);
  const tz = actor.tenant.timezone;
  const c = data.connection;
  return (
    <>
      <PageHeader
        title="Payments"
        description="Customer payments go to your merchant account. They are only trusted after the provider's signed webhook or reconciliation confirms them."
        actions={can(actor, "payments.configure") && <ReconcileButton />}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Payment connection" />
          <CardBody className="space-y-2 text-sm">
            {c ? (
              <>
                <p className="flex items-center gap-2">
                  <span className="font-bold">{c.displayName}</span>
                  <Badge tone={c.status === "ACTIVE" ? "success" : "warning"}>{c.status.toLowerCase()}</Badge>
                </p>
                <p className="text-muted">
                  Merchant account <span className="font-mono">{c.merchantAccountId}</span>
                </p>
                {c.provider === "mock" && (
                  <Notice tone="warning" title="Test-only provider">
                    Live payments need the launch country and provider to be confirmed (BRD §21). No real money moves.
                  </Notice>
                )}
              </>
            ) : (
              <p className="text-muted">No payment connection. Contact platform support.</p>
            )}
          </CardBody>
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <StatCard label="Pending payments" value={data.reconciliation.pendingAttempts} hint="Waiting for a webhook; reconciled automatically after 2 min" />
          <StatCard label="Flagged for review" value={data.reconciliation.flaggedAttempts} hint="Amount, currency or account mismatches" deltaTone="bad" />
          <StatCard label="Failed refunds" value={data.reconciliation.failedRefunds} hint="Never reported as successful — retry below" />
          <StatCard label="Unpaid > 30 min" value={data.reconciliation.staleUnpaidOrders} hint="Cancelled by the next reconciliation run" />
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader title="Refunds" />
        {data.refunds.length === 0 ? (
          <EmptyState title="No refunds" />
        ) : (
          <DataTable caption="Refunds">
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th className="text-right">Amount</Th>
                <Th>Updated</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.refunds.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/admin/orders/${r.orderId}`} className="font-bold text-brand-700 hover:underline">
                      #{r.orderNumber}
                    </Link>
                  </Td>
                  <Td className="max-w-72 text-sm">
                    {r.reason}
                    {r.failureReason && <span className="block text-xs font-semibold text-danger-700">{r.failureReason}</span>}
                  </Td>
                  <Td>
                    <Badge tone={r.status === "SUCCEEDED" ? "success" : r.status === "FAILED" ? "danger" : "warning"}>{r.status.toLowerCase()}</Badge>
                  </Td>
                  <Td className="text-right tabular">{formatMoney(r.amountMinor, r.currency)}</Td>
                  <Td className="text-muted">{formatDateTime(r.updatedAt, tz)}</Td>
                  <Td>{r.status === "FAILED" && <RetryRefundButton refundId={r.id} />}</Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="Recent payment attempts" description="One order can have several attempts (retries); only one can capture." />
        <DataTable caption="Payment attempts">
          <thead>
            <tr>
              <Th>Order</Th>
              <Th>Provider reference</Th>
              <Th>Status</Th>
              <Th className="text-right">Amount</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {data.attempts.map((a) => (
              <Tr key={a.id}>
                <Td>
                  <Link href={`/admin/orders/${a.orderId}`} className="font-bold text-brand-700 hover:underline">
                    #{a.orderNumber}
                  </Link>
                </Td>
                <Td>
                  <span className="font-mono text-xs">{a.providerPaymentId ?? "—"}</span>
                  {a.reviewFlag && (
                    <span className="mt-0.5 flex items-center gap-1 text-xs font-bold text-danger-700">
                      <Flag className="size-3.5" aria-hidden /> {a.reviewFlag}
                    </span>
                  )}
                </Td>
                <Td>
                  <PaymentStatusBadge status={a.status} />
                </Td>
                <Td className="text-right tabular">{formatMoney(a.amountMinor, a.currency)}</Td>
                <Td className="text-muted">{formatDateTime(a.createdAt, tz)}</Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      </Card>

      {data.webhookEvents.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Webhook log" description="Every provider event is stored by id before processing; duplicates are ignored." />
          <DataTable caption="Webhook events">
            <thead>
              <tr>
                <Th>Event</Th>
                <Th>Type</Th>
                <Th>Outcome</Th>
                <Th>Received</Th>
              </tr>
            </thead>
            <tbody>
              {data.webhookEvents.map((e) => (
                <Tr key={e.id}>
                  <Td className="font-mono text-xs">{e.eventId}</Td>
                  <Td>{e.type}</Td>
                  <Td>
                    <Badge tone={e.outcome === "PROCESSED" ? "success" : e.outcome === "REJECTED" ? "danger" : "neutral"}>
                      {e.outcome.toLowerCase().replace("_", " ")}
                    </Badge>
                    {e.error && <span className="block text-xs text-danger-700">{e.error}</span>}
                  </Td>
                  <Td className="text-muted">{formatDateTime(e.receivedAt, tz)}</Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
      )}
    </>
  );
}
