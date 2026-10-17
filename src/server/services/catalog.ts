import type { AdminMenuView, PublicMenu, PublicRestaurant } from "@/types/api";
import type { CategoryInput, MenuItemInput, ModifierGroupInput } from "@/lib/validation";
import type { DataStore } from "@/server/store/types";
import { DomainError, notFound } from "@/server/errors";
import { getConfig } from "@/server/config";
import { requirePermission, type Actor } from "@/server/auth/actor";
import { resolveOrderContext } from "./checkout";
import { effectiveBasePrice, isItemAvailable } from "./pricing";
import { audit, toPublicBranch } from "./shared";
import { FILE_REF_PREFIX, resolveImageUrl } from "./files";

// Catalog (menu) module (FR-02). Retiring is a soft delete so order
// snapshots and history are never affected (BR-09).

export async function getPublicRestaurant(store: DataStore, slug: string): Promise<PublicRestaurant> {
  const tenant = await store.getTenantBySlug(slug);
  if (!tenant || tenant.status !== "ACTIVE") throw notFound("Restaurant");
  const branches = (await store.listBranches(tenant.id)).filter((b) => b.isLive);
  return {
    slug: tenant.slug,
    name: tenant.name,
    currency: tenant.currency,
    isDemo: getConfig().isDemo,
    branches: branches.map((b) => toPublicBranch(b, tenant.features.delivery)),
  };
}

/** Public menu for a QR table or a branch (takeaway/delivery). */
export async function getPublicMenu(
  store: DataStore,
  ctxInput: { kind: "table"; qrRef: string } | { kind: "branch"; tenantSlug: string; branchId: string },
): Promise<PublicMenu> {
  const ctx = await resolveOrderContext(store, ctxInput);
  if (!ctx.branch.isLive && ctxInput.kind === "branch") throw notFound("Branch");
  const [categories, items, groups, branchItems] = await Promise.all([
    store.listCategories(ctx.tenant.id),
    store.listMenuItems(ctx.tenant.id),
    store.listModifierGroups(ctx.tenant.id),
    store.listBranchMenuItems(ctx.tenant.id, ctx.branch.id),
  ]);
  const overrides = new Map(branchItems.map((b) => [b.itemId, b]));
  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const usedGroupIds = new Set(items.flatMap((i) => i.modifierGroupIds).filter((id) => groupMap.has(id)));
  return {
    restaurant: { slug: ctx.tenant.slug, name: ctx.tenant.name, currency: ctx.tenant.currency },
    branch: toPublicBranch(ctx.branch, ctx.tenant.features.delivery),
    table: ctx.table ? { label: ctx.table.label, qrRef: ctx.table.qrRef } : null,
    categories: categories.filter((c) => items.some((i) => i.categoryId === c.id)).map((c) => ({ id: c.id, name: c.name })),
    items: items.map((i) => ({
      id: i.id,
      categoryId: i.categoryId,
      name: i.name,
      description: i.description,
      priceMinor: effectiveBasePrice(i, overrides.get(i.id)),
      imageUrl: resolveImageUrl(i.imageUrl),
      dietary: i.dietary,
      available: isItemAvailable(i, overrides.get(i.id)),
      variants: i.variants.map((v) => ({ id: v.id, name: v.name, priceDeltaMinor: v.priceDeltaMinor, isDefault: v.isDefault })),
      modifierGroupIds: i.modifierGroupIds.filter((id) => groupMap.has(id)),
    })),
    modifierGroups: Object.fromEntries(
      [...usedGroupIds].map((id) => {
        const g = groupMap.get(id)!;
        return [
          id,
          {
            id,
            name: g.name,
            minSelect: g.minSelect,
            maxSelect: g.maxSelect,
            options: g.options.map((o) => ({ id: o.id, name: o.name, priceDeltaMinor: o.priceDeltaMinor, isAvailable: o.isAvailable })),
          },
        ];
      }),
    ),
  };
}

export async function getAdminMenu(store: DataStore, actor: Actor | null): Promise<AdminMenuView> {
  const staff = requirePermission(actor, "menu.availability");
  const tenantId = staff.tenant.id;
  const [categories, items, modifierGroups, stations, branches] = await Promise.all([
    store.listCategories(tenantId),
    store.listMenuItems(tenantId),
    store.listModifierGroups(tenantId),
    store.listStations(tenantId),
    store.listBranches(tenantId),
  ]);
  const visible = branches.filter((b) => staff.branchScope === "ALL" || staff.branchScope.includes(b.id));
  const branchItems: AdminMenuView["branchItems"] = {};
  for (const b of visible) {
    branchItems[b.id] = {};
    for (const row of await store.listBranchMenuItems(tenantId, b.id))
      branchItems[b.id][row.itemId] = { isAvailable: row.isAvailable, priceOverrideMinor: row.priceOverrideMinor };
  }
  const imageUrls = Object.fromEntries(items.filter((i) => i.imageUrl).map((i) => [i.id, resolveImageUrl(i.imageUrl)!]));
  return { categories, items, modifierGroups, stations, branches: visible.map((b) => ({ id: b.id, name: b.name })), branchItems, imageUrls };
}

async function assertRefs(store: DataStore, tenantId: string, input: MenuItemInput) {
  if (!(await store.getCategory(tenantId, input.categoryId))) throw new DomainError("VALIDATION_FAILED", "Category not found", { field: "categoryId" });
  for (const gid of input.modifierGroupIds)
    if (!(await store.getModifierGroup(tenantId, gid))) throw new DomainError("VALIDATION_FAILED", "Modifier group not found", { field: "modifierGroupIds" });
  if (input.stationId && !(await store.listStations(tenantId)).some((s) => s.id === input.stationId))
    throw new DomainError("VALIDATION_FAILED", "Station not found", { field: "stationId" });
  if (input.imageUrl) {
    // Only this tenant's uploaded files, or an https URL.
    if (input.imageUrl.startsWith(FILE_REF_PREFIX)) {
      const key = input.imageUrl.slice(FILE_REF_PREFIX.length);
      if (!key.startsWith(`${tenantId}/`) || !(await store.getFileByKey(key)))
        throw new DomainError("VALIDATION_FAILED", "Image not found", { field: "imageUrl" });
    } else if (!/^https:\/\/[^\s]+$/.test(input.imageUrl)) {
      throw new DomainError("VALIDATION_FAILED", "Image must be an uploaded file or an https URL", { field: "imageUrl" });
    }
  }
}

export async function createMenuItem(store: DataStore, actor: Actor | null, input: MenuItemInput) {
  const staff = requirePermission(actor, "menu.manage");
  await assertRefs(store, staff.tenant.id, input);
  const item = await store.createMenuItem(staff.tenant.id, { ...input, variants: input.variants.map((v, i) => ({ ...v, sortOrder: i })) });
  await audit(store, staff, { tenantId: staff.tenant.id, action: "menu_item.created", entityType: "menu_item", entityId: item.id, meta: { name: item.name } });
  return item;
}

export async function updateMenuItem(store: DataStore, actor: Actor | null, id: string, input: MenuItemInput) {
  const staff = requirePermission(actor, "menu.manage");
  await assertRefs(store, staff.tenant.id, input);
  const before = await store.getMenuItem(staff.tenant.id, id);
  if (!before) throw notFound("Menu item");
  const item = await store.updateMenuItem(staff.tenant.id, id, { ...input, variants: input.variants.map((v, i) => ({ ...v, sortOrder: i })) });
  const changed = (Object.keys(input) as Array<keyof MenuItemInput>).filter(
    (k) => JSON.stringify(input[k]) !== JSON.stringify((before as unknown as Record<string, unknown>)[k]),
  );
  await audit(store, staff, { tenantId: staff.tenant.id, action: "menu_item.updated", entityType: "menu_item", entityId: id, meta: { fields: changed } });
  return item!;
}

export async function setMenuItemRetired(store: DataStore, actor: Actor | null, id: string, retired: boolean) {
  const staff = requirePermission(actor, "menu.manage");
  const item = await store.setMenuItemRetired(staff.tenant.id, id, retired ? new Date().toISOString() : null);
  if (!item) throw notFound("Menu item");
  await audit(store, staff, {
    tenantId: staff.tenant.id,
    action: retired ? "menu_item.retired" : "menu_item.restored",
    entityType: "menu_item",
    entityId: id,
    meta: { name: item.name },
  });
  return item;
}

export async function setBranchMenuItem(
  store: DataStore,
  actor: Actor | null,
  branchId: string,
  itemId: string,
  patch: { isAvailable?: boolean; priceOverrideMinor?: number | null },
) {
  const staff = requirePermission(actor, "menu.availability", branchId);
  if (patch.priceOverrideMinor !== undefined && staff.role !== "OWNER" && staff.role !== "BRANCH_MANAGER")
    throw new DomainError("FORBIDDEN", "Not allowed to change prices");
  const [branch, item] = await Promise.all([store.getBranch(staff.tenant.id, branchId), store.getMenuItem(staff.tenant.id, itemId)]);
  if (!branch) throw notFound("Branch");
  if (!item) throw notFound("Menu item");
  const current = (await store.listBranchMenuItems(staff.tenant.id, branchId)).find((r) => r.itemId === itemId);
  const row = await store.upsertBranchMenuItem({
    tenantId: staff.tenant.id,
    branchId,
    itemId,
    isAvailable: patch.isAvailable ?? current?.isAvailable ?? true,
    priceOverrideMinor: patch.priceOverrideMinor !== undefined ? patch.priceOverrideMinor : (current?.priceOverrideMinor ?? null),
  });
  await audit(store, staff, {
    tenantId: staff.tenant.id,
    action: "branch_menu_item.updated",
    entityType: "menu_item",
    entityId: itemId,
    meta: { branch: branch.name, ...patch },
  });
  return row;
}

export async function createCategory(store: DataStore, actor: Actor | null, input: CategoryInput) {
  const staff = requirePermission(actor, "menu.manage");
  const c = await store.createCategory({ tenantId: staff.tenant.id, name: input.name, sortOrder: input.sortOrder, retiredAt: null });
  await audit(store, staff, {
    tenantId: staff.tenant.id,
    action: "menu_category.created",
    entityType: "menu_category",
    entityId: c.id,
    meta: { name: c.name },
  });
  return c;
}

export async function updateCategory(store: DataStore, actor: Actor | null, id: string, input: Partial<CategoryInput> & { retired?: boolean }) {
  const staff = requirePermission(actor, "menu.manage");
  if (input.retired) {
    const active = (await store.listMenuItems(staff.tenant.id)).filter((i) => i.categoryId === id);
    if (active.length) throw new DomainError("CONFLICT", `Move or retire the ${active.length} item(s) in this category first`);
  }
  const c = await store.updateCategory(staff.tenant.id, id, {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
    ...(input.retired !== undefined && { retiredAt: input.retired ? new Date().toISOString() : null }),
  });
  if (!c) throw notFound("Category");
  await audit(store, staff, { tenantId: staff.tenant.id, action: "menu_category.updated", entityType: "menu_category", entityId: id, meta: input });
  return c;
}

export async function createModifierGroup(store: DataStore, actor: Actor | null, input: ModifierGroupInput) {
  const staff = requirePermission(actor, "menu.manage");
  const g = await store.createModifierGroup(staff.tenant.id, { ...input, options: input.options.map((o, i) => ({ ...o, sortOrder: i })) });
  await audit(store, staff, {
    tenantId: staff.tenant.id,
    action: "modifier_group.created",
    entityType: "modifier_group",
    entityId: g.id,
    meta: { name: g.name },
  });
  return g;
}

export async function updateModifierGroup(store: DataStore, actor: Actor | null, id: string, input: ModifierGroupInput) {
  const staff = requirePermission(actor, "menu.manage");
  const g = await store.updateModifierGroup(staff.tenant.id, id, { ...input, options: input.options.map((o, i) => ({ ...o, sortOrder: i })) });
  if (!g) throw notFound("Modifier group");
  await audit(store, staff, {
    tenantId: staff.tenant.id,
    action: "modifier_group.updated",
    entityType: "modifier_group",
    entityId: id,
    meta: { name: g.name },
  });
  return g;
}

export async function setModifierGroupRetired(store: DataStore, actor: Actor | null, id: string, retired: boolean) {
  const staff = requirePermission(actor, "menu.manage");
  if (retired) {
    const users = (await store.listMenuItems(staff.tenant.id)).filter((i) => i.modifierGroupIds.includes(id));
    if (users.length) throw new DomainError("CONFLICT", `Remove this group from ${users.map((u) => u.name).join(", ")} first`);
  }
  const g = await store.setModifierGroupRetired(staff.tenant.id, id, retired ? new Date().toISOString() : null);
  if (!g) throw notFound("Modifier group");
  await audit(store, staff, {
    tenantId: staff.tenant.id,
    action: retired ? "modifier_group.retired" : "modifier_group.restored",
    entityType: "modifier_group",
    entityId: id,
  });
  return g;
}
