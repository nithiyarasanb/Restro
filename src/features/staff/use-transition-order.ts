"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { TransitionAction } from "@/lib/order-states";
import { apiFetch, ApiError, errorMessage } from "@/lib/api-client";
import type { StaffOrderView } from "@/types/api";

interface Vars {
  orderId: string;
  number: number;
  action: TransitionAction;
  expectedVersion: number;
  reason?: string | null;
}

/** Guarded transition with 409 handling: a stale screen refreshes instead of overwriting newer state. */
export function useTransitionOrder(invalidate: unknown[][]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Vars) =>
      apiFetch<{ order: StaffOrderView; warnings: string[] }>(`/orders/${v.orderId}/transitions`, {
        method: "POST",
        body: { action: v.action, expectedVersion: v.expectedVersion, reason: v.reason ?? null },
      }),
    onSuccess: (r) => r.warnings.forEach((w) => toast.warning(w)),
    onError: (e, v) => {
      if (e instanceof ApiError && e.code === "STALE_STATE") toast.info(`Order #${v.number} changed on another screen — refreshed.`);
      else toast.error(errorMessage(e));
    },
    onSettled: () => Promise.all(invalidate.map((key) => qc.invalidateQueries({ queryKey: key }))),
  });
}
