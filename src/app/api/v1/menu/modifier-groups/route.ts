import { api, created } from "@/server/http/api";
import { modifierGroupSchema } from "@/lib/validation";
import { createModifierGroup } from "@/server/services/catalog";

export const POST = api(async ({ store, actor, body }) => created(await createModifierGroup(store, actor, await body(modifierGroupSchema))));
