import { api } from "@/server/http/api";
import { getCustomerOrder } from "@/server/services/checkout";

/** Customer order status; requires the order access token (?t=). */
export const GET = api<{ id: string }>(async ({ store, params, req }) => getCustomerOrder(store, params.id, req.nextUrl.searchParams.get("t")), {
  rateLimitPerMinute: 240,
});
