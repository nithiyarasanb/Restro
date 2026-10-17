// Domain types shared by server and client. Persistence-agnostic: both the
// memory store and the Prisma store map to these shapes.

export type ISODate = string;

export const STAFF_ROLES = ["OWNER", "BRANCH_MANAGER", "CASHIER", "KITCHEN", "RUNNER"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export type Role = StaffRole | "PLATFORM_ADMIN";

export type TenantStatus = "ONBOARDING" | "ACTIVE" | "SUSPENDED";

export interface TenantFeatures {
  delivery: boolean;
  maxBranches: number;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  status: TenantStatus;
  country: string; // ISO 3166-1 alpha-2
  currency: string; // ISO 4217
  timezone: string;
  features: TenantFeatures;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface OpeningHoursEntry {
  day: number; // 0 = Sunday … 6 = Saturday
  open: string; // "HH:MM"
  close: string; // "HH:MM"; may be < open for past-midnight
}

export interface Branch {
  id: string;
  tenantId: string;
  name: string;
  address: string;
  phone: string | null;
  timezone: string;
  taxRateBps: number; // 500 = 5.00 %
  serviceChargeBps: number;
  takeawayEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryFeeMinor: number;
  isLive: boolean;
  acceptingOrders: boolean;
  openingHours: OpeningHoursEntry[];
  orderSeq: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type UserStatus = "ACTIVE" | "DISABLED";

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  isPlatformAdmin: boolean;
  status: UserStatus;
  createdAt: ISODate;
}

export type PublicUser = Omit<User, "passwordHash">;

export interface TenantMembership {
  id: string;
  tenantId: string;
  userId: string;
  role: StaffRole;
  status: "ACTIVE" | "DISABLED";
  /** Branch scope. Empty for OWNER (all branches). */
  branchIds: string[];
  createdAt: ISODate;
}

export interface Invitation {
  id: string;
  tenantId: string;
  email: string;
  role: StaffRole;
  branchIds: string[];
  tokenHash: string;
  expiresAt: ISODate;
  acceptedAt: ISODate | null;
  revokedAt: ISODate | null;
  invitedByUserId: string | null;
  createdAt: ISODate;
}

export interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: ISODate;
  lastSeenAt: ISODate;
  createdAt: ISODate;
}

export interface AuditLog {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string | null;
  meta: Record<string, unknown>;
  requestId: string | null;
  createdAt: ISODate;
}

// ─── Catalog ──────────────────────────────────────────────────────────────

export type Dietary = "VEG" | "NON_VEG" | "VEGAN" | "EGG";

export interface MenuCategory {
  id: string;
  tenantId: string;
  name: string;
  sortOrder: number;
  retiredAt: ISODate | null;
}

export interface MenuItemVariant {
  id: string;
  itemId: string;
  name: string;
  priceDeltaMinor: number;
  isDefault: boolean;
  sortOrder: number;
}

export interface MenuItem {
  id: string;
  tenantId: string;
  categoryId: string;
  name: string;
  description: string;
  basePriceMinor: number;
  imageUrl: string | null;
  dietary: Dietary | null;
  stationId: string | null;
  sortOrder: number;
  retiredAt: ISODate | null;
  variants: MenuItemVariant[];
  modifierGroupIds: string[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface ModifierOption {
  id: string;
  groupId: string;
  name: string;
  priceDeltaMinor: number;
  isAvailable: boolean;
  sortOrder: number;
}

export interface ModifierGroup {
  id: string;
  tenantId: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: ModifierOption[];
  retiredAt: ISODate | null;
}

export interface BranchMenuItem {
  tenantId: string;
  branchId: string;
  itemId: string;
  priceOverrideMinor: number | null;
  isAvailable: boolean;
}

// ─── Tables / stations ────────────────────────────────────────────────────

export interface RestaurantTable {
  id: string;
  tenantId: string;
  branchId: string;
  label: string;
  area: string | null;
  seats: number;
  qrRef: string;
  status: "ACTIVE" | "DISABLED";
  qrRotatedAt: ISODate;
  createdAt: ISODate;
}

export interface KitchenStation {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
}

// ─── Orders ───────────────────────────────────────────────────────────────

export const ORDER_STATUSES = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "SERVED",
  "PICKED_UP",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
  "DELIVERY_FAILED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ["CREATED", "PENDING", "AUTHORIZED", "CAPTURED", "FAILED", "CANCELLED", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const FULFILLMENT_TYPES = ["DINE_IN", "TAKEAWAY", "DELIVERY"] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];

export interface OrderItemModifier {
  id: string;
  optionId: string;
  groupName: string;
  optionName: string;
  priceDeltaMinor: number;
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  nameSnapshot: string;
  variantId: string | null;
  variantName: string | null;
  unitPriceMinor: number; // base (+override) + variant + modifiers
  quantity: number;
  lineTotalMinor: number;
  notes: string | null;
  stationId: string | null;
  modifiers: OrderItemModifier[];
}

export interface Order {
  id: string;
  tenantId: string;
  branchId: string;
  number: number;
  tableId: string | null;
  tableLabel: string | null;
  fulfillmentType: FulfillmentType;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  serviceChargeMinor: number;
  taxMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
  refundedMinor: number;
  taxRateBps: number;
  serviceChargeBps: number;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  notes: string | null;
  idempotencyKey: string;
  requestHash: string;
  accessTokenHash: string;
  version: number;
  cancelReason: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  confirmedAt: ISODate | null;
  acceptedAt: ISODate | null;
  readyAt: ISODate | null;
  handedOverAt: ISODate | null;
  completedAt: ISODate | null;
  items: OrderItem[];
}

export type ActorKind = "STAFF" | "SYSTEM" | "CUSTOMER";

export interface OrderStatusHistory {
  id: string;
  tenantId: string;
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorKind: ActorKind;
  actorUserId: string | null;
  actorLabel: string;
  reason: string | null;
  createdAt: ISODate;
}

export interface KitchenTicket {
  id: string;
  tenantId: string;
  branchId: string;
  orderId: string;
  stationId: string | null;
  createdAt: ISODate;
}

// ─── Payments ─────────────────────────────────────────────────────────────

export type PaymentProviderKey = "mock";

export interface PaymentConnection {
  id: string;
  tenantId: string;
  provider: PaymentProviderKey;
  status: "PENDING" | "ACTIVE" | "DISABLED";
  merchantAccountId: string;
  displayName: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface PaymentAttempt {
  id: string;
  tenantId: string;
  orderId: string;
  provider: PaymentProviderKey;
  providerAccountId: string;
  providerPaymentId: string | null;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  idempotencyKey: string;
  checkoutUrl: string | null;
  failureReason: string | null;
  reviewFlag: string | null;
  lastEventAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type WebhookOutcome = "RECEIVED" | "PROCESSED" | "DUPLICATE" | "REJECTED" | "IGNORED_STALE";

export interface PaymentWebhookEvent {
  id: string;
  provider: PaymentProviderKey;
  eventId: string;
  type: string;
  tenantId: string | null;
  attemptId: string | null;
  outcome: WebhookOutcome;
  error: string | null;
  receivedAt: ISODate;
  processedAt: ISODate | null;
}

export type RefundStatus = "PENDING" | "SUCCEEDED" | "FAILED";

export interface Refund {
  id: string;
  tenantId: string;
  orderId: string;
  attemptId: string;
  amountMinor: number;
  currency: string;
  status: RefundStatus;
  reason: string;
  idempotencyKey: string;
  providerRefundId: string | null;
  failureReason: string | null;
  requestedByUserId: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ─── Messaging / delivery / files ─────────────────────────────────────────

export type RealtimeEventType = "order.created" | "order.updated" | "payment.updated" | "delivery.updated";

export interface OutboxEvent {
  id: string;
  tenantId: string;
  branchId: string | null;
  orderId: string | null;
  type: RealtimeEventType;
  payload: Record<string, unknown>;
  createdAt: ISODate;
  publishedAt: ISODate | null;
  attempts: number;
  lastError: string | null;
  deadAt: ISODate | null;
}

export type DeliveryStatus = "ASSIGNED" | "PICKED_UP" | "DELIVERED" | "FAILED";

export interface DeliveryAssignment {
  id: string;
  tenantId: string;
  branchId: string;
  orderId: string;
  runnerUserId: string;
  status: DeliveryStatus;
  assignedByUserId: string;
  note: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface DeliveryEvent {
  id: string;
  tenantId: string;
  assignmentId: string;
  type: DeliveryStatus;
  note: string | null;
  actorUserId: string;
  createdAt: ISODate;
}

export interface StoredFile {
  id: string;
  tenantId: string;
  key: string;
  contentType: string;
  sizeBytes: number;
  createdAt: ISODate;
}
