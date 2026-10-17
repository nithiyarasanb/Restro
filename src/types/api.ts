// API response shapes (the contract between /api/v1 and every client).
// Internal fields (token hashes, request fingerprints, idempotency keys) are
// never part of these views.

import type {
  AuditLog,
  Branch,
  DeliveryAssignment,
  DeliveryEvent,
  Dietary,
  FulfillmentType,
  Invitation,
  KitchenStation,
  MenuCategory,
  MenuItem,
  ModifierGroup,
  Order,
  OrderStatus,
  OrderStatusHistory,
  PaymentAttempt,
  PaymentConnection,
  PaymentStatus,
  PaymentWebhookEvent,
  Refund,
  RestaurantTable,
  Role,
  StaffRole,
  Tenant,
} from "./domain";

export interface ApiErrorBody {
  code: string;
  message: string;
  requestId: string;
  details?: unknown;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Public / customer ────────────────────────────────────────────────────

export interface PublicBranch {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  acceptingOrders: boolean;
  isOpenNow: boolean;
  isLive: boolean;
  takeawayEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryFeeMinor: number;
  taxRateBps: number;
  serviceChargeBps: number;
  openingHours: Branch["openingHours"];
}

export interface PublicRestaurant {
  slug: string;
  name: string;
  currency: string;
  isDemo: boolean;
  branches: PublicBranch[];
}

export interface PublicMenuItem {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  priceMinor: number;
  imageUrl: string | null;
  dietary: Dietary | null;
  available: boolean;
  variants: Array<{ id: string; name: string; priceDeltaMinor: number; isDefault: boolean }>;
  modifierGroupIds: string[];
}

export interface PublicModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: Array<{ id: string; name: string; priceDeltaMinor: number; isAvailable: boolean }>;
}

export interface PublicMenu {
  restaurant: { slug: string; name: string; currency: string };
  branch: PublicBranch;
  table: { label: string; qrRef: string } | null;
  categories: Array<{ id: string; name: string }>;
  items: PublicMenuItem[];
  modifierGroups: Record<string, PublicModifierGroup>;
}

export interface QuoteLineView {
  menuItemId: string;
  name: string;
  variantId: string | null;
  variantName: string | null;
  modifiers: Array<{ optionId: string; groupName: string; optionName: string; priceDeltaMinor: number }>;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
  notes: string | null;
}

export interface QuoteView {
  currency: string;
  fulfillmentType: FulfillmentType;
  lines: QuoteLineView[];
  subtotalMinor: number;
  discountMinor: number;
  serviceChargeMinor: number;
  taxMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
  taxRateBps: number;
  serviceChargeBps: number;
}

export interface PlacedOrderView {
  orderId: string;
  number: number;
  accessToken: string;
  trackingUrl: string;
  totalMinor: number;
  currency: string;
  status: OrderStatus;
}

export interface CustomerOrderView {
  id: string;
  number: number;
  restaurantName: string;
  branchName: string;
  tableLabel: string | null;
  fulfillmentType: FulfillmentType;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  currency: string;
  subtotalMinor: number;
  serviceChargeMinor: number;
  taxMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
  refundedMinor: number;
  items: QuoteLineView[];
  createdAt: string;
  confirmedAt: string | null;
  acceptedAt: string | null;
  readyAt: string | null;
  handedOverAt: string | null;
  completedAt: string | null;
  cancelReason: string | null;
  version: number;
  latestPayment: { status: PaymentStatus; failureReason: string | null } | null;
  canPay: boolean;
  isDemo: boolean;
}

export interface PaymentIntentView {
  attemptId: string;
  checkoutUrl: string;
  status: PaymentStatus;
  provider: string;
}

// ─── Staff ────────────────────────────────────────────────────────────────

export type StaffOrderView = Omit<Order, "accessTokenHash" | "requestHash" | "idempotencyKey"> & { branchName: string };

export interface KitchenTicketView {
  orderId: string;
  number: number;
  version: number;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  tableLabel: string | null;
  customerName: string | null;
  confirmedAt: string;
  acceptedAt: string | null;
  readyAt: string | null;
  notes: string | null;
  items: Array<{ name: string; variantName: string | null; quantity: number; modifiers: string[]; notes: string | null; stationId: string | null }>;
}

export interface KitchenQueueView {
  branch: { id: string; name: string };
  stations: KitchenStation[];
  tickets: KitchenTicketView[];
  serverTime: string;
}

export interface OrderDetailView {
  order: StaffOrderView;
  history: OrderStatusHistory[];
  payments: Array<Omit<PaymentAttempt, "idempotencyKey">>;
  refunds: Refund[];
  delivery: (DeliveryAssignment & { runnerName: string; events: DeliveryEvent[] }) | null;
  runners: Array<{ userId: string; name: string }>;
  refundableMinor: number;
}

export interface SessionView {
  user: { id: string; email: string; name: string };
  kind: "platform" | "staff";
  role: Role;
  tenant: { id: string; name: string; slug: string; currency: string; features: Tenant["features"] } | null;
  branchScope: "ALL" | string[];
  otherTenants: Array<{ id: string; name: string; role: StaffRole }>;
  permissions: string[];
  home: string;
  isDemo: boolean;
}

export interface AdminMenuView {
  categories: MenuCategory[];
  items: MenuItem[];
  modifierGroups: ModifierGroup[];
  stations: KitchenStation[];
  branches: Array<{ id: string; name: string }>;
  branchItems: Record<string, Record<string, { isAvailable: boolean; priceOverrideMinor: number | null }>>;
  /** Signed display URLs for item images, keyed by item id. */
  imageUrls: Record<string, string>;
}

export interface TableView extends RestaurantTable {
  branchName: string;
  orderUrl: string;
}

export interface StaffMemberView {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: StaffRole;
  status: "ACTIVE" | "DISABLED";
  branchIds: string[];
  createdAt: string;
}

export type InvitationView = Omit<Invitation, "tokenHash"> & { status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED" };

export interface PaymentsOverviewView {
  connection: PaymentConnection | null;
  attempts: Array<Omit<PaymentAttempt, "idempotencyKey"> & { orderNumber: number | null }>;
  refunds: Array<Refund & { orderNumber: number | null }>;
  webhookEvents: PaymentWebhookEvent[];
  reconciliation: { pendingAttempts: number; flaggedAttempts: number; failedRefunds: number; staleUnpaidOrders: number };
}

export interface CurrencyAmounts {
  currency: string;
  orders: number;
  grossOrderValueMinor: number;
  discountsMinor: number;
  serviceChargeMinor: number;
  taxMinor: number;
  deliveryFeesMinor: number;
  refundsMinor: number;
  netCollectedMinor: number;
  averageOrderValueMinor: number;
}

export interface SalesReportView {
  from: string;
  to: string;
  branchId: string | null;
  byCurrency: CurrencyAmounts[];
  byDay: Array<{ date: string; currency: string; orders: number; grossOrderValueMinor: number }>;
  byHour: Array<{ hour: number; orders: number }>;
  statusCounts: Partial<Record<OrderStatus, number>>;
  fulfillmentCounts: Partial<Record<FulfillmentType, number>>;
  topItems: Array<{ name: string; quantity: number; revenueMinor: number; currency: string }>;
  payments: { attempts: number; captured: number; failed: number; pending: number; successRate: number | null };
  prepTimes: { averageAcceptSeconds: number | null; averagePrepSeconds: number | null; averageHandoverSeconds: number | null; sampleSize: number };
  outOfStockItems: number;
  delivery: { assigned: number; delivered: number; failed: number } | null;
}

export interface OverviewView {
  date: string;
  currency: string;
  orders: number;
  ordersChangePct: number | null;
  grossOrderValueMinor: number;
  grossChangePct: number | null;
  averagePrepSeconds: number | null;
  prepChangeSeconds: number | null;
  refundsMinor: number;
  refundCount: number;
  byHour: Array<{ hour: number; orders: number }>;
  live: Array<{ id: string; number: number; label: string; status: OrderStatus; branchName: string }>;
  attention: { pendingPayments: number; failedRefunds: number; flaggedPayments: number };
}

export interface TenantSummaryView extends Tenant {
  branchCount: number;
  liveBranchCount: number;
  staffCount: number;
  ordersLast30Days: number;
  paymentConnectionStatus: PaymentConnection["status"] | "NONE";
}

export interface TenantDetailView {
  tenant: Tenant;
  branches: Branch[];
  staff: StaffMemberView[];
  invitations: InvitationView[];
  paymentConnection: PaymentConnection | null;
  recentAudit: AuditLog[];
}

export interface RunnerJobView {
  assignmentId: string;
  status: DeliveryAssignment["status"];
  note: string | null;
  orderId: string;
  orderNumber: number;
  orderStatus: OrderStatus;
  orderVersion: number;
  branchName: string;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  items: Array<{ name: string; quantity: number }>;
  totalMinor: number;
  currency: string;
  paid: boolean;
  assignedAt: string;
}
