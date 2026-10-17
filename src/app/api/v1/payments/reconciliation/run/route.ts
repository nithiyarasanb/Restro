import { api } from "@/server/http/api";
import { runReconciliation } from "@/server/services/payments";

export const POST = api(async ({ store, actor }) => runReconciliation(store, actor), { rateLimitPerMinute: 10 });
