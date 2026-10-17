import { api } from "@/server/http/api";
import { transitionSchema } from "@/lib/validation";
import { transitionOrder } from "@/server/services/orders";

/** Guarded state change: action + expectedVersion. 409 when the order moved on. */
export const POST = api<{ id: string }>(async ({ store, actor, params, body }) => transitionOrder(store, actor, params.id, await body(transitionSchema)));
