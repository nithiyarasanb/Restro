import { api } from "@/server/http/api";
import { modifierGroupSchema } from "@/lib/validation";
import { updateModifierGroup } from "@/server/services/catalog";

export const PUT = api<{ id: string }>(async ({ store, actor, params, body }) => updateModifierGroup(store, actor, params.id, await body(modifierGroupSchema)));
