import { z } from "zod";
import { api } from "@/server/http/api";
import { completeMockPayment } from "@/server/payments/mock-provider";

/** MOCK PROVIDER (test only): simulates the customer finishing payment on the provider's page. */
export const POST = api<{ paymentId: string }>(
  async ({ params, body }) => {
    const input = await body(
      z.object({
        outcome: z.enum(["success", "decline"]),
        duplicate: z.boolean().default(false),
        tamperAmount: z.boolean().default(false),
        badSignature: z.boolean().default(false),
      }),
    );
    return completeMockPayment(params.paymentId, input.outcome, input);
  },
  { skipCsrf: true, rateLimitPerMinute: 30 },
);
