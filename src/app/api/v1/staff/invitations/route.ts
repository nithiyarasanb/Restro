import { api, created } from "@/server/http/api";
import { inviteSchema } from "@/lib/validation";
import { inviteStaff } from "@/server/services/identity";

export const POST = api(async ({ store, actor, body }) => created(await inviteStaff(store, actor, await body(inviteSchema))), { rateLimitPerMinute: 30 });
