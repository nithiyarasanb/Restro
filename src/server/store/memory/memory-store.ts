import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type {
  AuditLog,
  Branch,
  BranchMenuItem,
  DeliveryAssignment,
  DeliveryEvent,
  Invitation,
  KitchenStation,
  KitchenTicket,
  MenuCategory,
  MenuItem,
  ModifierGroup,
  Order,
  OrderStatusHistory,
  OutboxEvent,
  PaymentAttempt,
  PaymentConnection,
  PaymentWebhookEvent,
  Refund,
  RestaurantTable,
  Session,
  StoredFile,
  Tenant,
  TenantMembership,
  User,
} from "@/types/domain";
import { UniqueViolationError, type DataStore, type MenuItemWrite, type ModifierGroupWrite, type New } from "../types";

// In-process demo store (ADR-0004). Mirrors the PostgreSQL constraints that
// matter for correctness: unique keys, compare-and-set updates and atomic
// transactions (global mutex + snapshot rollback). Not for production use.

export interface MemoryState {
  users: Map<string, User>;
  sessions: Map<string, Session>;
  memberships: Map<string, TenantMembership>;
  invitations: Map<string, Invitation>;
  tenants: Map<string, Tenant>;
  branches: Map<string, Branch>;
  categories: Map<string, MenuCategory>;
  items: Map<string, MenuItem>;
  groups: Map<string, ModifierGroup>;
  branchItems: Map<string, BranchMenuItem>;
  tables: Map<string, RestaurantTable>;
  stations: Map<string, KitchenStation>;
  orders: Map<string, Order>;
  history: OrderStatusHistory[];
  tickets: Map<string, KitchenTicket>; // keyed by orderId
  connections: Map<string, PaymentConnection>; // keyed by tenantId
  attempts: Map<string, PaymentAttempt>;
  webhookEvents: Map<string, PaymentWebhookEvent>; // keyed by provider:eventId
  refunds: Map<string, Refund>;
  outbox: OutboxEvent[];
  assignments: Map<string, DeliveryAssignment>;
  deliveryEvents: DeliveryEvent[];
  audit: AuditLog[];
  files: Map<string, StoredFile>; // keyed by key
}

export function emptyState(): MemoryState {
  return {
    users: new Map(),
    sessions: new Map(),
    memberships: new Map(),
    invitations: new Map(),
    tenants: new Map(),
    branches: new Map(),
    categories: new Map(),
    items: new Map(),
    groups: new Map(),
    branchItems: new Map(),
    tables: new Map(),
    stations: new Map(),
    orders: new Map(),
    history: [],
    tickets: new Map(),
    connections: new Map(),
    attempts: new Map(),
    webhookEvents: new Map(),
    refunds: new Map(),
    outbox: [],
    assignments: new Map(),
    deliveryEvents: [],
    audit: [],
    files: new Map(),
  };
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
const now = () => new Date().toISOString();
const txContext = new AsyncLocalStorage<true>();

class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function byCreatedDesc<T extends { createdAt: string }>(a: T, b: T) {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

export class MemoryStore implements DataStore {
  readonly kind = "memory" as const;
  private readonly mutex = new Mutex();

  constructor(public state: MemoryState = emptyState()) {}

  // ── infrastructure ──────────────────────────────────────────────────────

  async tx<T>(fn: (store: DataStore) => Promise<T>): Promise<T> {
    if (txContext.getStore()) return fn(this);
    return this.mutex.run(() => {
      const snapshot = structuredClone(this.state);
      return txContext.run(true, async () => {
        try {
          return await fn(this);
        } catch (e) {
          this.state = snapshot;
          throw e;
        }
      });
    });
  }

  async ping(): Promise<void> {}

  private async write<T>(fn: (s: MemoryState) => T): Promise<T> {
    if (txContext.getStore()) return clone(fn(this.state));
    return this.mutex.run(async () => clone(fn(this.state)));
  }

  private async read<T>(fn: (s: MemoryState) => T): Promise<T> {
    return clone(fn(this.state));
  }

  // ── identity ────────────────────────────────────────────────────────────

  getUserById(id: string) {
    return this.read((s) => s.users.get(id) ?? null);
  }
  getUserByEmail(email: string) {
    const e = email.toLowerCase();
    return this.read((s) => [...s.users.values()].find((u) => u.email === e) ?? null);
  }
  getUsersByIds(ids: string[]) {
    return this.read((s) => ids.map((id) => s.users.get(id)).filter((u): u is User => !!u));
  }
  createUser(user: New<User>) {
    return this.write((s) => {
      const email = user.email.toLowerCase();
      if ([...s.users.values()].some((u) => u.email === email)) throw new UniqueViolationError("users.email");
      const row: User = { ...user, email, id: user.id ?? randomUUID() };
      s.users.set(row.id, row);
      return row;
    });
  }
  updateUser(id: string, patch: Partial<Pick<User, "name" | "passwordHash" | "status">>) {
    return this.write((s) => {
      const u = s.users.get(id);
      if (!u) return null;
      Object.assign(u, patch);
      return u;
    });
  }

  createSession(session: New<Session>) {
    return this.write((s) => {
      const row: Session = { ...session, id: session.id ?? randomUUID() };
      s.sessions.set(row.id, row);
      return row;
    });
  }
  getSessionByTokenHash(tokenHash: string) {
    return this.read((s) => [...s.sessions.values()].find((x) => x.tokenHash === tokenHash) ?? null);
  }
  touchSession(id: string, lastSeenAt: string, expiresAt: string) {
    return this.write((s) => {
      const row = s.sessions.get(id);
      if (row) Object.assign(row, { lastSeenAt, expiresAt });
    });
  }
  deleteSession(id: string) {
    return this.write((s) => void s.sessions.delete(id));
  }
  deleteSessionsForUser(userId: string) {
    return this.write((s) => {
      for (const [k, v] of s.sessions) if (v.userId === userId) s.sessions.delete(k);
    });
  }

  listMembershipsForUser(userId: string) {
    return this.read((s) => [...s.memberships.values()].filter((m) => m.userId === userId));
  }
  listMemberships(tenantId: string) {
    return this.read((s) => [...s.memberships.values()].filter((m) => m.tenantId === tenantId));
  }
  getMembership(tenantId: string, id: string) {
    return this.read((s) => {
      const m = s.memberships.get(id);
      return m && m.tenantId === tenantId ? m : null;
    });
  }
  createMembership(m: New<TenantMembership>) {
    return this.write((s) => {
      if ([...s.memberships.values()].some((x) => x.tenantId === m.tenantId && x.userId === m.userId))
        throw new UniqueViolationError("tenant_memberships.tenant_user");
      const row: TenantMembership = { ...m, id: m.id ?? randomUUID() };
      s.memberships.set(row.id, row);
      return row;
    });
  }
  updateMembership(tenantId: string, id: string, patch: Partial<Pick<TenantMembership, "role" | "status" | "branchIds">>) {
    return this.write((s) => {
      const m = s.memberships.get(id);
      if (!m || m.tenantId !== tenantId) return null;
      Object.assign(m, patch);
      return m;
    });
  }

  createInvitation(inv: New<Invitation>) {
    return this.write((s) => {
      const row: Invitation = { ...inv, email: inv.email.toLowerCase(), id: inv.id ?? randomUUID() };
      s.invitations.set(row.id, row);
      return row;
    });
  }
  getInvitationByTokenHash(tokenHash: string) {
    return this.read((s) => [...s.invitations.values()].find((i) => i.tokenHash === tokenHash) ?? null);
  }
  listInvitations(tenantId: string) {
    return this.read((s) => [...s.invitations.values()].filter((i) => i.tenantId === tenantId).sort(byCreatedDesc));
  }
  updateInvitation(tenantId: string, id: string, patch: Partial<Pick<Invitation, "acceptedAt" | "revokedAt">>) {
    return this.write((s) => {
      const i = s.invitations.get(id);
      if (!i || i.tenantId !== tenantId) return null;
      Object.assign(i, patch);
      return i;
    });
  }

  // ── tenancy ─────────────────────────────────────────────────────────────

  listTenants() {
    return this.read((s) => [...s.tenants.values()].sort((a, b) => a.name.localeCompare(b.name)));
  }
  getTenant(id: string) {
    return this.read((s) => s.tenants.get(id) ?? null);
  }
  getTenantBySlug(slug: string) {
    return this.read((s) => [...s.tenants.values()].find((t) => t.slug === slug) ?? null);
  }
  createTenant(t: New<Tenant>) {
    return this.write((s) => {
      if ([...s.tenants.values()].some((x) => x.slug === t.slug)) throw new UniqueViolationError("tenants.slug");
      const row: Tenant = { ...t, id: t.id ?? randomUUID() };
      s.tenants.set(row.id, row);
      return row;
    });
  }
  updateTenant(id: string, patch: Partial<Omit<Tenant, "id" | "createdAt" | "slug" | "currency">>) {
    return this.write((s) => {
      const t = s.tenants.get(id);
      if (!t) return null;
      Object.assign(t, patch, { updatedAt: now() });
      return t;
    });
  }

  listBranches(tenantId: string) {
    return this.read((s) => [...s.branches.values()].filter((b) => b.tenantId === tenantId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }
  getBranch(tenantId: string, id: string) {
    return this.read((s) => {
      const b = s.branches.get(id);
      return b && b.tenantId === tenantId ? b : null;
    });
  }
  createBranch(b: New<Branch>) {
    return this.write((s) => {
      const row: Branch = { ...b, id: b.id ?? randomUUID() };
      s.branches.set(row.id, row);
      return row;
    });
  }
  updateBranch(tenantId: string, id: string, patch: Partial<Omit<Branch, "id" | "tenantId" | "createdAt" | "orderSeq">>) {
    return this.write((s) => {
      const b = s.branches.get(id);
      if (!b || b.tenantId !== tenantId) return null;
      Object.assign(b, patch, { updatedAt: now() });
      return b;
    });
  }
  nextOrderNumber(tenantId: string, branchId: string) {
    return this.write((s) => {
      const b = s.branches.get(branchId);
      if (!b || b.tenantId !== tenantId) throw new Error("Branch not found");
      b.orderSeq += 1;
      return b.orderSeq;
    });
  }

  setOrderSequence(tenantId: string, branchId: string, value: number) {
    return this.write((s) => {
      const b = s.branches.get(branchId);
      if (b && b.tenantId === tenantId) b.orderSeq = Math.max(b.orderSeq, value);
    });
  }

  // ── catalog ─────────────────────────────────────────────────────────────

  listCategories(tenantId: string, opts: { includeRetired?: boolean } = {}) {
    return this.read((s) =>
      [...s.categories.values()]
        .filter((c) => c.tenantId === tenantId && (opts.includeRetired || !c.retiredAt))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    );
  }
  getCategory(tenantId: string, id: string) {
    return this.read((s) => {
      const c = s.categories.get(id);
      return c && c.tenantId === tenantId ? c : null;
    });
  }
  createCategory(c: New<MenuCategory>) {
    return this.write((s) => {
      const row: MenuCategory = { ...c, id: c.id ?? randomUUID() };
      s.categories.set(row.id, row);
      return row;
    });
  }
  updateCategory(tenantId: string, id: string, patch: Partial<Pick<MenuCategory, "name" | "sortOrder" | "retiredAt">>) {
    return this.write((s) => {
      const c = s.categories.get(id);
      if (!c || c.tenantId !== tenantId) return null;
      Object.assign(c, patch);
      return c;
    });
  }

  listMenuItems(tenantId: string, opts: { includeRetired?: boolean } = {}) {
    return this.read((s) =>
      [...s.items.values()]
        .filter((i) => i.tenantId === tenantId && (opts.includeRetired || !i.retiredAt))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    );
  }
  getMenuItem(tenantId: string, id: string) {
    return this.read((s) => {
      const i = s.items.get(id);
      return i && i.tenantId === tenantId ? i : null;
    });
  }
  private buildItem(id: string, tenantId: string, input: MenuItemWrite, createdAt: string): MenuItem {
    return {
      id,
      tenantId,
      categoryId: input.categoryId,
      name: input.name,
      description: input.description,
      basePriceMinor: input.basePriceMinor,
      imageUrl: input.imageUrl,
      dietary: input.dietary,
      stationId: input.stationId,
      sortOrder: input.sortOrder,
      retiredAt: null,
      variants: input.variants.map((v, i) => ({ ...v, id: v.id ?? randomUUID(), itemId: id, sortOrder: v.sortOrder ?? i })),
      modifierGroupIds: [...input.modifierGroupIds],
      createdAt,
      updatedAt: now(),
    };
  }
  createMenuItem(tenantId: string, input: MenuItemWrite) {
    return this.write((s) => {
      const id = randomUUID();
      const row = this.buildItem(id, tenantId, input, now());
      s.items.set(id, row);
      return row;
    });
  }
  updateMenuItem(tenantId: string, id: string, input: MenuItemWrite) {
    return this.write((s) => {
      const existing = s.items.get(id);
      if (!existing || existing.tenantId !== tenantId) return null;
      const row = { ...this.buildItem(id, tenantId, input, existing.createdAt), retiredAt: existing.retiredAt };
      s.items.set(id, row);
      return row;
    });
  }
  setMenuItemRetired(tenantId: string, id: string, retiredAt: string | null) {
    return this.write((s) => {
      const i = s.items.get(id);
      if (!i || i.tenantId !== tenantId) return null;
      i.retiredAt = retiredAt;
      i.updatedAt = now();
      return i;
    });
  }

  listModifierGroups(tenantId: string, opts: { includeRetired?: boolean } = {}) {
    return this.read((s) =>
      [...s.groups.values()].filter((g) => g.tenantId === tenantId && (opts.includeRetired || !g.retiredAt)).sort((a, b) => a.name.localeCompare(b.name)),
    );
  }
  getModifierGroup(tenantId: string, id: string) {
    return this.read((s) => {
      const g = s.groups.get(id);
      return g && g.tenantId === tenantId ? g : null;
    });
  }
  private buildGroup(id: string, tenantId: string, input: ModifierGroupWrite): ModifierGroup {
    return {
      id,
      tenantId,
      name: input.name,
      minSelect: input.minSelect,
      maxSelect: input.maxSelect,
      retiredAt: null,
      options: input.options.map((o, i) => ({ ...o, id: o.id ?? randomUUID(), groupId: id, sortOrder: o.sortOrder ?? i })),
    };
  }
  createModifierGroup(tenantId: string, input: ModifierGroupWrite) {
    return this.write((s) => {
      const row = this.buildGroup(randomUUID(), tenantId, input);
      s.groups.set(row.id, row);
      return row;
    });
  }
  updateModifierGroup(tenantId: string, id: string, input: ModifierGroupWrite) {
    return this.write((s) => {
      const existing = s.groups.get(id);
      if (!existing || existing.tenantId !== tenantId) return null;
      const row = { ...this.buildGroup(id, tenantId, input), retiredAt: existing.retiredAt };
      s.groups.set(id, row);
      return row;
    });
  }
  setModifierGroupRetired(tenantId: string, id: string, retiredAt: string | null) {
    return this.write((s) => {
      const g = s.groups.get(id);
      if (!g || g.tenantId !== tenantId) return null;
      g.retiredAt = retiredAt;
      return g;
    });
  }

  listBranchMenuItems(tenantId: string, branchId: string) {
    return this.read((s) => [...s.branchItems.values()].filter((r) => r.tenantId === tenantId && r.branchId === branchId));
  }
  upsertBranchMenuItem(row: BranchMenuItem) {
    return this.write((s) => {
      s.branchItems.set(`${row.branchId}:${row.itemId}`, { ...row });
      return row;
    });
  }

  // ── tables & stations ───────────────────────────────────────────────────

  listTables(tenantId: string, branchId?: string) {
    return this.read((s) =>
      [...s.tables.values()]
        .filter((t) => t.tenantId === tenantId && (!branchId || t.branchId === branchId))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    );
  }
  getTable(tenantId: string, id: string) {
    return this.read((s) => {
      const t = s.tables.get(id);
      return t && t.tenantId === tenantId ? t : null;
    });
  }
  getTableByQrRef(qrRef: string) {
    return this.read((s) => [...s.tables.values()].find((t) => t.qrRef === qrRef) ?? null);
  }
  createTable(t: New<RestaurantTable>) {
    return this.write((s) => {
      const all = [...s.tables.values()];
      if (all.some((x) => x.qrRef === t.qrRef)) throw new UniqueViolationError("restaurant_tables.qr_ref");
      if (all.some((x) => x.branchId === t.branchId && x.label.toLowerCase() === t.label.toLowerCase()))
        throw new UniqueViolationError("restaurant_tables.branch_label");
      const row: RestaurantTable = { ...t, id: t.id ?? randomUUID() };
      s.tables.set(row.id, row);
      return row;
    });
  }
  updateTable(tenantId: string, id: string, patch: Partial<Pick<RestaurantTable, "label" | "area" | "seats" | "status" | "qrRef" | "qrRotatedAt">>) {
    return this.write((s) => {
      const t = s.tables.get(id);
      if (!t || t.tenantId !== tenantId) return null;
      if (patch.label && [...s.tables.values()].some((x) => x.id !== id && x.branchId === t.branchId && x.label.toLowerCase() === patch.label!.toLowerCase()))
        throw new UniqueViolationError("restaurant_tables.branch_label");
      Object.assign(t, patch);
      return t;
    });
  }
  listStations(tenantId: string, branchId?: string) {
    return this.read((s) => [...s.stations.values()].filter((x) => x.tenantId === tenantId && (!branchId || x.branchId === branchId)));
  }
  createStation(st: New<KitchenStation>) {
    return this.write((s) => {
      const row: KitchenStation = { ...st, id: st.id ?? randomUUID() };
      s.stations.set(row.id, row);
      return row;
    });
  }

  // ── orders ──────────────────────────────────────────────────────────────

  createOrder(order: New<Order>) {
    return this.write((s) => {
      if ([...s.orders.values()].some((o) => o.tenantId === order.tenantId && o.idempotencyKey === order.idempotencyKey))
        throw new UniqueViolationError("orders.tenant_idempotency_key");
      const row: Order = { ...order, id: order.id ?? randomUUID() };
      s.orders.set(row.id, row);
      return row;
    });
  }
  getOrder(tenantId: string, id: string) {
    return this.read((s) => {
      const o = s.orders.get(id);
      return o && o.tenantId === tenantId ? o : null;
    });
  }
  getOrderUnscoped(id: string) {
    return this.read((s) => s.orders.get(id) ?? null);
  }
  findOrderByIdempotencyKey(tenantId: string, key: string) {
    return this.read((s) => [...s.orders.values()].find((o) => o.tenantId === tenantId && o.idempotencyKey === key) ?? null);
  }
  listOrders(tenantId: string, f: import("../types").OrderFilter) {
    return this.read((s) => {
      const q = f.q?.toLowerCase().replace(/^#/, "");
      const rows = [...s.orders.values()]
        .filter(
          (o) =>
            o.tenantId === tenantId &&
            (!f.branchIds || f.branchIds.includes(o.branchId)) &&
            (!f.statuses || f.statuses.includes(o.status)) &&
            (!f.fulfillmentType || o.fulfillmentType === f.fulfillmentType) &&
            (!f.createdFrom || o.createdAt >= f.createdFrom) &&
            (!f.createdTo || o.createdAt < f.createdTo) &&
            (!q ||
              String(o.number).includes(q) ||
              o.customerName?.toLowerCase().includes(q) ||
              o.customerPhone?.includes(q) ||
              o.tableLabel?.toLowerCase().includes(q)),
        )
        .sort(byCreatedDesc);
      return { items: rows.slice(f.offset, f.offset + f.limit), total: rows.length };
    });
  }
  casOrder(
    tenantId: string,
    id: string,
    expect: { statuses: readonly import("@/types/domain").OrderStatus[]; version?: number },
    patch: Partial<Omit<Order, "id" | "tenantId" | "items" | "version">>,
  ) {
    return this.write((s) => {
      const o = s.orders.get(id);
      if (!o || o.tenantId !== tenantId) return null;
      if (!expect.statuses.includes(o.status)) return null;
      if (expect.version !== undefined && o.version !== expect.version) return null;
      Object.assign(o, patch, { version: o.version + 1, updatedAt: now() });
      return o;
    });
  }
  updateOrderFields(tenantId: string, id: string, patch: Partial<Pick<Order, "paymentStatus" | "refundedMinor">>) {
    return this.write((s) => {
      const o = s.orders.get(id);
      if (!o || o.tenantId !== tenantId) return null;
      Object.assign(o, patch, { version: o.version + 1, updatedAt: now() });
      return o;
    });
  }
  addStatusHistory(h: New<OrderStatusHistory>) {
    return this.write((s) => {
      const row: OrderStatusHistory = { ...h, id: h.id ?? randomUUID() };
      s.history.push(row);
      return row;
    });
  }
  listStatusHistory(tenantId: string, orderId: string) {
    return this.read((s) => s.history.filter((h) => h.tenantId === tenantId && h.orderId === orderId));
  }

  createKitchenTicket(t: New<KitchenTicket>) {
    return this.write((s) => {
      if (s.tickets.has(t.orderId)) return null;
      const row: KitchenTicket = { ...t, id: t.id ?? randomUUID() };
      s.tickets.set(t.orderId, row);
      return row;
    });
  }
  getKitchenTicketByOrder(tenantId: string, orderId: string) {
    return this.read((s) => {
      const t = s.tickets.get(orderId);
      return t && t.tenantId === tenantId ? t : null;
    });
  }
  countKitchenTickets(tenantId: string, orderId: string) {
    return this.read((s) => {
      const t = s.tickets.get(orderId);
      return t && t.tenantId === tenantId ? 1 : 0;
    });
  }

  // ── payments ────────────────────────────────────────────────────────────

  getPaymentConnection(tenantId: string) {
    return this.read((s) => s.connections.get(tenantId) ?? null);
  }
  upsertPaymentConnection(c: New<PaymentConnection>) {
    return this.write((s) => {
      const existing = s.connections.get(c.tenantId);
      const row: PaymentConnection = { ...c, id: existing?.id ?? c.id ?? randomUUID() };
      s.connections.set(c.tenantId, row);
      return row;
    });
  }
  createPaymentAttempt(a: New<PaymentAttempt>) {
    return this.write((s) => {
      if ([...s.attempts.values()].some((x) => x.tenantId === a.tenantId && x.idempotencyKey === a.idempotencyKey))
        throw new UniqueViolationError("payment_attempts.tenant_idempotency_key");
      const row: PaymentAttempt = { ...a, id: a.id ?? randomUUID() };
      s.attempts.set(row.id, row);
      return row;
    });
  }
  getPaymentAttemptUnscoped(id: string) {
    return this.read((s) => s.attempts.get(id) ?? null);
  }
  getPaymentAttempt(tenantId: string, id: string) {
    return this.read((s) => {
      const a = s.attempts.get(id);
      return a && a.tenantId === tenantId ? a : null;
    });
  }
  findPaymentAttemptByIdempotencyKey(tenantId: string, key: string) {
    return this.read((s) => [...s.attempts.values()].find((a) => a.tenantId === tenantId && a.idempotencyKey === key) ?? null);
  }
  listPaymentAttempts(
    tenantId: string | null,
    f: { orderId?: string; statuses?: import("@/types/domain").PaymentStatus[]; olderThan?: string; limit: number },
  ) {
    return this.read((s) =>
      [...s.attempts.values()]
        .filter(
          (a) =>
            (tenantId === null || a.tenantId === tenantId) &&
            (!f.orderId || a.orderId === f.orderId) &&
            (!f.statuses || f.statuses.includes(a.status)) &&
            (!f.olderThan || a.createdAt < f.olderThan),
        )
        .sort(byCreatedDesc)
        .slice(0, f.limit),
    );
  }
  casPaymentAttempt(
    id: string,
    expectStatuses: readonly import("@/types/domain").PaymentStatus[],
    patch: Partial<Pick<PaymentAttempt, "status" | "providerPaymentId" | "failureReason" | "reviewFlag" | "lastEventAt" | "checkoutUrl">>,
  ) {
    return this.write((s) => {
      const a = s.attempts.get(id);
      if (!a || !expectStatuses.includes(a.status)) return null;
      Object.assign(a, patch, { updatedAt: now() });
      return a;
    });
  }

  insertWebhookEvent(e: New<PaymentWebhookEvent>) {
    return this.write((s) => {
      const key = `${e.provider}:${e.eventId}`;
      const existing = s.webhookEvents.get(key);
      if (existing) return { inserted: false, event: existing };
      const row: PaymentWebhookEvent = { ...e, id: e.id ?? randomUUID() };
      s.webhookEvents.set(key, row);
      return { inserted: true, event: row };
    });
  }
  updateWebhookEvent(id: string, patch: Partial<Pick<PaymentWebhookEvent, "outcome" | "error" | "processedAt" | "tenantId" | "attemptId">>) {
    return this.write((s) => {
      for (const ev of s.webhookEvents.values()) if (ev.id === id) Object.assign(ev, patch);
    });
  }
  listWebhookEvents(tenantId: string | null, limit: number) {
    return this.read((s) =>
      [...s.webhookEvents.values()]
        .filter((e) => tenantId === null || e.tenantId === tenantId)
        .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))
        .slice(0, limit),
    );
  }

  createRefund(r: New<Refund>) {
    return this.write((s) => {
      if ([...s.refunds.values()].some((x) => x.tenantId === r.tenantId && x.idempotencyKey === r.idempotencyKey))
        throw new UniqueViolationError("refunds.tenant_idempotency_key");
      const row: Refund = { ...r, id: r.id ?? randomUUID() };
      s.refunds.set(row.id, row);
      return row;
    });
  }
  findRefundByIdempotencyKey(tenantId: string, key: string) {
    return this.read((s) => [...s.refunds.values()].find((r) => r.tenantId === tenantId && r.idempotencyKey === key) ?? null);
  }
  listRefunds(tenantId: string, f: { orderId?: string; limit: number }) {
    return this.read((s) =>
      [...s.refunds.values()]
        .filter((r) => r.tenantId === tenantId && (!f.orderId || r.orderId === f.orderId))
        .sort(byCreatedDesc)
        .slice(0, f.limit),
    );
  }
  updateRefund(tenantId: string, id: string, patch: Partial<Pick<Refund, "status" | "providerRefundId" | "failureReason">>) {
    return this.write((s) => {
      const r = s.refunds.get(id);
      if (!r || r.tenantId !== tenantId) return null;
      Object.assign(r, patch, { updatedAt: now() });
      return r;
    });
  }

  // ── outbox ──────────────────────────────────────────────────────────────

  addOutboxEvent(e: New<OutboxEvent>) {
    return this.write((s) => {
      const row: OutboxEvent = { ...e, id: e.id ?? randomUUID() };
      s.outbox.push(row);
      if (s.outbox.length > 5000) s.outbox = s.outbox.filter((x) => !x.publishedAt).concat(s.outbox.filter((x) => x.publishedAt).slice(-2000));
      return row;
    });
  }
  listUnpublishedOutbox(limit: number) {
    return this.read((s) => s.outbox.filter((e) => !e.publishedAt && !e.deadAt).slice(0, limit));
  }
  markOutboxPublished(ids: string[], at: string) {
    return this.write((s) => {
      const set = new Set(ids);
      for (const e of s.outbox) if (set.has(e.id)) e.publishedAt = at;
    });
  }
  markOutboxFailed(id: string, error: string, dead: boolean) {
    return this.write((s) => {
      const e = s.outbox.find((x) => x.id === id);
      if (!e) return;
      e.attempts += 1;
      e.lastError = error;
      if (dead) e.deadAt = now();
    });
  }

  // ── delivery ────────────────────────────────────────────────────────────

  createDeliveryAssignment(a: New<DeliveryAssignment>) {
    return this.write((s) => {
      const active = [...s.assignments.values()].some((x) => x.orderId === a.orderId && (x.status === "ASSIGNED" || x.status === "PICKED_UP"));
      if (active) throw new UniqueViolationError("delivery_assignments.active_order");
      const row: DeliveryAssignment = { ...a, id: a.id ?? randomUUID() };
      s.assignments.set(row.id, row);
      return row;
    });
  }
  getDeliveryAssignment(tenantId: string, id: string) {
    return this.read((s) => {
      const a = s.assignments.get(id);
      return a && a.tenantId === tenantId ? a : null;
    });
  }
  getAssignmentForOrder(tenantId: string, orderId: string) {
    return this.read((s) => [...s.assignments.values()].filter((a) => a.tenantId === tenantId && a.orderId === orderId).sort(byCreatedDesc)[0] ?? null);
  }
  listAssignments(tenantId: string, f: { runnerUserId?: string; orderIds?: string[]; activeOnly?: boolean }) {
    return this.read((s) =>
      [...s.assignments.values()]
        .filter(
          (a) =>
            a.tenantId === tenantId &&
            (!f.runnerUserId || a.runnerUserId === f.runnerUserId) &&
            (!f.orderIds || f.orderIds.includes(a.orderId)) &&
            (!f.activeOnly || a.status === "ASSIGNED" || a.status === "PICKED_UP"),
        )
        .sort(byCreatedDesc),
    );
  }
  casDeliveryAssignment(
    tenantId: string,
    id: string,
    expectStatuses: readonly import("@/types/domain").DeliveryStatus[],
    patch: Partial<Pick<DeliveryAssignment, "status" | "note" | "runnerUserId">>,
  ) {
    return this.write((s) => {
      const a = s.assignments.get(id);
      if (!a || a.tenantId !== tenantId || !expectStatuses.includes(a.status)) return null;
      Object.assign(a, patch, { updatedAt: now() });
      return a;
    });
  }
  addDeliveryEvent(e: New<DeliveryEvent>) {
    return this.write((s) => {
      const row: DeliveryEvent = { ...e, id: e.id ?? randomUUID() };
      s.deliveryEvents.push(row);
      return row;
    });
  }
  listDeliveryEvents(tenantId: string, assignmentId: string) {
    return this.read((s) => s.deliveryEvents.filter((e) => e.tenantId === tenantId && e.assignmentId === assignmentId));
  }

  // ── audit / files ───────────────────────────────────────────────────────

  addAudit(a: New<AuditLog>) {
    return this.write((s) => {
      const row: AuditLog = { ...a, id: a.id ?? randomUUID() };
      s.audit.push(row);
      return row;
    });
  }
  listAudit(f: { tenantId: string | null; limit: number; offset: number }) {
    return this.read((s) => {
      const rows = s.audit.filter((a) => f.tenantId === null || a.tenantId === f.tenantId).sort(byCreatedDesc);
      return { items: rows.slice(f.offset, f.offset + f.limit), total: rows.length };
    });
  }

  createFile(f: New<StoredFile>) {
    return this.write((s) => {
      const row: StoredFile = { ...f, id: f.id ?? randomUUID() };
      s.files.set(row.key, row);
      return row;
    });
  }
  getFileByKey(key: string) {
    return this.read((s) => s.files.get(key) ?? null);
  }
}
