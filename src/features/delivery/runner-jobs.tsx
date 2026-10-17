"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin, Phone, Truck } from "lucide-react";
import type { RunnerJobView } from "@/types/api";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { formatTime } from "@/lib/utils";
import { useEventStream } from "@/hooks/use-event-stream";
import { ConnectionPill, StaleBanner } from "@/components/ui/connection-indicator";
import { Button } from "@/components/ui/button";
import { Badge, OrderStatusBadge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";

export function RunnerJobs() {
  const qc = useQueryClient();
  const jobs = useQuery({ queryKey: ["my-jobs"], queryFn: () => apiFetch<RunnerJobView[]>("/me/delivery-jobs"), refetchInterval: 30_000 });
  const { state, lastBeat } = useEventStream("/api/v1/stream?channel=runner", { onMessage: () => void jobs.refetch(), onReconnect: () => void jobs.refetch() });
  const [failing, setFailing] = useState<RunnerJobView | null>(null);
  const [reason, setReason] = useState("");
  const event = useMutation({
    mutationFn: (v: { job: RunnerJobView; type: "PICKED_UP" | "DELIVERED" | "FAILED"; note?: string }) =>
      apiFetch(`/delivery-jobs/${v.job.assignmentId}/events`, { method: "POST", body: { type: v.type, note: v.note ?? null } }),
    onSuccess: (_, v) =>
      toast.success(
        v.type === "PICKED_UP"
          ? `Order #${v.job.orderNumber} is out for delivery`
          : v.type === "DELIVERED"
            ? "Delivered — thank you!"
            : "Failed delivery recorded",
      ),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["my-jobs"] }),
  });
  const active = jobs.data?.filter((j) => j.status === "ASSIGNED" || j.status === "PICKED_UP") ?? [];
  const done = jobs.data?.filter((j) => j.status === "DELIVERED" || j.status === "FAILED") ?? [];

  return (
    <div className="flex flex-1 flex-col">
      <StaleBanner state={state} lastBeat={lastBeat} />
      <div className="mx-auto w-full max-w-xl flex-1 space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black">My jobs</h2>
          <ConnectionPill state={state} className={state === "connecting" ? "bg-ink/10 text-ink" : undefined} />
        </div>
        {jobs.isPending && [1, 2].map((i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        {jobs.error && <ErrorState description={errorMessage(jobs.error)} action={<Button onClick={() => jobs.refetch()}>Retry</Button>} />}
        {jobs.data && active.length === 0 && (
          <EmptyState
            title="No active deliveries"
            description="New assignments from your manager appear here automatically."
            icon={<Truck className="size-6" />}
          />
        )}
        {active.map((j) => {
          const busy = event.isPending && event.variables?.job.assignmentId === j.assignmentId;
          return (
            <article
              key={j.assignmentId}
              className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]"
              aria-labelledby={`job-${j.assignmentId}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 id={`job-${j.assignmentId}`} className="text-xl font-black">
                    #{j.orderNumber}
                  </h3>
                  <p className="text-sm text-muted">
                    {j.branchName} · assigned {formatTime(j.assignedAt)}
                  </p>
                </div>
                <OrderStatusBadge status={j.orderStatus} />
              </div>
              <div className="mt-3 space-y-1.5 text-sm">
                <p className="font-bold">{j.customerName}</p>
                {j.customerPhone && (
                  <a href={`tel:${j.customerPhone.replace(/[^+\d]/g, "")}`} className="flex items-center gap-1.5 font-semibold text-info-700 underline">
                    <Phone className="size-4" aria-hidden /> {j.customerPhone}
                  </a>
                )}
                {j.deliveryAddress && (
                  <p className="flex items-start gap-1.5">
                    <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> {j.deliveryAddress}
                  </p>
                )}
                {j.note && <p className="rounded-lg bg-warn-50 px-2 py-1 font-semibold text-warn-700">Note: {j.note}</p>}
                <p className="text-muted">{j.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</p>
                <p>
                  {formatMoney(j.totalMinor, j.currency)} ·{" "}
                  {j.paid ? <Badge tone="success">Paid online — collect nothing</Badge> : <Badge tone="danger">Not paid</Badge>}
                </p>
              </div>
              <div className="mt-4 flex gap-2">
                {j.status === "ASSIGNED" && (
                  <Button
                    size="xl"
                    className="flex-1"
                    loading={busy}
                    disabled={j.orderStatus !== "READY"}
                    onClick={() => event.mutate({ job: j, type: "PICKED_UP" })}
                  >
                    {j.orderStatus === "READY" ? "Picked up" : "Waiting for kitchen"}
                  </Button>
                )}
                {j.status === "PICKED_UP" && (
                  <>
                    <Button variant="success" size="xl" className="flex-1" loading={busy} onClick={() => event.mutate({ job: j, type: "DELIVERED" })}>
                      Delivered
                    </Button>
                    <Button variant="secondary" size="xl" disabled={busy} onClick={() => setFailing(j)}>
                      Failed
                    </Button>
                  </>
                )}
              </div>
            </article>
          );
        })}
        {done.length > 0 && (
          <section aria-label="Completed today">
            <h2 className="mt-6 mb-2 text-sm font-black text-muted uppercase">Completed today</h2>
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-sm">
              {done.map((j) => (
                <li key={j.assignmentId} className="flex justify-between px-4 py-2.5">
                  <span className="font-bold">#{j.orderNumber}</span>
                  <Badge tone={j.status === "DELIVERED" ? "success" : "danger"}>{j.status === "DELIVERED" ? "Delivered" : "Failed"}</Badge>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {failing && (
        <Dialog
          open
          size="sm"
          onClose={() => setFailing(null)}
          title={`Delivery failed for #${failing.orderNumber}?`}
          description="The manager is notified and the guest is refunded."
          footer={
            <>
              <Button variant="secondary" onClick={() => setFailing(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={!reason.trim()}
                onClick={() => {
                  event.mutate({ job: failing, type: "FAILED", note: reason.trim() });
                  setFailing(null);
                  setReason("");
                }}
              >
                Record failure
              </Button>
            </>
          }
        >
          <label htmlFor="fail-reason" className="mb-1 block text-sm font-bold">
            What happened? (required)
          </label>
          <textarea
            id="fail-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            className="min-h-24 w-full rounded-lg border border-line-strong p-2 text-sm"
            placeholder="e.g. Customer unreachable, address not found"
          />
        </Dialog>
      )}
    </div>
  );
}
