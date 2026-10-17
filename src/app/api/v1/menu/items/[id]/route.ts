import { api } from "@/server/http/api";
import { menuItemSchema } from "@/lib/validation";
import { notFound } from "@/server/errors";
import { requirePermission } from "@/server/auth/actor";
import { updateMenuItem } from "@/server/services/catalog";

export const GET = api<{ id: string }>(async ({ store, actor, params }) => {
  const staff = requirePermission(actor, "menu.availability");
  const item = await store.getMenuItem(staff.tenant.id, params.id);
  if (!item) throw notFound("Menu item");
  return item;
});
export const PUT = api<{ id: string }>(async ({ store, actor, params, body }) => updateMenuItem(store, actor, params.id, await body(menuItemSchema)));
