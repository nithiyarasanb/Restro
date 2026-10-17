import { api, created } from "@/server/http/api";
import { refundSchema } from "@/lib/validation";
import { refundOrder } from "@/server/services/payments";

export const POST = api<{ id: string }>(async ({ store, actor, params, body, idempotencyKey }) =>
  created(await refundOrder(store, actor, params.id, await body(refundSchema), idempotencyKey())),
);
