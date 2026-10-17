import { api, created } from "@/server/http/api";
import { tableSchema } from "@/lib/validation";
import { createTable, listTables } from "@/server/services/tables";

export const GET = api<{ id: string }>(async ({ store, actor, params }) => listTables(store, actor, params.id));
export const POST = api<{ id: string }>(async ({ store, actor, params, body }) => created(await createTable(store, actor, params.id, await body(tableSchema))));
