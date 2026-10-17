import { z } from "zod";
import { api } from "@/server/http/api";
import { authorizeStream, sseResponse } from "@/server/realtime/stream";

const querySchema = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("kitchen"), branchId: z.uuid() }),
  z.object({ channel: z.literal("orders"), branchId: z.uuid() }),
  z.object({ channel: z.literal("order"), orderId: z.uuid(), t: z.string().max(128).optional() }),
  z.object({ channel: z.literal("runner") }),
]);

/** Server-Sent Events. Events are hints; clients refetch the snapshot on (re)connect. */
export const GET = api(
  async ({ store, actor, query, req }) => {
    const q = query(querySchema);
    const sub = await authorizeStream(store, actor, q.channel === "order" ? { channel: "order", orderId: q.orderId, token: q.t ?? null } : q);
    return sseResponse(sub, req.signal);
  },
  { rateLimitPerMinute: 60 },
);
