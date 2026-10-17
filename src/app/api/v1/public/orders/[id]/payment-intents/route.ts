import { z } from "zod";
import { api, created } from "@/server/http/api";
import { createPaymentIntent } from "@/server/services/payments";

export const POST = api<{ id: string }>(
  async ({ store, params, body, idempotencyKey, origin }) => {
    const { token } = await body(z.object({ token: z.string().min(8).max(128) }));
    return created(await createPaymentIntent(store, { orderId: params.id, token, idempotencyKey: idempotencyKey(), origin }));
  },
  { rateLimitPerMinute: 30 },
);
