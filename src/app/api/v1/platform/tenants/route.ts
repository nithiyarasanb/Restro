import { api, created } from "@/server/http/api";
import { onboardTenantSchema } from "@/lib/validation";
import { listTenantSummaries, onboardTenant } from "@/server/services/tenancy";

export const GET = api(async ({ store, actor }) => listTenantSummaries(store, actor));
export const POST = api(async ({ store, actor, body }) => created(await onboardTenant(store, actor, await body(onboardTenantSchema))));
