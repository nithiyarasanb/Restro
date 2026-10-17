import { api } from "@/server/http/api";
import { paymentsOverview } from "@/server/services/payments";

/** Reconciliation status: pending attempts, flagged mismatches, failed refunds, stale unpaid orders. */
export const GET = api(async ({ store, actor }) => (await paymentsOverview(store, actor)).reconciliation);
