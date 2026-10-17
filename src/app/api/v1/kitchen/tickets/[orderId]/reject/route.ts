import { z } from "zod";
import { api } from "@/server/http/api";
import { transitionOrder } from "@/server/services/orders";

/** Reject with a reason code (DG §4 Kitchen). Equivalent to a "reject" transition. */
export const POST = api<{ orderId: string }>(async ({ store, actor, params, body }) => {
  const input = await body(z.object({ reason: z.string().trim().min(1).max(200), expectedVersion: z.int().min(1) }));
  return transitionOrder(store, actor, params.orderId, { action: "reject", reason: input.reason, expectedVersion: input.expectedVersion });
});
