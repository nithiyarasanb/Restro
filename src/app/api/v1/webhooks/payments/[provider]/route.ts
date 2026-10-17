import { api } from "@/server/http/api";
import { handleWebhook } from "@/server/services/payments";

/**
 * Provider → platform webhook. The raw body is verified before parsing.
 * Business rejections (mismatch, unknown reference) return 200 with the
 * outcome so the provider stops retrying; they are flagged for review.
 */
export const POST = api<{ provider: string }>(async ({ store, params, rawBody, req }) => handleWebhook(store, params.provider, await rawBody(), req.headers), {
  skipCsrf: true,
  rateLimitPerMinute: 600,
  maxBodyBytes: 256 * 1024,
});
