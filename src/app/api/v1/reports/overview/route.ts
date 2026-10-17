import { z } from "zod";
import { api } from "@/server/http/api";
import { overview } from "@/server/services/reports";

export const GET = api(async ({ store, actor, query }) => overview(store, actor, query(z.object({ branchId: z.uuid().optional() })).branchId));
