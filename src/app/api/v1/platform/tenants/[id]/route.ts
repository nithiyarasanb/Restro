import { api } from "@/server/http/api";
import { tenantPlatformUpdateSchema } from "@/lib/validation";
import { getTenantDetail, updateTenantAsPlatform } from "@/server/services/tenancy";

export const GET = api<{ id: string }>(async ({ store, actor, params }) => getTenantDetail(store, actor, params.id));
export const PATCH = api<{ id: string }>(async ({ store, actor, params, body }) =>
  updateTenantAsPlatform(store, actor, params.id, await body(tenantPlatformUpdateSchema)),
);
