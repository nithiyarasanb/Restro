import { z } from "zod";
import { api } from "@/server/http/api";
import { categorySchema } from "@/lib/validation";
import { updateCategory } from "@/server/services/catalog";

export const PATCH = api<{ id: string }>(async ({ store, actor, params, body }) =>
  updateCategory(store, actor, params.id, await body(categorySchema.partial().extend({ retired: z.boolean().optional() }))),
);
