import { z } from "zod";
import { api } from "@/server/http/api";
import { setMenuItemRetired } from "@/server/services/catalog";

/** Soft delete (retire) or restore. Order snapshots are never affected. */
export const POST = api<{ id: string }>(async ({ store, actor, params, body }) =>
  setMenuItemRetired(store, actor, params.id, (await body(z.object({ retired: z.boolean() }))).retired),
);
