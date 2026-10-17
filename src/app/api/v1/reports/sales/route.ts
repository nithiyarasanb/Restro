import { api } from "@/server/http/api";
import { reportQuerySchema } from "@/lib/validation";
import { salesReport } from "@/server/services/reports";

export const GET = api(async ({ store, actor, query }) => salesReport(store, actor, query(reportQuerySchema)), { rateLimitPerMinute: 60 });
