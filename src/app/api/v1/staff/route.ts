import { api } from "@/server/http/api";
import { listStaff } from "@/server/services/identity";

export const GET = api(async ({ store, actor }) => listStaff(store, actor));
