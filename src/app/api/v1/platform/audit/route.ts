import { z } from "zod";
import { api } from "@/server/http/api";
import { requirePlatform } from "@/server/auth/actor";
import { listAudit } from "@/server/services/tenancy";

export const GET = api(async ({ store, actor, query }) => {
  requirePlatform(actor);
  return listAudit(store, actor, query(z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1) })).page);
});
