import { api } from "@/server/http/api";
import { branchMenuItemSchema } from "@/lib/validation";
import { setBranchMenuItem } from "@/server/services/catalog";

/** Branch-level availability (out-of-stock switch) and price override. */
export const PATCH = api<{ id: string; itemId: string }>(async ({ store, actor, params, body }) =>
  setBranchMenuItem(store, actor, params.id, params.itemId, await body(branchMenuItemSchema)),
);
