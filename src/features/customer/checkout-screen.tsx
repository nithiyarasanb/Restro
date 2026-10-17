"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowLeft, Lock, Minus, Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { PaymentIntentView, PlacedOrderView, QuoteView } from "@/types/api";
import type { PlaceOrderInput } from "@/lib/validation";
import { checkoutFormSchema, type CheckoutFormValues } from "@/lib/validation";
import { apiFetch, ApiError, errorMessage, newIdempotencyKey } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { bpsToPercent, cn } from "@/lib/utils";
import { cart, cartCount, rememberOrder, useCart, type CartState } from "@/features/cart/cart-store";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState, Notice, Skeleton } from "@/components/ui/feedback";
import { DemoTag } from "@/components/ui/badge";

const noopSubscribe = () => () => {};

function menuHref(s: CartState) {
  const c = s.context;
  if (!c) return "/";
  return c.kind === "table" ? `/q/${c.qrRef}` : `/r/${c.tenantSlug}/b/${c.branchId}?type=${c.fulfillmentType}`;
}

function quoteBody(s: CartState) {
  const c = s.context!;
  return {
    context: c.kind === "table" ? { kind: "table" as const, qrRef: c.qrRef } : { kind: "branch" as const, tenantSlug: c.tenantSlug, branchId: c.branchId },
    fulfillmentType: c.kind === "table" ? ("DINE_IN" as const) : c.fulfillmentType,
    lines: s.lines.map((l) => ({
      menuItemId: l.menuItemId,
      variantId: l.variantId,
      modifierOptionIds: l.modifierOptionIds,
      quantity: l.quantity,
      notes: l.notes,
    })),
  };
}

export function CheckoutScreen() {
  const state = useCart();
  // The cart lives in localStorage: render the skeleton on the server, the cart after hydration.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  if (!hydrated) return <CheckoutSkeleton />;
  if (!state.context || state.lines.length === 0)
    return (
      <main id="main" className="mx-auto w-full max-w-lg flex-1 py-10">
        <EmptyState
          title="Your cart is empty"
          description="Add something from the menu to get started."
          action={
            <Link href={menuHref(state)} className={buttonClasses("primary")}>
              Back to menu
            </Link>
          }
        />
      </main>
    );
  return <Checkout state={state} />;
}

function Checkout({ state }: { state: CartState }) {
  const ctx = state.context!;
  const fulfillment = ctx.kind === "table" ? "DINE_IN" : ctx.fulfillmentType;
  const body = useMemo(() => quoteBody(state), [state]);
  const quote = useQuery({
    queryKey: ["quote", body],
    queryFn: ({ signal }) => apiFetch<QuoteView>("/public/quotes", { method: "POST", body, signal }),
    staleTime: 0,
    retry: false,
  });
  const lineIssues = useMemo(() => {
    const e = quote.error;
    if (!(e instanceof ApiError)) return new Map<number, string>();
    const lines = (e.details as { lines?: Array<{ index: number; message: string }> } | undefined)?.lines ?? [];
    return new Map(lines.map((l) => [l.index, l.message]));
  }, [quote.error]);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CheckoutFormValues>({ resolver: zodResolver(checkoutFormSchema), defaultValues: { name: "", phone: "", address: "", notes: "" } });

  // One idempotency key per distinct order request: a double tap or a retry after
  // a network error reuses it, so the server returns the same order.
  const [keys] = useState(() => new Map<string, string>());
  const keyFor = (sig: string) => {
    if (!keys.has(sig)) keys.set(sig, newIdempotencyKey("order"));
    return keys.get(sig)!;
  };

  const placeOrder = handleSubmit(async (form) => {
    if (fulfillment !== "DINE_IN") {
      const problems: Array<[keyof CheckoutFormValues, string]> = [];
      if (!form.name) problems.push(["name", "Name is required"]);
      if (!/^\+?[0-9 ()-]{7,20}$/.test(form.phone)) problems.push(["phone", "Enter a valid phone number"]);
      if (fulfillment === "DELIVERY" && !form.address) problems.push(["address", "Delivery address is required"]);
      problems.forEach(([field, message]) => setError(field, { message }));
      if (problems.length) return;
    }
    const request: PlaceOrderInput = {
      ...body,
      customer: { name: form.name || null, phone: form.phone || null, address: fulfillment === "DELIVERY" ? form.address || null : null },
      notes: form.notes || null,
    };
    let placed: PlacedOrderView;
    try {
      placed = await apiFetch<PlacedOrderView>("/public/orders", { method: "POST", body: request, idempotencyKey: keyFor(JSON.stringify(request)) });
    } catch (e) {
      if (e instanceof ApiError) {
        const fields = e.fieldErrors();
        for (const [path, message] of Object.entries(fields)) {
          const name = path.replace("customer.", "") as keyof CheckoutFormValues;
          if (["name", "phone", "address", "notes"].includes(name)) setError(name, { message });
        }
        void quote.refetch();
      }
      toast.error(errorMessage(e));
      return;
    }
    rememberOrder({
      orderId: placed.orderId,
      number: placed.number,
      trackingUrl: placed.trackingUrl,
      restaurantName: ctx.restaurantName,
      at: new Date().toISOString(),
    });
    cart.clear();
    try {
      const intent = await apiFetch<PaymentIntentView>(`/public/orders/${placed.orderId}/payment-intents`, {
        method: "POST",
        body: { token: placed.accessToken },
        idempotencyKey: `pay-${placed.orderId}-first`,
      });
      window.location.assign(intent.checkoutUrl);
    } catch (e) {
      toast.error(`Order #${placed.number} was created, but payment could not start: ${errorMessage(e)}`);
      window.location.assign(placed.trackingUrl);
    }
  });

  const q = quote.data;
  const currency = ctx.currency;
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col bg-surface sm:my-6 sm:rounded-3xl sm:border sm:border-line sm:shadow-[var(--shadow-card)]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-5">
        <div>
          <Link href={menuHref(state)} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Menu
          </Link>
          <h1 className="text-2xl font-black">Your order</h1>
          <p className="text-sm text-muted">
            {ctx.kind === "table" ? `${ctx.tableLabel} · ` : ""}
            {ctx.restaurantName} · {ctx.branchName} · {fulfillment === "DINE_IN" ? "Dine-in" : fulfillment === "TAKEAWAY" ? "Takeaway" : "Delivery"}
          </p>
        </div>
        <DemoTag>DEMO · TEST PAYMENTS</DemoTag>
      </header>

      <form onSubmit={placeOrder} className="flex flex-1 flex-col" noValidate>
        <section aria-label="Items" className="px-5">
          <ul>
            {state.lines.map((l, i) => (
              <li key={l.key} className={cn("flex gap-3 border-b border-dashed border-line py-4", lineIssues.has(i) && "rounded-lg bg-danger-50 px-2")}>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{l.name}</p>
                  <p className="text-xs text-muted">{[l.variantName, ...l.modifierLabels].filter(Boolean).join(" · ") || "Regular"}</p>
                  {l.notes && <p className="text-xs text-muted italic">“{l.notes}”</p>}
                  {lineIssues.has(i) && (
                    <p className="mt-1 text-xs font-bold text-danger-700" role="alert">
                      {lineIssues.get(i)}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => cart.setQuantity(l.key, l.quantity - 1)}
                      className="rounded-lg border border-line-strong p-1.5"
                      aria-label={`Decrease ${l.name}`}
                    >
                      {l.quantity === 1 ? <Trash2 className="size-3.5" aria-hidden /> : <Minus className="size-3.5" aria-hidden />}
                    </button>
                    <span className="w-8 text-center text-sm font-bold tabular" aria-label={`Quantity ${l.quantity}`}>
                      {l.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => cart.setQuantity(l.key, l.quantity + 1)}
                      className="rounded-lg border border-line-strong p-1.5"
                      aria-label={`Increase ${l.name}`}
                    >
                      <Plus className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
                <p className="font-bold tabular">
                  {q?.lines[i]
                    ? formatMoney(q.lines[i].lineTotalMinor, currency, { compact: true })
                    : formatMoney(l.unitEstimateMinor * l.quantity, currency, { compact: true })}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Totals" className="px-5 py-4" aria-live="polite">
          {quote.isPending ? (
            <div className="space-y-2" role="status">
              <span className="sr-only">Calculating total…</span>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : quote.error ? (
            <Notice tone="danger" title="We couldn't price your order">
              {errorMessage(quote.error)}
            </Notice>
          ) : q ? (
            <dl className="space-y-1.5 text-sm">
              <Row label="Subtotal" value={formatMoney(q.subtotalMinor, currency)} />
              {q.serviceChargeMinor > 0 && (
                <Row label={`Service charge (${bpsToPercent(q.serviceChargeBps)})`} value={formatMoney(q.serviceChargeMinor, currency)} />
              )}
              <Row label={`Tax (${bpsToPercent(q.taxRateBps)})`} value={formatMoney(q.taxMinor, currency)} />
              {q.deliveryFeeMinor > 0 && <Row label="Delivery fee" value={formatMoney(q.deliveryFeeMinor, currency)} />}
              <div className="flex justify-between border-t border-line pt-2 text-lg font-black">
                <dt>Total</dt>
                <dd className="tabular">{formatMoney(q.totalMinor, currency)}</dd>
              </div>
              <p className="flex items-center gap-1 text-xs text-muted">
                <ShieldCheck className="size-3.5" aria-hidden /> Final total is calculated and verified by the server.
              </p>
            </dl>
          ) : null}
        </section>

        <section aria-label="Your details" className="space-y-4 border-t border-line px-5 py-5">
          {fulfillment !== "DINE_IN" && (
            <>
              <h2 className="font-bold">{fulfillment === "DELIVERY" ? "Delivery details" : "Pickup details"}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" error={errors.name?.message} required>
                  {(p) => <Input {...p} autoComplete="name" {...register("name")} />}
                </Field>
                <Field label="Phone" error={errors.phone?.message} required hint="We'll only use this about this order.">
                  {(p) => <Input {...p} type="tel" autoComplete="tel" inputMode="tel" {...register("phone")} />}
                </Field>
              </div>
              {fulfillment === "DELIVERY" && (
                <Field label="Delivery address" error={errors.address?.message} required>
                  {(p) => <Textarea {...p} autoComplete="street-address" {...register("address")} />}
                </Field>
              )}
            </>
          )}
          <Field label="Note for the restaurant" error={errors.notes?.message} hint="Optional — allergies, cutlery, etc.">
            {(p) => <Input {...p} {...register("notes")} />}
          </Field>
          <div className="rounded-xl border border-line bg-canvas p-3 text-sm">
            <p className="flex items-center gap-1.5 font-bold">
              <Lock className="size-4" aria-hidden /> Pay securely
            </p>
            <p className="text-muted">Handled by the payment provider&apos;s hosted page. Card details never reach the restaurant or this platform.</p>
          </div>
        </section>

        <div className="sticky bottom-0 mt-auto border-t border-line bg-surface p-4 sm:rounded-b-3xl">
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting} disabled={!q || quote.isFetching || cartCount(state) === 0}>
            {q ? `Pay ${formatMoney(q.totalMinor, currency)}` : "Pay"}
          </Button>
        </div>
      </form>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-ink-soft">
      <dt>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

function CheckoutSkeleton() {
  return (
    <div role="status" className="mx-auto w-full max-w-2xl space-y-3 p-5 sm:my-6">
      <span className="sr-only">Loading your order…</span>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
      <Skeleton className="h-32" />
    </div>
  );
}
