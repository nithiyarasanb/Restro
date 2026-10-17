"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { OrderDetailView } from "@/types/api";
import type { Refund } from "@/types/domain";
import { availableActions, type TransitionRule } from "@/lib/order-states";
import { apiFetch, ApiError, errorMessage, newIdempotencyKey } from "@/lib/api-client";
import { formatMoney, parseMajor, toMajorString } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

interface Props {
  detail: OrderDetailView;
  permissions: string[];
  deliveryEnabled: boolean;
}

/** Staff actions on one order. Every call is re-authorised and version-checked by the API. */
export function OrderActions({ detail, permissions, deliveryEnabled }: Props) {
  const router = useRouter();
  const { order } = detail;
  const [busy, setBusy] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<TransitionRule | null>(null);
  const [reason, setReason] = useState("");
  const [refundOpen, setRefundOpen] = useState(false);
  const actions = availableActions(order.status, order.fulfillmentType).filter(
    (a) => a.permission !== "SYSTEM" && a.permission !== "delivery.run" && permissions.includes(a.permission),
  );

  const run = async (rule: TransitionRule, why?: string) => {
    setBusy(rule.action);
    try {
      const r = await apiFetch<{ warnings: string[]; refund: Refund | null }>(`/orders/${order.id}/transitions`, {
        method: "POST",
        body: { action: rule.action, expectedVersion: order.version, reason: why ?? null },
      });
      toast.success(`${rule.label}: done`);
      r.warnings.forEach((w) => toast.warning(w));
      if (r.refund)
        toast[r.refund.status === "FAILED" ? "error" : "info"](
          r.refund.status === "FAILED" ? `Refund failed: ${r.refund.failureReason}` : `Refund ${r.refund.status.toLowerCase()}`,
        );
    } catch (e) {
      toast[e instanceof ApiError && e.code === "STALE_STATE" ? "info" : "error"](errorMessage(e));
    } finally {
      setBusy(null);
      setReasonFor(null);
      setReason("");
      router.refresh();
    }
  };

  const canRefund = permissions.includes("payments.refund") && detail.refundableMinor > 0;
  const canAssign =
    deliveryEnabled &&
    permissions.includes("delivery.assign") &&
    order.fulfillmentType === "DELIVERY" &&
    ["CONFIRMED", "ACCEPTED", "PREPARING", "READY"].includes(order.status) &&
    detail.delivery?.status !== "PICKED_UP";

  if (actions.length === 0 && !canRefund && !canAssign) return <p className="text-sm text-muted">No actions available for this order.</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={a.action}
            variant={a.action === "cancel" ? "danger" : a.action === "reject" ? "secondary" : "primary"}
            loading={busy === a.action}
            disabled={!!busy}
            onClick={() => (a.reasonRequired ? setReasonFor(a) : run(a))}
          >
            {a.label}
          </Button>
        ))}
        {canRefund && (
          <Button variant="secondary" onClick={() => setRefundOpen(true)}>
            Refund…
          </Button>
        )}
      </div>
      {canAssign && <AssignRunner detail={detail} onDone={() => router.refresh()} />}

      {reasonFor && (
        <Dialog
          open
          size="sm"
          onClose={() => setReasonFor(null)}
          title={`${reasonFor.label} #${order.number}?`}
          description={order.paymentStatus === "CAPTURED" ? "The guest has paid; a full refund starts automatically." : "The guest has not been charged."}
          footer={
            <>
              <Button variant="secondary" onClick={() => setReasonFor(null)}>
                Back
              </Button>
              <Button variant="danger" disabled={!reason.trim()} loading={!!busy} onClick={() => run(reasonFor, reason.trim())}>
                {reasonFor.label}
              </Button>
            </>
          }
        >
          <Field label="Reason" required hint="Recorded in the order history and audit trail.">
            {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />}
          </Field>
        </Dialog>
      )}
      {refundOpen && <RefundDialog detail={detail} onClose={() => setRefundOpen(false)} onDone={() => router.refresh()} />}
    </div>
  );
}

function RefundDialog({ detail, onClose, onDone }: { detail: OrderDetailView; onClose: () => void; onDone: () => void }) {
  const { order } = detail;
  const [amount, setAmount] = useState(toMajorString(detail.refundableMinor, order.currency));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per dialog session: a double submit cannot refund twice.
  const [key] = useState(() => newIdempotencyKey("refund"));

  const submit = async () => {
    const minor = parseMajor(amount, order.currency);
    if (minor === null || minor <= 0) return setError("Enter a valid amount");
    if (minor > detail.refundableMinor) return setError(`At most ${formatMoney(detail.refundableMinor, order.currency)} can be refunded`);
    if (!reason.trim()) return setError("A reason is required");
    setBusy(true);
    try {
      const r = await apiFetch<Refund>(`/orders/${order.id}/refunds`, {
        method: "POST",
        body: { amountMinor: minor, reason: reason.trim() },
        idempotencyKey: key,
      });
      if (r.status === "FAILED") toast.error(`Refund failed: ${r.failureReason}. It is recorded as FAILED and can be retried.`);
      else toast.success(`Refund of ${formatMoney(r.amountMinor, r.currency)} ${r.status === "SUCCEEDED" ? "completed" : "is pending"}`);
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Refund order #${order.number}`}
      description={`Refundable: ${formatMoney(detail.refundableMinor, order.currency)}. Refunds go back to the original payment method.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={submit}>
            Issue refund
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={`Amount (${order.currency})`} required error={error ?? undefined}>
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError(null);
              }}
            />
          )}
        </Field>
        <Field label="Reason" required hint="Tip for testing: include [mock-fail] to simulate a provider refund failure.">
          {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />}
        </Field>
      </div>
    </Dialog>
  );
}

function AssignRunner({ detail, onDone }: { detail: OrderDetailView; onDone: () => void }) {
  const [runner, setRunner] = useState(detail.delivery?.status === "ASSIGNED" ? detail.delivery.runnerUserId : "");
  const [busy, setBusy] = useState(false);
  if (detail.runners.length === 0) return <p className="text-sm text-muted">No runners are assigned to this branch. Invite one from Staff.</p>;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await apiFetch(`/orders/${detail.order.id}/delivery-assignments`, { method: "POST", body: { runnerUserId: runner, note: null } });
          toast.success("Runner assigned");
          onDone();
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label={detail.delivery?.status === "ASSIGNED" ? "Reassign runner" : "Assign runner"} className="min-w-56">
        {(p) => (
          <Select {...p} value={runner} onChange={(e) => setRunner(e.target.value)} required>
            <option value="">Choose a runner…</option>
            {detail.runners.map((r) => (
              <option key={r.userId} value={r.userId}>
                {r.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Button type="submit" variant="dark" loading={busy} disabled={!runner}>
        Assign
      </Button>
    </form>
  );
}

export function RetryRefundButton({ refundId }: { refundId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await apiFetch<Refund>(`/refunds/${refundId}/retry`, { method: "POST" });
          if (r.status === "FAILED") toast.error(`Still failing: ${r.failureReason}`);
          else toast.success("Refund succeeded");
        } catch (e) {
          toast.error(errorMessage(e));
        } finally {
          setBusy(false);
          router.refresh();
        }
      }}
    >
      Retry
    </Button>
  );
}
