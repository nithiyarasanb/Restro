import { api } from "@/server/http/api";
import { tableSchema, tableStatusSchema } from "@/lib/validation";
import { updateTable } from "@/server/services/tables";

export const PATCH = api<{ id: string }>(async ({ store, actor, params, body }) =>
  updateTable(store, actor, params.id, await body(tableSchema.partial().extend(tableStatusSchema.partial().shape))),
);
