import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import type {
  AuditLog,
  Branch,
  BranchMenuItem,
  DeliveryAssignment,
  DeliveryEvent,
  DeliveryStatus,
  Invitation,
  KitchenStation,
  KitchenTicket,
  MenuCategory,
  MenuItem,
  ModifierGroup,
  Order,
  OrderStatus,
  OrderStatusHistory,
  OutboxEvent,
  PaymentAttempt,
  PaymentConnection,
  PaymentStatus,
  PaymentWebhookEvent,
  Refund,
  RestaurantTable,
  Session,
  StoredFile,
  Tenant,
  TenantMembership,
  User,
} from "@/types/domain";
import { UniqueViolationError, type DataStore, type MenuItemWrite, type ModifierGroupWrite, type New, type OrderFilter } from "../types";

// PostgreSQL implementation of the DataStore contract (ADR-0004).
// Compare-and-set uses guarded updateMany (WHERE status/version); insert-if-
// absent uses ON CONFLICT DO NOTHING so it never aborts the surrounding
// transaction.

type Db = PrismaClient | Prisma.TransactionClient;

const iso = (d: Date) => d.toISOString();
const isoN = (d: Date | null) => (d ? d.toISOString() : null);
const date = (s: string) => new Date(s);
const dateN = (s: string | null | undefined) => (s ? new Date(s) : null);
const json = (v: unknown) => v as Prisma.InputJsonValue;

async function unique<T>(constraint: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new UniqueViolationError(constraint);
    throw e;
  }
}

// ── row → domain mappers ──────────────────────────────────────────────────

type UserRow = Prisma.UserGetPayload<object>;
const toUser = (r: UserRow): User => ({ ...r, status: r.status, createdAt: iso(r.createdAt) });

const toTenant = (r: Prisma.TenantGetPayload<object>): Tenant => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  legalName: r.legalName,
  status: r.status,
  country: r.country,
  currency: r.currency,
  timezone: r.timezone,
  features: r.features as unknown as Tenant["features"],
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

const toBranch = (r: Prisma.BranchGetPayload<object>): Branch => ({
  ...r,
  openingHours: r.openingHours as unknown as Branch["openingHours"],
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

const membershipInclude = { branches: true } as const;
const toMembership = (r: Prisma.TenantMembershipGetPayload<{ include: typeof membershipInclude }>): TenantMembership => ({
  id: r.id,
  tenantId: r.tenantId,
  userId: r.userId,
  role: r.role,
  status: r.status,
  branchIds: r.branches.map((b) => b.branchId),
  createdAt: iso(r.createdAt),
});

const toInvitation = (r: Prisma.InvitationGetPayload<object>): Invitation => ({
  ...r,
  expiresAt: iso(r.expiresAt),
  acceptedAt: isoN(r.acceptedAt),
  revokedAt: isoN(r.revokedAt),
  createdAt: iso(r.createdAt),
});

const itemInclude = { variants: { orderBy: { sortOrder: "asc" } }, modifierGroups: { orderBy: { sortOrder: "asc" } } } as const;
const toItem = (r: Prisma.MenuItemGetPayload<{ include: typeof itemInclude }>): MenuItem => ({
  id: r.id,
  tenantId: r.tenantId,
  categoryId: r.categoryId,
  name: r.name,
  description: r.description,
  basePriceMinor: r.basePriceMinor,
  imageUrl: r.imageUrl,
  dietary: r.dietary,
  stationId: r.stationId,
  sortOrder: r.sortOrder,
  retiredAt: isoN(r.retiredAt),
  variants: r.variants.map((v) => ({
    id: v.id,
    itemId: v.itemId,
    name: v.name,
    priceDeltaMinor: v.priceDeltaMinor,
    isDefault: v.isDefault,
    sortOrder: v.sortOrder,
  })),
  modifierGroupIds: r.modifierGroups.map((g) => g.groupId),
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

const groupInclude = { options: { orderBy: { sortOrder: "asc" } } } as const;
const toGroup = (r: Prisma.ModifierGroupGetPayload<{ include: typeof groupInclude }>): ModifierGroup => ({
  id: r.id,
  tenantId: r.tenantId,
  name: r.name,
  minSelect: r.minSelect,
  maxSelect: r.maxSelect,
  retiredAt: isoN(r.retiredAt),
  options: r.options.map((o) => ({
    id: o.id,
    groupId: o.groupId,
    name: o.name,
    priceDeltaMinor: o.priceDeltaMinor,
    isAvailable: o.isAvailable,
    sortOrder: o.sortOrder,
  })),
});

const toTable = (r: Prisma.RestaurantTableGetPayload<object>): RestaurantTable => ({ ...r, qrRotatedAt: iso(r.qrRotatedAt), createdAt: iso(r.createdAt) });

const orderInclude = { items: { orderBy: { position: "asc" }, include: { modifiers: { orderBy: { position: "asc" } } } } } as const;
type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
const toOrder = (r: OrderRow): Order => {
  const { items, ...o } = r;
  return {
    ...o,
    createdAt: iso(o.createdAt),
    updatedAt: iso(o.updatedAt),
    confirmedAt: isoN(o.confirmedAt),
    acceptedAt: isoN(o.acceptedAt),
    readyAt: isoN(o.readyAt),
    handedOverAt: isoN(o.handedOverAt),
    completedAt: isoN(o.completedAt),
    items: items.map((i) => ({
      id: i.id,
      menuItemId: i.menuItemId,
      nameSnapshot: i.nameSnapshot,
      variantId: i.variantId,
      variantName: i.variantName,
      unitPriceMinor: i.unitPriceMinor,
      quantity: i.quantity,
      lineTotalMinor: i.lineTotalMinor,
      notes: i.notes,
      stationId: i.stationId,
      modifiers: i.modifiers.map((m) => ({
        id: m.id,
        optionId: m.optionId,
        groupName: m.groupName,
        optionName: m.optionName,
        priceDeltaMinor: m.priceDeltaMinor,
      })),
    })),
  };
};

const toAttempt = (r: Prisma.PaymentAttemptGetPayload<object>): PaymentAttempt => ({
  ...r,
  provider: r.provider as PaymentAttempt["provider"],
  lastEventAt: isoN(r.lastEventAt),
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

const toConnection = (r: Prisma.PaymentConnectionGetPayload<object>): PaymentConnection => ({
  ...r,
  provider: r.provider as PaymentConnection["provider"],
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

const toWebhook = (r: Prisma.PaymentWebhookEventGetPayload<object>): PaymentWebhookEvent => ({
  ...r,
  provider: r.provider as PaymentWebhookEvent["provider"],
  receivedAt: iso(r.receivedAt),
  processedAt: isoN(r.processedAt),
});

const toRefund = (r: Prisma.RefundGetPayload<object>): Refund => ({ ...r, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) });

const toOutbox = (r: Prisma.OutboxEventGetPayload<object>): OutboxEvent => ({
  ...r,
  type: r.type as OutboxEvent["type"],
  payload: r.payload as Record<string, unknown>,
  createdAt: iso(r.createdAt),
  publishedAt: isoN(r.publishedAt),
  deadAt: isoN(r.deadAt),
});

const toAssignment = (r: Prisma.DeliveryAssignmentGetPayload<object>): DeliveryAssignment => ({
  ...r,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

// ── store ─────────────────────────────────────────────────────────────────

export class PrismaStore implements DataStore {
  readonly kind = "postgres" as const;

  constructor(
    private readonly root: PrismaClient,
    private readonly db: Db = root,
    private readonly inTx = false,
  ) {}

  async tx<T>(fn: (store: DataStore) => Promise<T>): Promise<T> {
    if (this.inTx) return fn(this);
    return this.root.$transaction((t) => fn(new PrismaStore(this.root, t, true)), { timeout: 15_000, maxWait: 5_000 });
  }

  async ping() {
    await this.db.$queryRaw`SELECT 1`;
  }

  async disconnect() {
    await this.root.$disconnect();
  }

  // Identity
  async getUserById(id: string) {
    const r = await this.db.user.findUnique({ where: { id } });
    return r && toUser(r);
  }
  async getUserByEmail(email: string) {
    const r = await this.db.user.findUnique({ where: { email: email.toLowerCase() } });
    return r && toUser(r);
  }
  async getUsersByIds(ids: string[]) {
    if (!ids.length) return [];
    return (await this.db.user.findMany({ where: { id: { in: [...new Set(ids)] } } })).map(toUser);
  }
  createUser(u: New<User>) {
    return unique("users.email", async () => toUser(await this.db.user.create({ data: { ...u, email: u.email.toLowerCase(), createdAt: date(u.createdAt) } })));
  }
  async updateUser(id: string, patch: Partial<Pick<User, "name" | "passwordHash" | "status">>) {
    const n = await this.db.user.updateMany({ where: { id }, data: patch });
    return n.count ? this.getUserById(id) : null;
  }

  async createSession(s: New<Session>) {
    const r = await this.db.session.create({ data: { ...s, expiresAt: date(s.expiresAt), lastSeenAt: date(s.lastSeenAt), createdAt: date(s.createdAt) } });
    return { ...r, expiresAt: iso(r.expiresAt), lastSeenAt: iso(r.lastSeenAt), createdAt: iso(r.createdAt) };
  }
  async getSessionByTokenHash(tokenHash: string) {
    const r = await this.db.session.findUnique({ where: { tokenHash } });
    return r && { ...r, expiresAt: iso(r.expiresAt), lastSeenAt: iso(r.lastSeenAt), createdAt: iso(r.createdAt) };
  }
  async touchSession(id: string, lastSeenAt: string, expiresAt: string) {
    await this.db.session.updateMany({ where: { id }, data: { lastSeenAt: date(lastSeenAt), expiresAt: date(expiresAt) } });
  }
  async deleteSession(id: string) {
    await this.db.session.deleteMany({ where: { id } });
  }
  async deleteSessionsForUser(userId: string) {
    await this.db.session.deleteMany({ where: { userId } });
  }

  async listMembershipsForUser(userId: string) {
    return (await this.db.tenantMembership.findMany({ where: { userId }, include: membershipInclude, orderBy: { createdAt: "asc" } })).map(toMembership);
  }
  async listMemberships(tenantId: string) {
    return (await this.db.tenantMembership.findMany({ where: { tenantId }, include: membershipInclude, orderBy: { createdAt: "asc" } })).map(toMembership);
  }
  async getMembership(tenantId: string, id: string) {
    const r = await this.db.tenantMembership.findFirst({ where: { id, tenantId }, include: membershipInclude });
    return r && toMembership(r);
  }
  createMembership(m: New<TenantMembership>) {
    return unique("tenant_memberships.tenant_user", async () =>
      toMembership(
        await this.db.tenantMembership.create({
          data: {
            id: m.id,
            tenantId: m.tenantId,
            userId: m.userId,
            role: m.role,
            status: m.status,
            createdAt: date(m.createdAt),
            branches: { create: m.branchIds.map((branchId) => ({ branchId, tenantId: m.tenantId })) },
          },
          include: membershipInclude,
        }),
      ),
    );
  }
  async updateMembership(tenantId: string, id: string, patch: Partial<Pick<TenantMembership, "role" | "status" | "branchIds">>) {
    const existing = await this.getMembership(tenantId, id);
    if (!existing) return null;
    const write = async (db: Db) => {
      await db.tenantMembership.update({ where: { id }, data: { role: patch.role, status: patch.status } });
      if (patch.branchIds) {
        await db.branchMembership.deleteMany({ where: { membershipId: id } });
        if (patch.branchIds.length)
          await db.branchMembership.createMany({ data: patch.branchIds.map((branchId) => ({ membershipId: id, tenantId, branchId })) });
      }
    };
    if (this.inTx) await write(this.db);
    else await this.root.$transaction((t) => write(t));
    return this.getMembership(tenantId, id);
  }

  async createInvitation(i: New<Invitation>) {
    return toInvitation(
      await this.db.invitation.create({
        data: {
          ...i,
          email: i.email.toLowerCase(),
          expiresAt: date(i.expiresAt),
          acceptedAt: dateN(i.acceptedAt),
          revokedAt: dateN(i.revokedAt),
          createdAt: date(i.createdAt),
        },
      }),
    );
  }
  async getInvitationByTokenHash(tokenHash: string) {
    const r = await this.db.invitation.findUnique({ where: { tokenHash } });
    return r && toInvitation(r);
  }
  async listInvitations(tenantId: string) {
    return (await this.db.invitation.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } })).map(toInvitation);
  }
  async updateInvitation(tenantId: string, id: string, patch: Partial<Pick<Invitation, "acceptedAt" | "revokedAt">>) {
    const n = await this.db.invitation.updateMany({
      where: { id, tenantId },
      data: {
        ...(patch.acceptedAt !== undefined && { acceptedAt: dateN(patch.acceptedAt) }),
        ...(patch.revokedAt !== undefined && { revokedAt: dateN(patch.revokedAt) }),
      },
    });
    if (!n.count) return null;
    const r = await this.db.invitation.findUnique({ where: { id } });
    return r && toInvitation(r);
  }

  // Tenancy
  async listTenants() {
    return (await this.db.tenant.findMany({ orderBy: { name: "asc" } })).map(toTenant);
  }
  async getTenant(id: string) {
    const r = await this.db.tenant.findUnique({ where: { id } });
    return r && toTenant(r);
  }
  async getTenantBySlug(slug: string) {
    const r = await this.db.tenant.findUnique({ where: { slug } });
    return r && toTenant(r);
  }
  createTenant(t: New<Tenant>) {
    return unique("tenants.slug", async () =>
      toTenant(await this.db.tenant.create({ data: { ...t, features: json(t.features), createdAt: date(t.createdAt), updatedAt: date(t.updatedAt) } })),
    );
  }
  async updateTenant(id: string, patch: Partial<Omit<Tenant, "id" | "createdAt" | "slug" | "currency">>) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { updatedAt, features, ...rest } = patch;
    const n = await this.db.tenant.updateMany({ where: { id }, data: { ...rest, ...(features && { features: json(features) }) } });
    return n.count ? this.getTenant(id) : null;
  }

  async listBranches(tenantId: string) {
    return (await this.db.branch.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } })).map(toBranch);
  }
  async getBranch(tenantId: string, id: string) {
    const r = await this.db.branch.findFirst({ where: { id, tenantId } });
    return r && toBranch(r);
  }
  async createBranch(b: New<Branch>) {
    return toBranch(
      await this.db.branch.create({ data: { ...b, openingHours: json(b.openingHours), createdAt: date(b.createdAt), updatedAt: date(b.updatedAt) } }),
    );
  }
  async updateBranch(tenantId: string, id: string, patch: Partial<Omit<Branch, "id" | "tenantId" | "createdAt" | "orderSeq">>) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { updatedAt, openingHours, ...rest } = patch;
    const n = await this.db.branch.updateMany({
      where: { id, tenantId },
      data: { ...rest, ...(openingHours && { openingHours: json(openingHours) }), updatedAt: new Date() },
    });
    return n.count ? this.getBranch(tenantId, id) : null;
  }
  async nextOrderNumber(tenantId: string, branchId: string) {
    const rows = await this.db.$queryRaw<Array<{ order_seq: number }>>`
      UPDATE branches SET order_seq = order_seq + 1 WHERE id = ${branchId}::uuid AND tenant_id = ${tenantId}::uuid RETURNING order_seq`;
    if (!rows.length) throw new Error("Branch not found");
    return Number(rows[0].order_seq);
  }

  async setOrderSequence(tenantId: string, branchId: string, value: number) {
    await this.db.$executeRaw`UPDATE branches SET order_seq = GREATEST(order_seq, ${value}) WHERE id = ${branchId}::uuid AND tenant_id = ${tenantId}::uuid`;
  }

  // Catalog
  async listCategories(tenantId: string, opts: { includeRetired?: boolean } = {}) {
    const rows = await this.db.menuCategory.findMany({
      where: { tenantId, ...(!opts.includeRetired && { retiredAt: null }) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return rows.map((r) => ({ ...r, retiredAt: isoN(r.retiredAt) }));
  }
  async getCategory(tenantId: string, id: string) {
    const r = await this.db.menuCategory.findFirst({ where: { id, tenantId } });
    return r && { ...r, retiredAt: isoN(r.retiredAt) };
  }
  async createCategory(c: New<MenuCategory>) {
    const r = await this.db.menuCategory.create({ data: { ...c, retiredAt: dateN(c.retiredAt) } });
    return { ...r, retiredAt: isoN(r.retiredAt) };
  }
  async updateCategory(tenantId: string, id: string, patch: Partial<Pick<MenuCategory, "name" | "sortOrder" | "retiredAt">>) {
    const n = await this.db.menuCategory.updateMany({
      where: { id, tenantId },
      data: { ...patch, ...(patch.retiredAt !== undefined && { retiredAt: dateN(patch.retiredAt) }) },
    });
    return n.count ? this.getCategory(tenantId, id) : null;
  }

  async listMenuItems(tenantId: string, opts: { includeRetired?: boolean } = {}) {
    const rows = await this.db.menuItem.findMany({
      where: { tenantId, ...(!opts.includeRetired && { retiredAt: null }) },
      include: itemInclude,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return rows.map(toItem);
  }
  async getMenuItem(tenantId: string, id: string) {
    const r = await this.db.menuItem.findFirst({ where: { id, tenantId }, include: itemInclude });
    return r && toItem(r);
  }
  private async writeItemChildren(db: Db, itemId: string, input: MenuItemWrite) {
    const keep = input.variants.filter((v) => v.id).map((v) => v.id!);
    await db.menuItemVariant.deleteMany({ where: { itemId, id: { notIn: keep } } });
    for (const [i, v] of input.variants.entries()) {
      const data = { name: v.name, priceDeltaMinor: v.priceDeltaMinor, isDefault: v.isDefault, sortOrder: v.sortOrder ?? i };
      if (v.id) await db.menuItemVariant.upsert({ where: { id: v.id }, create: { id: v.id, itemId, ...data }, update: data });
      else await db.menuItemVariant.create({ data: { itemId, ...data } });
    }
    await db.menuItemModifierGroup.deleteMany({ where: { itemId } });
    if (input.modifierGroupIds.length)
      await db.menuItemModifierGroup.createMany({ data: input.modifierGroupIds.map((groupId, sortOrder) => ({ itemId, groupId, sortOrder })) });
  }
  private itemData(input: MenuItemWrite) {
    return {
      categoryId: input.categoryId,
      name: input.name,
      description: input.description,
      basePriceMinor: input.basePriceMinor,
      imageUrl: input.imageUrl,
      dietary: input.dietary,
      stationId: input.stationId,
      sortOrder: input.sortOrder,
    };
  }
  async createMenuItem(tenantId: string, input: MenuItemWrite) {
    const id = await this.tx(async (s) => {
      const db = (s as PrismaStore).db;
      const row = await db.menuItem.create({ data: { tenantId, ...this.itemData(input) } });
      await this.writeItemChildren(db, row.id, input);
      return row.id;
    });
    return (await this.getMenuItem(tenantId, id))!;
  }
  async updateMenuItem(tenantId: string, id: string, input: MenuItemWrite) {
    const ok = await this.tx(async (s) => {
      const db = (s as PrismaStore).db;
      const n = await db.menuItem.updateMany({ where: { id, tenantId }, data: this.itemData(input) });
      if (!n.count) return false;
      await this.writeItemChildren(db, id, input);
      return true;
    });
    return ok ? this.getMenuItem(tenantId, id) : null;
  }
  async setMenuItemRetired(tenantId: string, id: string, retiredAt: string | null) {
    const n = await this.db.menuItem.updateMany({ where: { id, tenantId }, data: { retiredAt: dateN(retiredAt) } });
    return n.count ? this.getMenuItem(tenantId, id) : null;
  }

  async listModifierGroups(tenantId: string, opts: { includeRetired?: boolean } = {}) {
    return (
      await this.db.modifierGroup.findMany({
        where: { tenantId, ...(!opts.includeRetired && { retiredAt: null }) },
        include: groupInclude,
        orderBy: { name: "asc" },
      })
    ).map(toGroup);
  }
  async getModifierGroup(tenantId: string, id: string) {
    const r = await this.db.modifierGroup.findFirst({ where: { id, tenantId }, include: groupInclude });
    return r && toGroup(r);
  }
  private async writeOptions(db: Db, groupId: string, input: ModifierGroupWrite) {
    const keep = input.options.filter((o) => o.id).map((o) => o.id!);
    await db.modifierOption.deleteMany({ where: { groupId, id: { notIn: keep } } });
    for (const [i, o] of input.options.entries()) {
      const data = { name: o.name, priceDeltaMinor: o.priceDeltaMinor, isAvailable: o.isAvailable, sortOrder: o.sortOrder ?? i };
      if (o.id) await db.modifierOption.upsert({ where: { id: o.id }, create: { id: o.id, groupId, ...data }, update: data });
      else await db.modifierOption.create({ data: { groupId, ...data } });
    }
  }
  async createModifierGroup(tenantId: string, input: ModifierGroupWrite) {
    const id = await this.tx(async (s) => {
      const db = (s as PrismaStore).db;
      const g = await db.modifierGroup.create({ data: { tenantId, name: input.name, minSelect: input.minSelect, maxSelect: input.maxSelect } });
      await this.writeOptions(db, g.id, input);
      return g.id;
    });
    return (await this.getModifierGroup(tenantId, id))!;
  }
  async updateModifierGroup(tenantId: string, id: string, input: ModifierGroupWrite) {
    const ok = await this.tx(async (s) => {
      const db = (s as PrismaStore).db;
      const n = await db.modifierGroup.updateMany({
        where: { id, tenantId },
        data: { name: input.name, minSelect: input.minSelect, maxSelect: input.maxSelect },
      });
      if (!n.count) return false;
      await this.writeOptions(db, id, input);
      return true;
    });
    return ok ? this.getModifierGroup(tenantId, id) : null;
  }
  async setModifierGroupRetired(tenantId: string, id: string, retiredAt: string | null) {
    const n = await this.db.modifierGroup.updateMany({ where: { id, tenantId }, data: { retiredAt: dateN(retiredAt) } });
    return n.count ? this.getModifierGroup(tenantId, id) : null;
  }

  async listBranchMenuItems(tenantId: string, branchId: string) {
    return this.db.branchMenuItem.findMany({ where: { tenantId, branchId } });
  }
  async upsertBranchMenuItem(row: BranchMenuItem) {
    return this.db.branchMenuItem.upsert({
      where: { branchId_itemId: { branchId: row.branchId, itemId: row.itemId } },
      create: row,
      update: { priceOverrideMinor: row.priceOverrideMinor, isAvailable: row.isAvailable },
    });
  }

  // Tables & stations
  async listTables(tenantId: string, branchId?: string) {
    const rows = await this.db.restaurantTable.findMany({ where: { tenantId, ...(branchId && { branchId }) } });
    return rows.map(toTable).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }
  async getTable(tenantId: string, id: string) {
    const r = await this.db.restaurantTable.findFirst({ where: { id, tenantId } });
    return r && toTable(r);
  }
  async getTableByQrRef(qrRef: string) {
    const r = await this.db.restaurantTable.findUnique({ where: { qrRef } });
    return r && toTable(r);
  }
  createTable(t: New<RestaurantTable>) {
    return unique("restaurant_tables", async () =>
      toTable(await this.db.restaurantTable.create({ data: { ...t, qrRotatedAt: date(t.qrRotatedAt), createdAt: date(t.createdAt) } })),
    );
  }
  async updateTable(tenantId: string, id: string, patch: Partial<Pick<RestaurantTable, "label" | "area" | "seats" | "status" | "qrRef" | "qrRotatedAt">>) {
    const n = await unique("restaurant_tables.branch_label", () =>
      this.db.restaurantTable.updateMany({ where: { id, tenantId }, data: { ...patch, ...(patch.qrRotatedAt && { qrRotatedAt: date(patch.qrRotatedAt) }) } }),
    );
    return n.count ? this.getTable(tenantId, id) : null;
  }
  async listStations(tenantId: string, branchId?: string): Promise<KitchenStation[]> {
    return this.db.kitchenStation.findMany({ where: { tenantId, ...(branchId && { branchId }) }, orderBy: { name: "asc" } });
  }
  async createStation(s: New<KitchenStation>) {
    return this.db.kitchenStation.create({ data: s });
  }

  // Orders
  createOrder(o: New<Order>) {
    return unique("orders.tenant_idempotency_key", async () => {
      const { items, ...order } = o;
      const row = await this.db.order.create({
        data: {
          ...order,
          createdAt: date(order.createdAt),
          updatedAt: date(order.updatedAt),
          confirmedAt: dateN(order.confirmedAt),
          acceptedAt: dateN(order.acceptedAt),
          readyAt: dateN(order.readyAt),
          handedOverAt: dateN(order.handedOverAt),
          completedAt: dateN(order.completedAt),
          items: {
            create: items.map((i, position) => ({
              id: i.id,
              position,
              menuItemId: i.menuItemId,
              nameSnapshot: i.nameSnapshot,
              variantId: i.variantId,
              variantName: i.variantName,
              unitPriceMinor: i.unitPriceMinor,
              quantity: i.quantity,
              lineTotalMinor: i.lineTotalMinor,
              notes: i.notes,
              stationId: i.stationId,
              modifiers: {
                create: i.modifiers.map((m, mp) => ({
                  id: m.id,
                  position: mp,
                  optionId: m.optionId,
                  groupName: m.groupName,
                  optionName: m.optionName,
                  priceDeltaMinor: m.priceDeltaMinor,
                })),
              },
            })),
          },
        },
        include: orderInclude,
      });
      return toOrder(row);
    });
  }
  async getOrder(tenantId: string, id: string) {
    const r = await this.db.order.findFirst({ where: { id, tenantId }, include: orderInclude });
    return r && toOrder(r);
  }
  async getOrderUnscoped(id: string) {
    const r = await this.db.order.findUnique({ where: { id }, include: orderInclude });
    return r && toOrder(r);
  }
  async findOrderByIdempotencyKey(tenantId: string, key: string) {
    const r = await this.db.order.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: key } }, include: orderInclude });
    return r && toOrder(r);
  }
  async listOrders(tenantId: string, f: OrderFilter) {
    const q = f.q?.replace(/^#/, "").trim();
    const where: Prisma.OrderWhereInput = {
      tenantId,
      ...(f.branchIds && { branchId: { in: f.branchIds } }),
      ...(f.statuses && { status: { in: f.statuses } }),
      ...(f.fulfillmentType && { fulfillmentType: f.fulfillmentType }),
      ...((f.createdFrom || f.createdTo) && {
        createdAt: { ...(f.createdFrom && { gte: date(f.createdFrom) }), ...(f.createdTo && { lt: date(f.createdTo) }) },
      }),
      ...(q && {
        OR: [
          ...(/^\d+$/.test(q) ? [{ number: Number(q) }] : []),
          { customerName: { contains: q, mode: "insensitive" as const } },
          { customerPhone: { contains: q } },
          { tableLabel: { contains: q, mode: "insensitive" as const } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.db.order.findMany({ where, include: orderInclude, orderBy: { createdAt: "desc" }, skip: f.offset, take: f.limit }),
      this.db.order.count({ where }),
    ]);
    return { items: rows.map(toOrder), total };
  }
  private orderPatch(patch: Partial<Order>): Prisma.OrderUpdateManyMutationInput {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { items, id, tenantId, version, createdAt, updatedAt, confirmedAt, acceptedAt, readyAt, handedOverAt, completedAt, ...rest } = patch;
    return {
      ...rest,
      ...(confirmedAt !== undefined && { confirmedAt: dateN(confirmedAt) }),
      ...(acceptedAt !== undefined && { acceptedAt: dateN(acceptedAt) }),
      ...(readyAt !== undefined && { readyAt: dateN(readyAt) }),
      ...(handedOverAt !== undefined && { handedOverAt: dateN(handedOverAt) }),
      ...(completedAt !== undefined && { completedAt: dateN(completedAt) }),
      version: { increment: 1 },
    };
  }
  async casOrder(
    tenantId: string,
    id: string,
    expect: { statuses: readonly OrderStatus[]; version?: number },
    patch: Partial<Omit<Order, "id" | "tenantId" | "items" | "version">>,
  ) {
    const n = await this.db.order.updateMany({
      where: { id, tenantId, status: { in: [...expect.statuses] }, ...(expect.version !== undefined && { version: expect.version }) },
      data: this.orderPatch(patch),
    });
    return n.count ? this.getOrder(tenantId, id) : null;
  }
  async updateOrderFields(tenantId: string, id: string, patch: Partial<Pick<Order, "paymentStatus" | "refundedMinor">>) {
    const n = await this.db.order.updateMany({ where: { id, tenantId }, data: this.orderPatch(patch) });
    return n.count ? this.getOrder(tenantId, id) : null;
  }
  async addStatusHistory(h: New<OrderStatusHistory>) {
    const r = await this.db.orderStatusHistory.create({ data: { ...h, createdAt: date(h.createdAt) } });
    return { ...r, createdAt: iso(r.createdAt) };
  }
  async listStatusHistory(tenantId: string, orderId: string) {
    const rows = await this.db.orderStatusHistory.findMany({ where: { tenantId, orderId }, orderBy: { createdAt: "asc" } });
    return rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) }));
  }

  async createKitchenTicket(t: New<KitchenTicket>) {
    // ON CONFLICT (order_id) DO NOTHING: exactly one ticket, without aborting the transaction.
    const n = await this.db.kitchenTicket.createMany({ data: [{ ...t, createdAt: date(t.createdAt) }], skipDuplicates: true });
    if (!n.count) return null;
    const r = await this.db.kitchenTicket.findUnique({ where: { orderId: t.orderId } });
    return r && { ...r, createdAt: iso(r.createdAt) };
  }
  async getKitchenTicketByOrder(tenantId: string, orderId: string) {
    const r = await this.db.kitchenTicket.findFirst({ where: { tenantId, orderId } });
    return r && { ...r, createdAt: iso(r.createdAt) };
  }
  countKitchenTickets(tenantId: string, orderId: string) {
    return this.db.kitchenTicket.count({ where: { tenantId, orderId } });
  }

  // Payments
  async getPaymentConnection(tenantId: string) {
    const r = await this.db.paymentConnection.findUnique({ where: { tenantId } });
    return r && toConnection(r);
  }
  async upsertPaymentConnection(c: New<PaymentConnection>) {
    const data = { provider: c.provider, status: c.status, merchantAccountId: c.merchantAccountId, displayName: c.displayName };
    return toConnection(
      await this.db.paymentConnection.upsert({
        where: { tenantId: c.tenantId },
        create: { ...data, tenantId: c.tenantId, createdAt: date(c.createdAt) },
        update: data,
      }),
    );
  }
  createPaymentAttempt(a: New<PaymentAttempt>) {
    return unique("payment_attempts.tenant_idempotency_key", async () =>
      toAttempt(
        await this.db.paymentAttempt.create({ data: { ...a, lastEventAt: dateN(a.lastEventAt), createdAt: date(a.createdAt), updatedAt: date(a.updatedAt) } }),
      ),
    );
  }
  async getPaymentAttemptUnscoped(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const r = await this.db.paymentAttempt.findUnique({ where: { id } });
    return r && toAttempt(r);
  }
  async getPaymentAttempt(tenantId: string, id: string) {
    const r = await this.db.paymentAttempt.findFirst({ where: { id, tenantId } });
    return r && toAttempt(r);
  }
  async findPaymentAttemptByIdempotencyKey(tenantId: string, key: string) {
    const r = await this.db.paymentAttempt.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: key } } });
    return r && toAttempt(r);
  }
  async listPaymentAttempts(tenantId: string | null, f: { orderId?: string; statuses?: PaymentStatus[]; olderThan?: string; limit: number }) {
    const rows = await this.db.paymentAttempt.findMany({
      where: {
        ...(tenantId && { tenantId }),
        ...(f.orderId && { orderId: f.orderId }),
        ...(f.statuses && { status: { in: f.statuses } }),
        ...(f.olderThan && { createdAt: { lt: date(f.olderThan) } }),
      },
      orderBy: { createdAt: "desc" },
      take: f.limit,
    });
    return rows.map(toAttempt);
  }
  async casPaymentAttempt(
    id: string,
    expectStatuses: readonly PaymentStatus[],
    patch: Partial<Pick<PaymentAttempt, "status" | "providerPaymentId" | "failureReason" | "reviewFlag" | "lastEventAt" | "checkoutUrl">>,
  ) {
    const n = await this.db.paymentAttempt.updateMany({
      where: { id, status: { in: [...expectStatuses] } },
      data: { ...patch, ...(patch.lastEventAt !== undefined && { lastEventAt: dateN(patch.lastEventAt) }) },
    });
    return n.count ? this.getPaymentAttemptUnscoped(id) : null;
  }

  async insertWebhookEvent(e: New<PaymentWebhookEvent>) {
    const n = await this.db.paymentWebhookEvent.createMany({
      data: [{ ...e, receivedAt: date(e.receivedAt), processedAt: dateN(e.processedAt) }],
      skipDuplicates: true,
    });
    const row = await this.db.paymentWebhookEvent.findUnique({ where: { provider_eventId: { provider: e.provider, eventId: e.eventId } } });
    return { inserted: n.count === 1, event: toWebhook(row!) };
  }
  async updateWebhookEvent(id: string, patch: Partial<Pick<PaymentWebhookEvent, "outcome" | "error" | "processedAt" | "tenantId" | "attemptId">>) {
    await this.db.paymentWebhookEvent.updateMany({
      where: { id },
      data: { ...patch, ...(patch.processedAt !== undefined && { processedAt: dateN(patch.processedAt) }) },
    });
  }
  async listWebhookEvents(tenantId: string | null, limit: number) {
    return (await this.db.paymentWebhookEvent.findMany({ where: tenantId ? { tenantId } : {}, orderBy: { receivedAt: "desc" }, take: limit })).map(toWebhook);
  }

  createRefund(r: New<Refund>) {
    return unique("refunds.tenant_idempotency_key", async () =>
      toRefund(await this.db.refund.create({ data: { ...r, createdAt: date(r.createdAt), updatedAt: date(r.updatedAt) } })),
    );
  }
  async findRefundByIdempotencyKey(tenantId: string, key: string) {
    const r = await this.db.refund.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: key } } });
    return r && toRefund(r);
  }
  async listRefunds(tenantId: string, f: { orderId?: string; limit: number }) {
    return (
      await this.db.refund.findMany({ where: { tenantId, ...(f.orderId && { orderId: f.orderId }) }, orderBy: { createdAt: "desc" }, take: f.limit })
    ).map(toRefund);
  }
  async updateRefund(tenantId: string, id: string, patch: Partial<Pick<Refund, "status" | "providerRefundId" | "failureReason">>) {
    const n = await this.db.refund.updateMany({ where: { id, tenantId }, data: patch });
    if (!n.count) return null;
    const r = await this.db.refund.findUnique({ where: { id } });
    return r && toRefund(r);
  }

  // Outbox
  async addOutboxEvent(e: New<OutboxEvent>) {
    return toOutbox(
      await this.db.outboxEvent.create({
        data: { ...e, payload: json(e.payload), createdAt: date(e.createdAt), publishedAt: dateN(e.publishedAt), deadAt: dateN(e.deadAt) },
      }),
    );
  }
  async listUnpublishedOutbox(limit: number) {
    return (await this.db.outboxEvent.findMany({ where: { publishedAt: null, deadAt: null }, orderBy: { createdAt: "asc" }, take: limit })).map(toOutbox);
  }
  async markOutboxPublished(ids: string[], at: string) {
    await this.db.outboxEvent.updateMany({ where: { id: { in: ids } }, data: { publishedAt: date(at) } });
  }
  async markOutboxFailed(id: string, error: string, dead: boolean) {
    await this.db.outboxEvent.updateMany({
      where: { id },
      data: { attempts: { increment: 1 }, lastError: error.slice(0, 1000), ...(dead && { deadAt: new Date() }) },
    });
  }

  // Delivery
  createDeliveryAssignment(a: New<DeliveryAssignment>) {
    // A partial unique index (one active assignment per order) backs this check — see migration.
    return unique("delivery_assignments.active_order", async () =>
      toAssignment(await this.db.deliveryAssignment.create({ data: { ...a, createdAt: date(a.createdAt), updatedAt: date(a.updatedAt) } })),
    );
  }
  async getDeliveryAssignment(tenantId: string, id: string) {
    const r = await this.db.deliveryAssignment.findFirst({ where: { id, tenantId } });
    return r && toAssignment(r);
  }
  async getAssignmentForOrder(tenantId: string, orderId: string) {
    const r = await this.db.deliveryAssignment.findFirst({ where: { tenantId, orderId }, orderBy: { createdAt: "desc" } });
    return r && toAssignment(r);
  }
  async listAssignments(tenantId: string, f: { runnerUserId?: string; orderIds?: string[]; activeOnly?: boolean }) {
    const rows = await this.db.deliveryAssignment.findMany({
      where: {
        tenantId,
        ...(f.runnerUserId && { runnerUserId: f.runnerUserId }),
        ...(f.orderIds && { orderId: { in: f.orderIds } }),
        ...(f.activeOnly && { status: { in: ["ASSIGNED", "PICKED_UP"] } }),
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toAssignment);
  }
  async casDeliveryAssignment(
    tenantId: string,
    id: string,
    expectStatuses: readonly DeliveryStatus[],
    patch: Partial<Pick<DeliveryAssignment, "status" | "note" | "runnerUserId">>,
  ) {
    const n = await this.db.deliveryAssignment.updateMany({ where: { id, tenantId, status: { in: [...expectStatuses] } }, data: patch });
    return n.count ? this.getDeliveryAssignment(tenantId, id) : null;
  }
  async addDeliveryEvent(e: New<DeliveryEvent>) {
    const r = await this.db.deliveryEvent.create({ data: { ...e, createdAt: date(e.createdAt) } });
    return { ...r, createdAt: iso(r.createdAt) };
  }
  async listDeliveryEvents(tenantId: string, assignmentId: string) {
    const rows = await this.db.deliveryEvent.findMany({ where: { tenantId, assignmentId }, orderBy: { createdAt: "asc" } });
    return rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) }));
  }

  // Audit / files
  async addAudit(a: New<AuditLog>) {
    const r = await this.db.auditLog.create({ data: { ...a, meta: json(a.meta), createdAt: date(a.createdAt) } });
    return { ...r, meta: r.meta as Record<string, unknown>, createdAt: iso(r.createdAt) };
  }
  async listAudit(f: { tenantId: string | null; limit: number; offset: number }) {
    const where = f.tenantId === null ? {} : { tenantId: f.tenantId };
    const [rows, total] = await Promise.all([
      this.db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: f.offset, take: f.limit }),
      this.db.auditLog.count({ where }),
    ]);
    return { items: rows.map((r) => ({ ...r, meta: r.meta as Record<string, unknown>, createdAt: iso(r.createdAt) })), total };
  }
  async createFile(f: New<StoredFile>) {
    const r = await this.db.storedFile.create({ data: { ...f, createdAt: date(f.createdAt) } });
    return { ...r, createdAt: iso(r.createdAt) };
  }
  async getFileByKey(key: string) {
    const r = await this.db.storedFile.findUnique({ where: { key } });
    return r && { ...r, createdAt: iso(r.createdAt) };
  }
}

export function newPrismaClient(databaseUrl: string): PrismaClient {
  // DB_POOL_MAX caps connections per instance (size it against the database's
  // max_connections ÷ app instances). The embedded `prisma dev` server needs 1.
  const max = Number(process.env.DB_POOL_MAX) || undefined;
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, ...(max && { max }) }) });
}

export async function createPrismaStore(databaseUrl: string): Promise<PrismaStore> {
  const store = new PrismaStore(newPrismaClient(databaseUrl));
  await store.ping(); // fail fast: no silent fallback to demo data
  return store;
}
