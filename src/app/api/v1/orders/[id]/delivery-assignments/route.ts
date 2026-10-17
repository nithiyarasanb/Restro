import { api, created } from "@/server/http/api";
import { deliveryAssignSchema } from "@/lib/validation";
import { assignRunner } from "@/server/services/fulfillment";

export const POST = api<{ id: string }>(async ({ store, actor, params, body }) =>
  created(await assignRunner(store, actor, params.id, await body(deliveryAssignSchema))),
);
