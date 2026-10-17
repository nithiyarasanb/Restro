import { api } from "@/server/http/api";
import { getAdminMenu } from "@/server/services/catalog";

export const GET = api(async ({ store, actor }) => getAdminMenu(store, actor));
