// Persistence contract. Every tenant-owned read/write takes tenantId so a
// missing scope is a compile error rather than a data leak (BR-01).
// Implementations: MemoryStore (demo data) and PrismaStore (PostgreSQL).

import type {
  AuditLog,
  Branch,
  DeliveryAssignment,
  DeliveryEvent,
  DeliveryStatus,
  FulfillmentType,
  Invitation,
  KitchenStation,
  KitchenTicket,
  MenuCategory,
  MenuItem,
  MenuItemVariant,
  ModifierGroup,
  ModifierOption,
  BranchMenuItem,
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

export class UniqueViolationError extends Error {
  constructor(readonly constraint: string) {
    super(`Unique constraint violated: ${constraint}`);
    this.name = "UniqueViolationError";
  }
}

export type New<T extends { id: string }> = Omit<T, "id"> & { id?: string };

export interface OrderFilter {
  branchIds?: string[];
  statuses?: OrderStatus[];
  fulfillmentType?: FulfillmentType;
  /** Matches order number, customer name/phone or table label. */
  q?: string;
  createdFrom?: string;
  createdTo?: string;
  offset: number;
  limit: number;
}

export interface MenuItemWrite {
  categoryId: string;
  name: string;
  description: string;
  basePriceMinor: number;
  imageUrl: string | null;
  dietary: MenuItem["dietary"];
  stationId: string | null;
  sortOrder: number;
  variants: Array<Omit<MenuItemVariant, "itemId" | "id"> & { id?: string }>;
  modifierGroupIds: string[];
}

export interface ModifierGroupWrite {
  name: string;
  minSelect: number;
  maxSelect: number;
  options: Array<Omit<ModifierOption, "groupId" | "id"> & { id?: string }>;
}

export interface DataStore {
  readonly kind: "memory" | "postgres";

  /** Run fn atomically. Nested calls join the outer transaction. */
  tx<T>(fn: (store: DataStore) => Promise<T>): Promise<T>;
  ping(): Promise<void>;

  // Identity
  getUserById(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  getUsersByIds(ids: string[]): Promise<User[]>;
  createUser(user: New<User>): Promise<User>;
  updateUser(id: string, patch: Partial<Pick<User, "name" | "passwordHash" | "status">>): Promise<User | null>;

  createSession(session: New<Session>): Promise<Session>;
  getSessionByTokenHash(tokenHash: string): Promise<Session | null>;
  touchSession(id: string, lastSeenAt: string, expiresAt: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteSessionsForUser(userId: string): Promise<void>;

  listMembershipsForUser(userId: string): Promise<TenantMembership[]>;
  listMemberships(tenantId: string): Promise<TenantMembership[]>;
  getMembership(tenantId: string, id: string): Promise<TenantMembership | null>;
  createMembership(m: New<TenantMembership>): Promise<TenantMembership>;
  updateMembership(tenantId: string, id: string, patch: Partial<Pick<TenantMembership, "role" | "status" | "branchIds">>): Promise<TenantMembership | null>;

  createInvitation(inv: New<Invitation>): Promise<Invitation>;
  getInvitationByTokenHash(tokenHash: string): Promise<Invitation | null>;
  listInvitations(tenantId: string): Promise<Invitation[]>;
  updateInvitation(tenantId: string, id: string, patch: Partial<Pick<Invitation, "acceptedAt" | "revokedAt">>): Promise<Invitation | null>;

  // Tenancy
  listTenants(): Promise<Tenant[]>;
  getTenant(id: string): Promise<Tenant | null>;
  getTenantBySlug(slug: string): Promise<Tenant | null>;
  createTenant(t: New<Tenant>): Promise<Tenant>;
  updateTenant(id: string, patch: Partial<Omit<Tenant, "id" | "createdAt" | "slug" | "currency">>): Promise<Tenant | null>;

  listBranches(tenantId: string): Promise<Branch[]>;
  getBranch(tenantId: string, id: string): Promise<Branch | null>;
  createBranch(b: New<Branch>): Promise<Branch>;
  updateBranch(tenantId: string, id: string, patch: Partial<Omit<Branch, "id" | "tenantId" | "createdAt" | "orderSeq">>): Promise<Branch | null>;
  /** Atomically increments and returns the branch order sequence. */
  nextOrderNumber(tenantId: string, branchId: string): Promise<number>;
  /** Seed/migration use only: position the order sequence (never moves backwards). */
  setOrderSequence(tenantId: string, branchId: string, value: number): Promise<void>;

  // Catalog
  listCategories(tenantId: string, opts?: { includeRetired?: boolean }): Promise<MenuCategory[]>;
  getCategory(tenantId: string, id: string): Promise<MenuCategory | null>;
  createCategory(c: New<MenuCategory>): Promise<MenuCategory>;
  updateCategory(tenantId: string, id: string, patch: Partial<Pick<MenuCategory, "name" | "sortOrder" | "retiredAt">>): Promise<MenuCategory | null>;

  listMenuItems(tenantId: string, opts?: { includeRetired?: boolean }): Promise<MenuItem[]>;
  getMenuItem(tenantId: string, id: string): Promise<MenuItem | null>;
  createMenuItem(tenantId: string, input: MenuItemWrite): Promise<MenuItem>;
  updateMenuItem(tenantId: string, id: string, input: MenuItemWrite): Promise<MenuItem | null>;
  setMenuItemRetired(tenantId: string, id: string, retiredAt: string | null): Promise<MenuItem | null>;

  listModifierGroups(tenantId: string, opts?: { includeRetired?: boolean }): Promise<ModifierGroup[]>;
  getModifierGroup(tenantId: string, id: string): Promise<ModifierGroup | null>;
  createModifierGroup(tenantId: string, input: ModifierGroupWrite): Promise<ModifierGroup>;
  updateModifierGroup(tenantId: string, id: string, input: ModifierGroupWrite): Promise<ModifierGroup | null>;
  setModifierGroupRetired(tenantId: string, id: string, retiredAt: string | null): Promise<ModifierGroup | null>;

  listBranchMenuItems(tenantId: string, branchId: string): Promise<BranchMenuItem[]>;
  upsertBranchMenuItem(row: BranchMenuItem): Promise<BranchMenuItem>;

  // Tables & stations
  listTables(tenantId: string, branchId?: string): Promise<RestaurantTable[]>;
  getTable(tenantId: string, id: string): Promise<RestaurantTable | null>;
  /** Unscoped by design: a QR ref is the entry point that establishes tenant context. */
  getTableByQrRef(qrRef: string): Promise<RestaurantTable | null>;
  createTable(t: New<RestaurantTable>): Promise<RestaurantTable>;
  updateTable(
    tenantId: string,
    id: string,
    patch: Partial<Pick<RestaurantTable, "label" | "area" | "seats" | "status" | "qrRef" | "qrRotatedAt">>,
  ): Promise<RestaurantTable | null>;
  listStations(tenantId: string, branchId?: string): Promise<KitchenStation[]>;
  createStation(s: New<KitchenStation>): Promise<KitchenStation>;

  // Orders
  createOrder(order: New<Order>): Promise<Order>;
  getOrder(tenantId: string, id: string): Promise<Order | null>;
  /** Unscoped lookup: only for customer order-token access and provider webhooks. */
  getOrderUnscoped(id: string): Promise<Order | null>;
  findOrderByIdempotencyKey(tenantId: string, key: string): Promise<Order | null>;
  listOrders(tenantId: string, filter: OrderFilter): Promise<{ items: Order[]; total: number }>;
  /**
   * Compare-and-set. Applies patch and increments version only when the
   * current status is in expect.statuses and (if given) version matches.
   * Returns null when nothing matched (→ 409 for callers).
   */
  casOrder(
    tenantId: string,
    id: string,
    expect: { statuses: readonly OrderStatus[]; version?: number },
    patch: Partial<Omit<Order, "id" | "tenantId" | "items" | "version">>,
  ): Promise<Order | null>;
  /** Non-status bookkeeping updates (refund totals, payment status). Still bumps version. */
  updateOrderFields(tenantId: string, id: string, patch: Partial<Pick<Order, "paymentStatus" | "refundedMinor">>): Promise<Order | null>;
  addStatusHistory(h: New<OrderStatusHistory>): Promise<OrderStatusHistory>;
  listStatusHistory(tenantId: string, orderId: string): Promise<OrderStatusHistory[]>;

  /** Returns null when a ticket already exists for the order (exactly-once). */
  createKitchenTicket(t: New<KitchenTicket>): Promise<KitchenTicket | null>;
  getKitchenTicketByOrder(tenantId: string, orderId: string): Promise<KitchenTicket | null>;
  countKitchenTickets(tenantId: string, orderId: string): Promise<number>;

  // Payments
  getPaymentConnection(tenantId: string): Promise<PaymentConnection | null>;
  upsertPaymentConnection(c: New<PaymentConnection>): Promise<PaymentConnection>;
  createPaymentAttempt(a: New<PaymentAttempt>): Promise<PaymentAttempt>;
  getPaymentAttemptUnscoped(id: string): Promise<PaymentAttempt | null>;
  getPaymentAttempt(tenantId: string, id: string): Promise<PaymentAttempt | null>;
  findPaymentAttemptByIdempotencyKey(tenantId: string, key: string): Promise<PaymentAttempt | null>;
  listPaymentAttempts(
    tenantId: string | null,
    filter: { orderId?: string; statuses?: PaymentStatus[]; olderThan?: string; limit: number },
  ): Promise<PaymentAttempt[]>;
  casPaymentAttempt(
    id: string,
    expectStatuses: readonly PaymentStatus[],
    patch: Partial<Pick<PaymentAttempt, "status" | "providerPaymentId" | "failureReason" | "reviewFlag" | "lastEventAt" | "checkoutUrl">>,
  ): Promise<PaymentAttempt | null>;

  /** Insert-if-absent keyed by (provider, eventId). */
  insertWebhookEvent(e: New<PaymentWebhookEvent>): Promise<{ inserted: boolean; event: PaymentWebhookEvent }>;
  updateWebhookEvent(id: string, patch: Partial<Pick<PaymentWebhookEvent, "outcome" | "error" | "processedAt" | "tenantId" | "attemptId">>): Promise<void>;
  listWebhookEvents(tenantId: string | null, limit: number): Promise<PaymentWebhookEvent[]>;

  createRefund(r: New<Refund>): Promise<Refund>;
  findRefundByIdempotencyKey(tenantId: string, key: string): Promise<Refund | null>;
  listRefunds(tenantId: string, filter: { orderId?: string; limit: number }): Promise<Refund[]>;
  updateRefund(tenantId: string, id: string, patch: Partial<Pick<Refund, "status" | "providerRefundId" | "failureReason">>): Promise<Refund | null>;

  // Outbox
  addOutboxEvent(e: New<OutboxEvent>): Promise<OutboxEvent>;
  listUnpublishedOutbox(limit: number): Promise<OutboxEvent[]>;
  markOutboxPublished(ids: string[], at: string): Promise<void>;
  markOutboxFailed(id: string, error: string, dead: boolean): Promise<void>;

  // Delivery
  createDeliveryAssignment(a: New<DeliveryAssignment>): Promise<DeliveryAssignment>;
  getDeliveryAssignment(tenantId: string, id: string): Promise<DeliveryAssignment | null>;
  getAssignmentForOrder(tenantId: string, orderId: string): Promise<DeliveryAssignment | null>;
  listAssignments(tenantId: string, filter: { runnerUserId?: string; orderIds?: string[]; activeOnly?: boolean }): Promise<DeliveryAssignment[]>;
  casDeliveryAssignment(
    tenantId: string,
    id: string,
    expectStatuses: readonly DeliveryStatus[],
    patch: Partial<Pick<DeliveryAssignment, "status" | "note" | "runnerUserId">>,
  ): Promise<DeliveryAssignment | null>;
  addDeliveryEvent(e: New<DeliveryEvent>): Promise<DeliveryEvent>;
  listDeliveryEvents(tenantId: string, assignmentId: string): Promise<DeliveryEvent[]>;

  // Audit
  addAudit(a: New<AuditLog>): Promise<AuditLog>;
  /** tenantId === null lists platform-wide entries (platform admin only). */
  listAudit(filter: { tenantId: string | null; limit: number; offset: number }): Promise<{ items: AuditLog[]; total: number }>;

  // Files
  createFile(f: New<StoredFile>): Promise<StoredFile>;
  getFileByKey(key: string): Promise<StoredFile | null>;
}
