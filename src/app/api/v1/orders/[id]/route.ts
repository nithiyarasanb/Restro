import { api } from "@/server/http/api";
import { getOrderDetail } from "@/server/services/orders";

export const GET = api<{ id: string }>(async ({ store, actor, params }) => getOrderDetail(store, actor, params.id));
