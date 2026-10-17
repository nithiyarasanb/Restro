import { api } from "@/server/http/api";
import { paymentsOverview } from "@/server/services/payments";

export const GET = api(async ({ store, actor }) => paymentsOverview(store, actor));
