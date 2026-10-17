import { api } from "@/server/http/api";
import { deliveryEventSchema } from "@/lib/validation";
import { recordDeliveryEvent } from "@/server/services/fulfillment";

export const POST = api<{ id: string }>(async ({ store, actor, params, body }) =>
  recordDeliveryEvent(store, actor, params.id, await body(deliveryEventSchema)),
);
