import { api, created, JsonResponse } from "@/server/http/api";
import { placeOrderSchema } from "@/lib/validation";
import { placeOrder } from "@/server/services/checkout";

/** Idempotent order creation (Idempotency-Key header required). */
export const POST = api(
  async ({ store, body, idempotencyKey }) => {
    const key = idempotencyKey();
    const result = await placeOrder(store, await body(placeOrderSchema), key);
    return result.created ? created(result.order) : new JsonResponse(result.order, 200, { "idempotent-replayed": "true" });
  },
  { rateLimitPerMinute: 30 },
);
