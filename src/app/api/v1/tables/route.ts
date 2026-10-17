import { api } from "@/server/http/api";
import { listTables } from "@/server/services/tables";

export const GET = api(async ({ store, actor }) => listTables(store, actor));
