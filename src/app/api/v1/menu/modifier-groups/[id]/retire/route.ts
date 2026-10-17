import { z } from "zod";
import { api } from "@/server/http/api";
import { setModifierGroupRetired } from "@/server/services/catalog";

export const POST = api<{ id: string }>(async ({ store, actor, params, body }) =>
  setModifierGroupRetired(store, actor, params.id, (await body(z.object({ retired: z.boolean() }))).retired),
);
