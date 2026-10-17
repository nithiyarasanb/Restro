"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, ReceiptText, RotateCcw, XCircle } from "lucide-react";
import type { CustomerOrderView, PaymentIntentView } from "@/types/api";
import type { OrderStatus } from "@/types/domain";
import { apiFetch, errorMessage, newIdempotencyKey } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { cn, formatTime } from "@/lib/utils";
import { useEventStream } from "@/hooks/use-event-stream";
import { Button } from "@/components/ui/button";
import { ErrorState, Notice, Skeleton } from "@/components/ui/feedback";
import { DemoTag } from "@/components/ui/badge";

interface Step {
  key: string;
  label: string;
  detail: (o: CustomerOrderView) => string | null;
  done: (o: CustomerOrderView) => boolean;
}

const RANK: Partial<Record<OrderStatus, number>> = {
  CONFIRMED: 1,
  ACCEPTED: 2,
  PREPARING: 3,
  READY: 4,
  OUT_FOR_DELIVERY: 5,
  SERVED: 6,
  PICKED_UP: 6,
  DELIVERED: 6,
  COMPLETED: 7,
};
const reached = (o: CustomerOrderView, s: OrderStatus) => (RANK[o.status] ?? 0) >= (RANK[s] ?? 99);

function stepsFor(o: CustomerOrderView): Step[] {
  const base: Step[] = [
    { key: "paid", label: "Payment confirmed", detail: (x) => (x.confirmedAt ? "Verified by server" : null), done: (x) => !!x.confirmedAt },
    {
      key: "accepted",
      label: "Order accepted",
      detail: (x) => (x.acceptedAt ? `Kitchen accepted at ${formatTime(x.acceptedAt)}` : null),
      done: (x) => reached(x, "ACCEPTED"),
    },
    { key: "preparing", label: "Preparing", detail: () => "The kitchen is cooking your food", done: (x) => reached(x, "PREPARING") },
    {
      key: "ready",
      label: o.fulfillmentType === "TAKEAWAY" ? "Ready for pickup" : "Ready",
      detail: (x) => (x.readyAt ? `Ready at ${formatTime(x.readyAt)}` : x.fulfillmentType === "DINE_IN" ? "We'll bring it to your table" : null),
      done: (x) => reached(x, "READY"),
    },
  ];
  if (o.fulfillmentType === "DELIVERY") base.push({ key: "out", label: "Out for delivery", detail: () => null, done: (x) => reached(x, "OUT_FOR_DELIVERY") });
  base.push({
    key: "handed",
    label: o.fulfillmentType === "DINE_IN" ? "Served" : o.fulfillmentType === "TAKEAWAY" ? "Picked up" : "Delivered",
    detail: (x) => (x.handedOverAt ? formatTime(x.handedOverAt) : null),
    done: (x) => !!x.handedOverAt,
  });
  return base;
}

export function OrderTracking({ orderId, token, fromPayment }: { orderId: string; token: string; fromPayment: boolean }) {
  const path = `/public/orders/${orderId}?t=${encodeURIComponent(token)}`;
  const order = useQuery({
    queryKey: ["customer-order", orderId],
    queryFn: () => apiFetch<CustomerOrderView>(path),
    refetchInterval: (q) => (q.state.data?.status === "PENDING_PAYMENT" ? 4_000 : 30_000),
  });
  const { state } = useEventStream(`/api/v1/stream?channel=order&orderId=${orderId}&t=${encodeURIComponent(token)}`, {
    onMessage: () => void order.refetch(),
    onReconnect: () => void order.refetch(),
  });
  const [retrying, setRetrying] = useState(false);

  const retryPayment = async () => {
    setRetrying(true);
    try {
      const intent = await apiFetch<PaymentIntentView>(`/public/orders/${orderId}/payment-intents`, {
        method: "POST",
        body: { token },
        idempotencyKey: newIdempotencyKey("pay"),
      });
      window.location.assign(intent.checkoutUrl);
    } catch (e) {
      toast.error(errorMessage(e));
      setRetrying(false);
    }
  };

  if (order.isPending)
    return (
      <div role="status" className="mx-auto w-full max-w-lg space-y-3 p-5">
        <span className="sr-only">Loading your order…</span>
        <Skeleton className="h-10 w-48" />
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    );
  if (order.error)
    return (
      <ErrorState
        title="We couldn't find this order"
        description="The tracking link may be incomplete. If you just paid, please show this screen to a member of staff."
      />
    );

  const o = order.data;
  const failedStatus = o.status === "REJECTED" || o.status === "CANCELLED" || o.status === "DELIVERY_FAILED";
  const steps = stepsFor(o);
  const current = steps.findIndex((s) => !s.done(o));

  return (
    <main id="main" className="mx-auto w-full max-w-lg flex-1 bg-surface sm:my-6 sm:rounded-3xl sm:border sm:border-line sm:shadow-[var(--shadow-card)]">
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-5">
        <div>
          <h1 className="text-2xl font-black">Order #{o.number}</h1>
          <p className="text-sm text-muted">
            {o.tableLabel ?? (o.fulfillmentType === "TAKEAWAY" ? "Takeaway" : "Delivery")} · {o.restaurantName} ·{" "}
            {o.paymentStatus === "CAPTURED" ? "Paid" : o.paymentStatus === "REFUNDED" ? "Refunded" : "Unpaid"}{" "}
            {formatMoney(o.totalMinor, o.currency, { compact: true })}
          </p>
        </div>
        {o.isDemo && <DemoTag>DEMO</DemoTag>}
      </header>

      <div className="px-5 py-5">
        {o.status === "PENDING_PAYMENT" ? (
          o.latestPayment?.status === "FAILED" || (!fromPayment && o.canPay) ? (
            <div className="space-y-3">
              <Notice
                tone={o.latestPayment?.status === "FAILED" ? "danger" : "warning"}
                title={o.latestPayment?.status === "FAILED" ? "Payment didn't go through" : "Payment not completed"}
              >
                {o.latestPayment?.failureReason ?? "Your order will be sent to the kitchen once payment is confirmed."} No money has been taken for this order.
              </Notice>
              <Button size="lg" className="w-full" loading={retrying} onClick={retryPayment} icon={<RotateCcw className="size-4" aria-hidden />}>
                Try paying again · {formatMoney(o.totalMinor, o.currency)}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl bg-canvas p-4" role="status" aria-live="polite">
              <Loader2 className="size-6 animate-spin text-brand-600" aria-hidden />
              <div>
                <p className="font-bold">Waiting for payment confirmation</p>
                <p className="text-sm text-muted">We confirm payments directly with the provider — this usually takes a few seconds.</p>
              </div>
            </div>
          )
        ) : failedStatus ? (
          <Notice
            tone="danger"
            title={
              o.status === "REJECTED"
                ? "The restaurant couldn't accept this order"
                : o.status === "CANCELLED"
                  ? "This order was cancelled"
                  : "Delivery could not be completed"
            }
          >
            {o.cancelReason && <span className="block">Reason: {o.cancelReason.replaceAll("_", " ").toLowerCase()}</span>}
            {o.refundedMinor > 0
              ? `A refund of ${formatMoney(o.refundedMinor, o.currency)} has been issued.`
              : o.paymentStatus === "CAPTURED"
                ? "A refund is being processed."
                : null}
          </Notice>
        ) : (
          <ol className="space-y-1" aria-label="Order progress">
            {steps.map((s, i) => {
              const done = s.done(o);
              const isCurrent = i === current;
              return (
                <li key={s.key} className="flex gap-3 py-2" aria-current={isCurrent ? "step" : undefined}>
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-black",
                      done ? "bg-ok-600 text-white" : isCurrent ? "bg-brand-600 text-white" : "bg-line text-muted",
                    )}
                    aria-hidden
                  >
                    {done ? <Check className="size-4" /> : i + 1}
                  </span>
                  <div>
                    <p className={cn("font-bold", done ? "text-ink" : isCurrent ? "text-brand-700" : "text-muted")}>
                      {s.label}
                      <span className="sr-only">{done ? " — done" : isCurrent ? " — in progress" : " — pending"}</span>
                    </p>
                    {(done || isCurrent) && s.detail(o) && <p className="text-sm text-muted">{s.detail(o)}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div
          className={cn("mt-5 rounded-xl px-4 py-3 text-sm", state === "live" ? "bg-ok-50 text-ok-700" : "bg-warn-50 text-warn-700")}
          role="status"
          aria-live="polite"
        >
          {state === "live" ? (
            <>
              <span className="font-bold">Live connection active.</span> If your signal drops, this page reloads the latest status.
            </>
          ) : (
            <>
              <span className="font-bold">Reconnecting…</span> Showing the last known status; it will refresh automatically.
            </>
          )}
        </div>

        <details className="mt-5 rounded-xl border border-line">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 font-bold">
            <ReceiptText className="size-4" aria-hidden /> Order details
          </summary>
          <div className="border-t border-line px-4 py-3 text-sm">
            <ul className="space-y-2">
              {o.items.map((i, idx) => (
                <li key={idx} className="flex justify-between gap-3">
                  <span>
                    {i.quantity}× {i.name}
                    {(i.variantName || i.modifiers.length > 0) && (
                      <span className="block text-xs text-muted">{[i.variantName, ...i.modifiers.map((m) => m.optionName)].filter(Boolean).join(" · ")}</span>
                    )}
                  </span>
                  <span className="tabular">{formatMoney(i.lineTotalMinor, o.currency)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1 border-t border-line pt-3 text-ink-soft">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd className="tabular">{formatMoney(o.subtotalMinor, o.currency)}</dd>
              </div>
              {o.serviceChargeMinor > 0 && (
                <div className="flex justify-between">
                  <dt>Service charge</dt>
                  <dd className="tabular">{formatMoney(o.serviceChargeMinor, o.currency)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt>Tax</dt>
                <dd className="tabular">{formatMoney(o.taxMinor, o.currency)}</dd>
              </div>
              {o.deliveryFeeMinor > 0 && (
                <div className="flex justify-between">
                  <dt>Delivery fee</dt>
                  <dd className="tabular">{formatMoney(o.deliveryFeeMinor, o.currency)}</dd>
                </div>
              )}
              <div className="flex justify-between font-black text-ink">
                <dt>Total</dt>
                <dd className="tabular">{formatMoney(o.totalMinor, o.currency)}</dd>
              </div>
            </dl>
          </div>
        </details>
        {failedStatus && (
          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
            <XCircle className="size-3.5" aria-hidden /> Questions? Show order #{o.number} to a member of staff.
          </p>
        )}
      </div>
    </main>
  );
}
