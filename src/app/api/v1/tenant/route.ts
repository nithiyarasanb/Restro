import { api } from "@/server/http/api";
import { tenantSettingsSchema } from "@/lib/validation";
import { requireStaff } from "@/server/auth/actor";
import { updateTenantSettings } from "@/server/services/tenancy";

export const GET = api(async ({ actor }) => requireStaff(actor).tenant);
export const PATCH = api(async ({ store, actor, body }) => updateTenantSettings(store, actor, await body(tenantSettingsSchema)));
