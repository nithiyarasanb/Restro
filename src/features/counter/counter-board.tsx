"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing, CircleAlert, Clock3 } from "lucide-react";
import type { StaffOrderView } from "@/types/api";
import { FULFILLMENT_LABELS } from "@/lib/order-states";
import { apiFetch } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { elapsed, formatTime } from "@/lib/utils";
import { useEventStream } from "@/hooks/use-event-stream";
import { useNow } from "@/hooks/use-now";
import { ConnectionPill, StaleBanner } from "@/components/ui/connection-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { useTransitionOrder } from "@/features/staff/use-transition-order";

interface Board {
  ready: StaffOrderView[];
  awaitingPayment: StaffOrderView[];
  exceptions: StaffOrderView[];
}

export function CounterBoard({ branches, canOpenAdmin }: { branches: Array<{ id: string; name: string }>; canOpenAdmin: boolean }) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const now = useNow(1000);
  const board = useQuery({
    queryKey: ["counter", branchId],
    queryFn: () => apiFetch<Board>(`/counter?branchId=${branchId}`),
    enabled: !!branchId,
    refetchInterval: 60_000,
  });
  const { state, lastBeat } = useEventStream(branchId ? `/api/v1/stream?channel=orders&branchId=${branchId}` : null, {
    onMessage: (m) => {
      if (m.payload.status === "READY" && m.payload.previousStatus !== "READY")
        toast.success(`Order #${String(m.payload.number)} is ready${m.payload.tableLabel ? ` for ${String(m.payload.tableLabel)}` : ""}`, {
          icon: <BellRing className="size-4" />,
        });
      void board.refetch();
    },
    onReconnect: () => void board.refetch(),
  });
  const transition = useTransitionOrder([["counter"]]);
  const orderLink = (o: StaffOrderView) => (canOpenAdmin ? `/admin/orders/${o.id}` : null);

  return (
    <div className="flex flex-1 flex-col">
      <StaleBanner state={state} lastBeat={lastBeat} />
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        {branches.length > 1 && (
          <label className="flex items-center gap-2 text-sm font-semibold">
            Branch
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="h-9 rounded-lg border border-line-strong px-2">
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="ml-auto">
          <ConnectionPill state={state} className={state === "connecting" ? "bg-ink/10 text-ink" : undefined} />
        </div>
      </div>
      {board.error ? (
        <div className="p-6">
          <ErrorState description="The counter board could not be loaded." action={<Button onClick={() => board.refetch()}>Retry</Button>} />
        </div>
      ) : (
        <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader
              title={`Ready for handover · ${board.data?.ready.length ?? "…"}`}
              description="Hand food to the guest, then confirm here. Delivery orders wait for their runner."
            />
            <ul className="divide-y divide-line" aria-busy={board.isPending}>
              {board.isPending &&
                [1, 2, 3].map((i) => (
                  <li key={i} className="p-4">
                    <Skeleton className="h-14" />
                  </li>
                ))}
              {board.data?.ready.length === 0 && (
                <li>
                  <EmptyState
                    title="Nothing waiting"
                    description="Orders appear here the moment the kitchen marks them ready."
                    icon={<BellRing className="size-6" />}
                  />
                </li>
              )}
              {board.data?.ready.map((o) => {
                const busy = transition.isPending && transition.variables?.orderId === o.id;
                return (
                  <li key={o.id} aria-label={`Order #${o.number}`} className="flex flex-wrap items-center gap-4 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-black">
                        #{o.number} · {o.tableLabel ?? FULFILLMENT_LABELS[o.fulfillmentType]}
                        {o.customerName && <span className="font-semibold text-muted"> · {o.customerName}</span>}
                      </p>
                      <p className="text-sm text-muted">{o.items.map((i) => `${i.quantity}× ${i.nameSnapshot}`).join(", ")}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-ok-700">
                        <Clock3 className="size-3.5" aria-hidden /> Ready for {o.readyAt ? elapsed(o.readyAt, now) : "—"}
                      </p>
                    </div>
                    {o.fulfillmentType === "DELIVERY" ? (
                      orderLink(o) ? (
                        <Link href={orderLink(o)!} className="rounded-lg border border-line-strong px-4 py-2.5 text-sm font-bold hover:bg-canvas">
                          Runner assignment
                        </Link>
                      ) : (
                        <span className="text-sm font-semibold text-muted">Waiting for runner</span>
                      )
                    ) : (
                      <Button
                        variant="success"
                        size="lg"
                        loading={busy}
                        onClick={() =>
                          transition.mutate(
                            { orderId: o.id, number: o.number, action: o.fulfillmentType === "DINE_IN" ? "serve" : "pickup", expectedVersion: o.version },
                            { onSuccess: () => toast.success(`Order #${o.number} completed`) },
                          )
                        }
                      >
                        {o.fulfillmentType === "DINE_IN" ? "Hand over" : "Picked up"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader
                as="h3"
                title={`Awaiting payment · ${board.data?.awaitingPayment.length ?? "…"}`}
                description="Not sent to the kitchen until the provider confirms payment."
              />
              <ul className="divide-y divide-line text-sm">
                {board.data?.awaitingPayment.length === 0 && <li className="px-5 py-4 text-muted">None</li>}
                {board.data?.awaitingPayment.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 px-5 py-3">
                    <span>
                      <span className="font-bold">#{o.number}</span> · {o.tableLabel ?? FULFILLMENT_LABELS[o.fulfillmentType]} · {formatTime(o.createdAt)}
                    </span>
                    <PaymentStatusBadge status={o.paymentStatus} />
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader as="h3" title="Exceptions (last 12 h)" description="Rejected, cancelled or failed orders — explain to guests and check refunds." />
              <ul className="divide-y divide-line text-sm">
                {board.data?.exceptions.length === 0 && <li className="px-5 py-4 text-muted">None</li>}
                {board.data?.exceptions.map((o) => (
                  <li key={o.id} className="flex items-start justify-between gap-2 px-5 py-3">
                    <span>
                      <CircleAlert className="mr-1 inline size-4 text-danger-600" aria-hidden />
                      <span className="font-bold">#{o.number}</span> · {formatMoney(o.totalMinor, o.currency)}
                      {o.cancelReason && <span className="block text-xs text-muted">{o.cancelReason}</span>}
                    </span>
                    <OrderStatusBadge status={o.status} />
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
