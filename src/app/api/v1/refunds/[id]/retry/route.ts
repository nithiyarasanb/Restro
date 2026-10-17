import { api } from "@/server/http/api";
import { retryRefund } from "@/server/services/payments";

export const POST = api<{ id: string }>(async ({ store, actor, params }) => retryRefund(store, actor, params.id));
