"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Volume2, VolumeX } from "lucide-react";
import type { KitchenQueueView, KitchenTicketView } from "@/types/api";
import { REJECT_REASONS, FULFILLMENT_LABELS } from "@/lib/order-states";
import { apiFetch } from "@/lib/api-client";
import { cn, elapsed } from "@/lib/utils";
import { useEventStream } from "@/hooks/use-event-stream";
import { useNow } from "@/hooks/use-now";
import { ConnectionPill, StaleBanner } from "@/components/ui/connection-indicator";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { useTransitionOrder } from "@/features/staff/use-transition-order";

interface Props {
  branches: Array<{ id: string; name: string }>;
  canHandover: boolean;
}

const COLUMNS = [
  { key: "new", title: "New", statuses: ["CONFIRMED"], accent: "border-t-info-600" },
  { key: "preparing", title: "Preparing", statuses: ["ACCEPTED", "PREPARING"], accent: "border-t-warn-600" },
  { key: "ready", title: "Ready", statuses: ["READY"], accent: "border-t-ok-600" },
] as const;

// Late thresholds (minutes since confirmation) for the timer colour.
const WARN_MIN = 10;
const LATE_MIN = 20;

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    /* audio unavailable */
  }
}

export function KitchenBoard({ branches, canHandover }: Props) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [stationId, setStationId] = useState("");
  const [sound, setSound] = useState(true);
  const [rejecting, setRejecting] = useState<KitchenTicketView | null>(null);
  const soundRef = useRef(sound);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);
  const now = useNow(1000);

  const key = ["kitchen-queue", branchId, stationId];
  const queue = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<KitchenQueueView>(`/branches/${branchId}/kitchen/queue${stationId ? `?stationId=${stationId}` : ""}`),
    enabled: !!branchId,
    refetchInterval: 60_000, // safety net; SSE drives normal updates
  });
  const { state, lastBeat } = useEventStream(branchId ? `/api/v1/stream?channel=kitchen&branchId=${branchId}` : null, {
    onMessage: (m) => {
      if (m.type === "order.created") {
        if (soundRef.current) beep();
        toast.info(`New order #${String(m.payload.number)}${m.payload.tableLabel ? ` · ${String(m.payload.tableLabel)}` : ""}`);
      }
      void queue.refetch();
    },
    onReconnect: () => void queue.refetch(),
  });
  const transition = useTransitionOrder([["kitchen-queue"]]);
  const busyId = transition.isPending ? transition.variables?.orderId : null;

  const act = (t: KitchenTicketView, action: "accept" | "start" | "ready" | "serve" | "pickup", reason?: string) =>
    transition.mutate({ orderId: t.orderId, number: t.number, action, expectedVersion: t.version, reason });

  const tickets = queue.data?.tickets ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StaleBanner state={state} lastBeat={lastBeat} />
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        {branches.length > 1 && (
          <label className="flex items-center gap-2 text-sm font-semibold">
            Branch
            <select
              value={branchId}
              onChange={(e) => {
                setBranchId(e.target.value);
                setStationId("");
              }}
              className="h-9 rounded-lg border border-line-strong px-2"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 text-sm font-semibold">
          Station
          <select value={stationId} onChange={(e) => setStationId(e.target.value)} className="h-9 rounded-lg border border-line-strong px-2">
            <option value="">All stations</option>
            {queue.data?.stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSound((s) => !s)}
            aria-pressed={sound}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-semibold"
          >
            {sound ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />} Sound {sound ? "on" : "off"}
          </button>
          <ConnectionPill state={state} className={state === "connecting" ? "bg-ink/10 text-ink" : undefined} />
        </div>
      </div>

      {queue.error ? (
        <div className="p-6">
          <ErrorState
            description="The kitchen queue could not be loaded. It will retry automatically."
            action={<Button onClick={() => queue.refetch()}>Retry now</Button>}
          />
        </div>
      ) : (
        <div className="grid flex-1 gap-4 overflow-x-auto p-4 md:grid-cols-3" aria-busy={queue.isPending}>
          {COLUMNS.map((col) => {
            const list = tickets.filter((t) => (col.statuses as readonly string[]).includes(t.status));
            return (
              <section key={col.key} aria-labelledby={`col-${col.key}`} className="flex min-w-[17rem] flex-col">
                <h2 id={`col-${col.key}`} className="mb-3 text-sm font-black tracking-wide text-ink-soft uppercase">
                  {col.title} · <span className="tabular">{queue.isPending ? "…" : list.length}</span>
                </h2>
                <ul className="space-y-3">
                  {queue.isPending && [1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
                  {!queue.isPending && list.length === 0 && (
                    <li className="rounded-xl border-2 border-dashed border-line-strong p-6 text-center text-sm text-muted">Nothing here</li>
                  )}
                  {list.map((t) => {
                    const mins = (now - new Date(t.confirmedAt).getTime()) / 60000;
                    const busy = busyId === t.orderId;
                    return (
                      <li
                        key={t.orderId}
                        aria-label={`Order #${t.number}`}
                        className={cn("rounded-xl border border-line border-t-4 bg-surface p-4 shadow-[var(--shadow-card)]", col.accent)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xl font-black">#{t.number}</p>
                            <p className="text-sm text-muted">
                              {t.tableLabel ?? FULFILLMENT_LABELS[t.fulfillmentType]}
                              {t.customerName ? ` · ${t.customerName}` : ""} ·{" "}
                              <time
                                className={cn("font-bold tabular", mins >= LATE_MIN ? "text-danger-700" : mins >= WARN_MIN ? "text-warn-700" : "text-ink")}
                                aria-label={`Waiting ${Math.floor(mins)} minutes`}
                              >
                                {elapsed(t.confirmedAt, now)}
                              </time>
                            </p>
                          </div>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs font-black text-white uppercase",
                              t.status === "CONFIRMED"
                                ? "bg-info-600"
                                : t.status === "READY"
                                  ? "bg-ok-600"
                                  : t.status === "ACCEPTED"
                                    ? "bg-accent-600"
                                    : "bg-warn-700",
                            )}
                          >
                            {t.status === "CONFIRMED" ? "New" : t.status.toLowerCase()}
                          </span>
                        </div>
                        <ul className="mt-3 divide-y divide-line border-t border-line">
                          {t.items.map((i, idx) => (
                            <li key={idx} className="py-1.5">
                              <p className="font-bold">
                                {i.quantity}× {i.name}
                                {i.variantName && <span className="font-normal text-muted"> · {i.variantName}</span>}
                              </p>
                              {i.modifiers.length > 0 && <p className="text-sm text-ink-soft">{i.modifiers.join(", ")}</p>}
                              {i.notes && <p className="text-sm font-semibold text-warn-700">“{i.notes}”</p>}
                            </li>
                          ))}
                        </ul>
                        {t.notes && <p className="mt-2 rounded-lg bg-warn-50 px-2 py-1 text-sm font-semibold text-warn-700">Note: {t.notes}</p>}
                        <div className="mt-3 flex gap-2">
                          {t.status === "CONFIRMED" && (
                            <>
                              <Button variant="info" size="xl" className="flex-1" loading={busy} onClick={() => act(t, "accept")}>
                                Accept
                              </Button>
                              <Button variant="secondary" size="xl" disabled={busy} onClick={() => setRejecting(t)} aria-label={`Reject order ${t.number}`}>
                                Reject
                              </Button>
                            </>
                          )}
                          {t.status === "ACCEPTED" && (
                            <Button variant="primary" size="xl" className="flex-1" loading={busy} onClick={() => act(t, "start")}>
                              Start preparing
                            </Button>
                          )}
                          {t.status === "PREPARING" && (
                            <Button variant="primary" size="xl" className="flex-1" loading={busy} onClick={() => act(t, "ready")}>
                              Mark ready
                            </Button>
                          )}
                          {t.status === "READY" &&
                            (canHandover && t.fulfillmentType !== "DELIVERY" ? (
                              <Button
                                variant="success"
                                size="xl"
                                className="flex-1"
                                loading={busy}
                                onClick={() => act(t, t.fulfillmentType === "DINE_IN" ? "serve" : "pickup")}
                              >
                                {t.fulfillmentType === "DINE_IN" ? "Hand over" : "Picked up"}
                              </Button>
                            ) : (
                              <p className="flex-1 rounded-xl bg-ok-50 px-3 py-3 text-center text-sm font-bold text-ok-700">
                                {t.fulfillmentType === "DELIVERY" ? "Waiting for runner" : "Front of house alerted"}
                              </p>
                            ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {rejecting && (
        <RejectDialog
          ticket={rejecting}
          onClose={() => setRejecting(null)}
          onConfirm={(reason) => {
            transition.mutate(
              { orderId: rejecting.orderId, number: rejecting.number, action: "reject", expectedVersion: rejecting.version, reason },
              { onSuccess: () => toast.success(`Order #${rejecting.number} rejected — refund started`) },
            );
            setRejecting(null);
          }}
        />
      )}
    </div>
  );
}

function RejectDialog({ ticket, onClose, onConfirm }: { ticket: KitchenTicketView; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState<string>("");
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Reject order #${ticket.number}?`}
      description="The guest is told the order could not be accepted and a full refund starts automatically."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep order
          </Button>
          <Button variant="danger" disabled={!reason} onClick={() => onConfirm(reason)}>
            Reject order
          </Button>
        </>
      }
    >
      <fieldset>
        <legend className="mb-2 text-sm font-bold">Reason (required)</legend>
        <div className="space-y-2">
          {REJECT_REASONS.map((r) => (
            <label
              key={r.code}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2.5 has-[:checked]:border-danger-600 has-[:checked]:bg-danger-50"
            >
              <input
                type="radio"
                name="reject-reason"
                value={r.code}
                checked={reason === r.code}
                onChange={() => setReason(r.code)}
                className="accent-danger-600"
              />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>
    </Dialog>
  );
}
