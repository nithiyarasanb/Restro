import { z } from "zod";
import { api } from "@/server/http/api";
import { getCounterBoard } from "@/server/services/orders";

export const GET = api(async ({ store, actor, query }) => getCounterBoard(store, actor, query(z.object({ branchId: z.uuid().optional() })).branchId));
