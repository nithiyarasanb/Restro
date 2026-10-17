import { api, created } from "@/server/http/api";
import { categorySchema } from "@/lib/validation";
import { createCategory } from "@/server/services/catalog";

export const POST = api(async ({ store, actor, body }) => created(await createCategory(store, actor, await body(categorySchema))));
