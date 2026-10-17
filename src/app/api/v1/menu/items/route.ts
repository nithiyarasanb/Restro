import { api, created } from "@/server/http/api";
import { menuItemSchema } from "@/lib/validation";
import { createMenuItem } from "@/server/services/catalog";

export const POST = api(async ({ store, actor, body }) => created(await createMenuItem(store, actor, await body(menuItemSchema))));
