import { api } from "@/server/http/api";
import { orderListQuerySchema } from "@/lib/validation";
import { listOrders } from "@/server/services/orders";

export const GET = api(async ({ store, actor, query }) => listOrders(store, actor, query(orderListQuerySchema)));
