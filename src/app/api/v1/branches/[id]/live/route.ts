import { z } from "zod";
import { api } from "@/server/http/api";
import { setBranchLive } from "@/server/services/tenancy";

export const POST = api<{ id: string }>(async ({ store, actor, params, body }) =>
  setBranchLive(store, actor, params.id, (await body(z.object({ live: z.boolean() }))).live),
);
