"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { CreditCard, FlaskConical, Lock, Undo2 } from "lucide-react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { ErrorState, Notice, Skeleton } from "@/components/ui/feedback";
import { Checkbox } from "@/components/ui/field";

interface MockPayment {
  paymentId: string;
  amountMinor: number;
  currency: string;
  description: string;
  status: "PENDING" | "CAPTURED" | "FAILED";
  returnUrl: string;
}

interface Completion {
  returnUrl: string;
  eventId: string;
  deliveries: Array<{ status: number; body: unknown }>;
}

/**
 * MOCK PAYMENT PROVIDER — TEST ONLY. Stands in for a gateway's hosted page.
 * Completing here makes the "provider" send a signed webhook to the platform;
 * the return redirect itself proves nothing (NT-2).
 */
export function MockPayScreen({ paymentId }: { paymentId: string }) {
  const payment = useQuery({ queryKey: ["mock-pay", paymentId], queryFn: () => apiFetch<MockPayment>(`/mock-provider/payments/${paymentId}`), retry: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Completion | null>(null);
  const [opts, setOpts] = useState({ duplicate: false, tamperAmount: false, badSignature: false });

  const complete = async (outcome: "success" | "decline") => {
    setBusy(outcome);
    try {
      const r = await apiFetch<Completion>(`/mock-provider/payments/${paymentId}/complete`, { method: "POST", body: { outcome, ...opts } });
      setResult(r);
      setTimeout(() => window.location.assign(r.returnUrl), opts.duplicate || opts.tamperAmount || opts.badSignature ? 2500 : 900);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <main id="main" className="flex flex-1 items-center justify-center bg-[#eef1f6] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-4 rounded-xl border-2 border-dashed border-[#b45309] bg-[#fef3c7] px-4 py-2 text-center text-sm font-black text-[#78350f]">
          MOCK PAYMENT PROVIDER — TEST ONLY · NO REAL MONEY
        </div>
        <div className="overflow-hidden rounded-2xl bg-white shadow-[var(--shadow-pop)]">
          <div className="flex items-center justify-between bg-[#0f172a] px-5 py-4 text-white">
            <span className="flex items-center gap-2 font-black">
              <CreditCard className="size-5" aria-hidden /> MockPay
            </span>
            <span className="flex items-center gap-1 text-xs text-white/70">
              <Lock className="size-3.5" aria-hidden /> Secure checkout (simulated)
            </span>
          </div>
          <div className="p-5">
            {payment.isPending ? (
              <div className="space-y-3" role="status">
                <span className="sr-only">Loading payment…</span>
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-10 w-56" />
                <Skeleton className="h-12" />
              </div>
            ) : payment.error ? (
              <ErrorState
                title="Payment session not found"
                description="This test payment link is invalid or the server restarted (demo data resets on restart)."
              />
            ) : (
              <>
                <p className="text-sm text-muted">{payment.data.description}</p>
                <p className="mt-1 text-3xl font-black tabular">{formatMoney(payment.data.amountMinor, payment.data.currency)}</p>
                {payment.data.status !== "PENDING" && !result ? (
                  <Notice className="mt-4" tone="info" title={`This payment is already ${payment.data.status.toLowerCase()}`}>
                    <a className="font-semibold underline" href={payment.data.returnUrl}>
                      Return to the restaurant
                    </a>
                  </Notice>
                ) : result ? (
                  <div className="mt-4 space-y-2" role="status" aria-live="polite">
                    <Notice tone="success" title="Provider sent the webhook">
                      Redirecting you back to the restaurant…
                    </Notice>
                    <ul className="space-y-1 rounded-lg bg-canvas p-3 font-mono text-xs">
                      {result.deliveries.map((d, i) => (
                        <li key={i}>
                          Delivery {i + 1}: HTTP {d.status} → {JSON.stringify(d.body)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="mt-5 space-y-3">
                    <div className="rounded-xl border border-line p-3 text-sm">
                      <p className="font-semibold">Test card ending 4242</p>
                      <p className="text-muted">Any action below is simulated. UPI, cards and netbanking would appear here with a real provider.</p>
                    </div>
                    <Button
                      size="lg"
                      className="w-full bg-[#0f172a] hover:bg-[#1e293b]"
                      loading={busy === "success"}
                      disabled={!!busy}
                      onClick={() => complete("success")}
                    >
                      Pay {formatMoney(payment.data.amountMinor, payment.data.currency)}
                    </Button>
                    <Button variant="secondary" className="w-full" loading={busy === "decline"} disabled={!!busy} onClick={() => complete("decline")}>
                      Simulate a declined payment
                    </Button>
                    <details className="rounded-xl border border-dashed border-line-strong p-3 text-sm">
                      <summary className="flex cursor-pointer items-center gap-1.5 font-bold">
                        <FlaskConical className="size-4" aria-hidden /> Developer test controls
                      </summary>
                      <div className="mt-3 space-y-2">
                        <Checkbox
                          label="Deliver the webhook twice (duplicate)"
                          checked={opts.duplicate}
                          onChange={(e) => setOpts((o) => ({ ...o, duplicate: e.target.checked }))}
                        />
                        <Checkbox
                          label="Report a wrong amount (mismatch → flagged)"
                          checked={opts.tamperAmount}
                          onChange={(e) => setOpts((o) => ({ ...o, tamperAmount: e.target.checked }))}
                        />
                        <Checkbox
                          label="Sign with the wrong secret (rejected 401)"
                          checked={opts.badSignature}
                          onChange={(e) => setOpts((o) => ({ ...o, badSignature: e.target.checked }))}
                        />
                        <a href={payment.data.returnUrl} className="mt-1 inline-flex items-center gap-1.5 font-semibold text-info-700 underline">
                          <Undo2 className="size-4" aria-hidden /> Return to the restaurant without paying
                        </a>
                        <p className="text-xs text-muted">Returning without paying shows that a browser redirect alone never confirms an order.</p>
                      </div>
                    </details>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
