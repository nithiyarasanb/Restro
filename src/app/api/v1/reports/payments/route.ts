import { api } from "@/server/http/api";
import { reportQuerySchema } from "@/lib/validation";
import { salesReport } from "@/server/services/reports";

export const GET = api(async ({ store, actor, query }) => {
  const r = await salesReport(store, actor, query(reportQuerySchema));
  return {
    from: r.from,
    to: r.to,
    branchId: r.branchId,
    ...r.payments,
    refunds: r.byCurrency.map((c) => ({ currency: c.currency, refundsMinor: c.refundsMinor })),
  };
});
