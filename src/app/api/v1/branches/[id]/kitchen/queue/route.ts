import { z } from "zod";
import { api } from "@/server/http/api";
import { getKitchenQueue } from "@/server/services/orders";

/** Authoritative kitchen snapshot. Clients refetch this on (re)connect. */
export const GET = api<{ id: string }>(
  async ({ store, actor, params, query }) => {
    const { stationId } = query(z.object({ stationId: z.uuid().optional() }));
    return getKitchenQueue(store, actor, z.uuid().parse(params.id), stationId);
  },
  { rateLimitPerMinute: 300 },
);
