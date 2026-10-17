// DEMO seed (clearly labelled sample data). Written against the DataStore
// interface so the same data seeds the memory store and PostgreSQL.
// Prices follow the BRD mockups (₹, 5 % tax). All accounts use DEMO_PASSWORD.

import { randomUUID } from "node:crypto";
import type { Branch, FulfillmentType, MenuItem, ModifierGroup, Order, OrderStatus, OrderStatusHistory, Tenant } from "@/types/domain";
import type { DataStore, MenuItemWrite } from "./types";
import { priceOrder, type PricingMenu } from "@/server/services/pricing";
import { hashPassword, sha256 } from "@/server/crypto";

export { DEMO, DEMO_PASSWORD, did } from "./demo-constants";
import { DEMO, DEMO_PASSWORD } from "./demo-constants";

// Small deterministic PRNG so the generated history is the same every run.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (d: Date) => d.toISOString();
const addMs = (iso0: string, ms: number) => new Date(new Date(iso0).getTime() + ms).toISOString();
const MIN = 60_000;

interface SeedMenu {
  items: MenuItem[];
  groups: ModifierGroup[];
  pricing: PricingMenu;
}

async function seedMenu(
  store: DataStore,
  tenantId: string,
  categories: Array<{ name: string; items: Array<Omit<MenuItemWrite, "categoryId" | "sortOrder" | "imageUrl"> & { imageUrl?: string | null }> }>,
): Promise<{ items: MenuItem[] }> {
  const items: MenuItem[] = [];
  for (const [ci, cat] of categories.entries()) {
    const category = await store.createCategory({ tenantId, name: cat.name, sortOrder: ci * 10, retiredAt: null });
    for (const [ii, item] of cat.items.entries()) {
      items.push(
        await store.createMenuItem(tenantId, {
          ...item,
          imageUrl: item.imageUrl ?? null,
          categoryId: category.id,
          sortOrder: ii * 10,
        }),
      );
    }
  }
  return { items };
}

function pricingMenu(items: MenuItem[], groups: ModifierGroup[]): PricingMenu {
  return {
    items: new Map(items.map((i) => [i.id, i])),
    groups: new Map(groups.map((g) => [g.id, g])),
    branchItems: new Map(),
  };
}

interface OrderSpec {
  id?: string;
  tenant: Tenant;
  branch: Branch;
  menu: SeedMenu;
  lines: Array<{ item: string; qty: number; variant?: string; modifiers?: string[]; notes?: string }>;
  fulfillmentType: FulfillmentType;
  table?: { id: string; label: string };
  customer?: { name: string; phone: string; address?: string };
  status: OrderStatus;
  createdAt: string;
  timings?: { acceptAfter: number; prepMinutes: number; handoverAfter: number };
  accessToken?: string;
  cancelReason?: string;
}

async function createSeedOrder(store: DataStore, spec: OrderSpec, actorIds: { kitchen: string; cashier: string }) {
  const { menu, branch, tenant } = spec;
  const byName = new Map(menu.items.map((i) => [i.name, i]));
  const optionByName = new Map(menu.groups.flatMap((g) => g.options.map((o) => [o.name, o] as const)));
  const quote = priceOrder({
    menu: menu.pricing,
    branch,
    currency: tenant.currency,
    fulfillmentType: spec.fulfillmentType,
    lines: spec.lines.map((l) => {
      const item = byName.get(l.item);
      if (!item) throw new Error(`Seed: unknown item ${l.item}`);
      return {
        menuItemId: item.id,
        variantId: l.variant ? item.variants.find((v) => v.name === l.variant)!.id : null,
        modifierOptionIds: l.modifiers
          ? l.modifiers.map((m) => optionByName.get(m)!.id)
          : // Fill required groups (e.g. spice level) with their first available option.
            item.modifierGroupIds.flatMap((gid) => {
              const g = menu.groups.find((x) => x.id === gid);
              return g && g.minSelect > 0
                ? g.options
                    .filter((o) => o.isAvailable)
                    .slice(0, g.minSelect)
                    .map((o) => o.id)
                : [];
            }),
        quantity: l.qty,
        notes: l.notes ?? null,
      };
    }),
  });

  const paid = !["PENDING_PAYMENT"].includes(spec.status) && !(spec.status === "CANCELLED" && spec.cancelReason?.startsWith("Payment"));
  const t = spec.timings ?? { acceptAfter: 1, prepMinutes: 12, handoverAfter: 2 };
  const confirmedAt = paid ? addMs(spec.createdAt, 40_000) : null;
  const reached = (s: OrderStatus) => {
    const order: OrderStatus[] = ["CONFIRMED", "ACCEPTED", "PREPARING", "READY", "SERVED", "COMPLETED"];
    const target = ["PICKED_UP", "DELIVERED"].includes(spec.status) ? "SERVED" : ["OUT_FOR_DELIVERY"].includes(spec.status) ? "READY" : spec.status;
    return order.indexOf(target as OrderStatus) >= order.indexOf(s) && order.indexOf(target as OrderStatus) !== -1;
  };
  const acceptedAt = confirmedAt && reached("ACCEPTED") ? addMs(confirmedAt, t.acceptAfter * MIN) : null;
  const readyAt = acceptedAt && reached("READY") ? addMs(acceptedAt, t.prepMinutes * MIN) : null;
  const handedOverAt = readyAt && reached("SERVED") ? addMs(readyAt, t.handoverAfter * MIN) : null;
  const number = await store.nextOrderNumber(tenant.id, branch.id);
  const refunded = spec.status === "REJECTED" || spec.status === "DELIVERY_FAILED";

  const order = await store.createOrder({
    id: spec.id ?? randomUUID(),
    tenantId: tenant.id,
    branchId: branch.id,
    number,
    tableId: spec.table?.id ?? null,
    tableLabel: spec.table?.label ?? null,
    fulfillmentType: spec.fulfillmentType,
    status: spec.status,
    paymentStatus: paid ? (refunded ? "REFUNDED" : "CAPTURED") : spec.status === "CANCELLED" ? "FAILED" : "PENDING",
    currency: tenant.currency,
    subtotalMinor: quote.subtotalMinor,
    discountMinor: quote.discountMinor,
    serviceChargeMinor: quote.serviceChargeMinor,
    taxMinor: quote.taxMinor,
    deliveryFeeMinor: quote.deliveryFeeMinor,
    totalMinor: quote.totalMinor,
    refundedMinor: refunded ? quote.totalMinor : 0,
    taxRateBps: quote.taxRateBps,
    serviceChargeBps: quote.serviceChargeBps,
    customerName: spec.customer?.name ?? null,
    customerPhone: spec.customer?.phone ?? null,
    deliveryAddress: spec.customer?.address ?? null,
    notes: null,
    idempotencyKey: `seed-${randomUUID()}`,
    requestHash: "seed",
    accessTokenHash: sha256(spec.accessToken ?? randomUUID()),
    version: 1,
    cancelReason: spec.cancelReason ?? null,
    createdAt: spec.createdAt,
    updatedAt: handedOverAt ?? readyAt ?? acceptedAt ?? confirmedAt ?? spec.createdAt,
    confirmedAt,
    acceptedAt,
    readyAt,
    handedOverAt,
    completedAt: spec.status === "COMPLETED" ? handedOverAt : null,
    items: quote.lines.map((l) => ({
      ...l,
      id: randomUUID(),
      modifiers: l.modifiers.map((m) => ({ ...m, id: randomUUID() })),
      available: undefined,
    })) as Order["items"],
  });

  // Status history, payment attempt, kitchen ticket — as the real flow would leave them.
  const hist = (
    from: OrderStatus | null,
    to: OrderStatus,
    at: string,
    kind: OrderStatusHistory["actorKind"],
    userId: string | null,
    label: string,
    reason: string | null = null,
  ) =>
    store.addStatusHistory({
      tenantId: tenant.id,
      orderId: order.id,
      fromStatus: from,
      toStatus: to,
      actorKind: kind,
      actorUserId: userId,
      actorLabel: label,
      reason,
      createdAt: at,
    });
  await hist(null, "PENDING_PAYMENT", spec.createdAt, "CUSTOMER", null, "Customer");
  await store.createPaymentAttempt({
    tenantId: tenant.id,
    orderId: order.id,
    provider: "mock",
    providerAccountId: `acct_demo_${tenant.slug}`,
    providerPaymentId: paid ? `mock_pay_${order.number}_${tenant.slug}` : null,
    amountMinor: order.totalMinor,
    currency: order.currency,
    status: paid ? "CAPTURED" : spec.status === "CANCELLED" ? "FAILED" : "PENDING",
    idempotencyKey: `seed-pay-${order.id}`,
    checkoutUrl: null,
    failureReason: paid ? null : spec.status === "CANCELLED" ? "Card declined (demo)" : null,
    reviewFlag: null,
    lastEventAt: confirmedAt,
    createdAt: addMs(spec.createdAt, 5_000),
    updatedAt: confirmedAt ?? spec.createdAt,
  });
  if (!confirmedAt) {
    if (spec.status === "CANCELLED")
      await hist("PENDING_PAYMENT", "CANCELLED", addMs(spec.createdAt, 30 * MIN), "SYSTEM", null, "System", spec.cancelReason ?? null);
    return order;
  }
  await hist("PENDING_PAYMENT", "CONFIRMED", confirmedAt, "SYSTEM", null, "Payment verified");
  await store.createKitchenTicket({ tenantId: tenant.id, branchId: branch.id, orderId: order.id, stationId: null, createdAt: confirmedAt });
  if (spec.status === "REJECTED") {
    await hist("CONFIRMED", "REJECTED", addMs(confirmedAt, MIN), "STAFF", actorIds.kitchen, "Kitchen", "OUT_OF_STOCK");
    const attempt = (await store.listPaymentAttempts(tenant.id, { orderId: order.id, limit: 1 }))[0];
    await store.createRefund({
      tenantId: tenant.id,
      orderId: order.id,
      attemptId: attempt.id,
      amountMinor: order.totalMinor,
      currency: order.currency,
      status: "SUCCEEDED",
      reason: "Order rejected by kitchen: OUT_OF_STOCK",
      idempotencyKey: `reject:${order.id}`,
      providerRefundId: `mock_rf_${order.number}`,
      failureReason: null,
      requestedByUserId: actorIds.kitchen,
      createdAt: addMs(confirmedAt, MIN),
      updatedAt: addMs(confirmedAt, MIN + 2000),
    });
    return order;
  }
  if (acceptedAt) await hist("CONFIRMED", "ACCEPTED", acceptedAt, "STAFF", actorIds.kitchen, "Kitchen");
  if (acceptedAt && spec.status !== "ACCEPTED") await hist("ACCEPTED", "PREPARING", addMs(acceptedAt, 20_000), "STAFF", actorIds.kitchen, "Kitchen");
  if (readyAt) await hist("PREPARING", "READY", readyAt, "STAFF", actorIds.kitchen, "Kitchen");
  if (handedOverAt) {
    const to: OrderStatus = spec.fulfillmentType === "DINE_IN" ? "SERVED" : spec.fulfillmentType === "TAKEAWAY" ? "PICKED_UP" : "DELIVERED";
    await hist("READY", to, handedOverAt, "STAFF", actorIds.cashier, "Front of house");
    if (spec.status === "COMPLETED") await hist(to, "COMPLETED", handedOverAt, "SYSTEM", null, "System");
  }
  return order;
}

export async function seedDemoData(store: DataStore, opts: { now?: Date; historyDays?: number } = {}) {
  const nowDate = opts.now ?? new Date();
  const now = iso(nowDate);
  const historyDays = opts.historyDays ?? 14;
  const passwordHash = await hashPassword(DEMO_PASSWORD, 10);

  // ── Users ───────────────────────────────────────────────────────────────
  const mkUser = (email: string, name: string, isPlatformAdmin = false) =>
    store.createUser({ email, name, passwordHash, isPlatformAdmin, status: "ACTIVE", createdAt: now });
  const platform = await mkUser(DEMO.users.platform, "Priya Platform (DEMO)", true);
  const owner = await mkUser(DEMO.users.owner, "Arjun Owner (DEMO)");
  const manager = await mkUser(DEMO.users.manager, "Meera Manager (DEMO)");
  const cashier = await mkUser(DEMO.users.cashier, "Kiran Cashier (DEMO)");
  const kitchen = await mkUser(DEMO.users.kitchen, "Ravi Kitchen (DEMO)");
  const runner = await mkUser(DEMO.users.runner, "Sam Runner (DEMO)");
  const harbourOwner = await mkUser(DEMO.users.harbourOwner, "Lin Owner (DEMO)");

  // ── Tenants & branches ──────────────────────────────────────────────────
  const tenant = await store.createTenant({
    id: DEMO.tenantId,
    slug: "spice-route",
    name: "Spice Route Kitchen",
    legalName: "Spice Route Hospitality Pvt Ltd (DEMO)",
    status: "ACTIVE",
    country: "IN",
    currency: "INR",
    timezone: "Asia/Kolkata",
    features: { delivery: true, maxBranches: 5 },
    createdAt: addMs(now, -60 * 24 * 60 * MIN),
    updatedAt: now,
  });
  const allWeek = (open: string, close: string) => ([0, 1, 2, 3, 4, 5, 6] as const).map((day) => ({ day, open, close }));
  const branchBase = {
    tenantId: tenant.id,
    timezone: "Asia/Kolkata",
    taxRateBps: 500,
    serviceChargeBps: 0,
    takeawayEnabled: true,
    isLive: true,
    acceptingOrders: true,
    openingHours: allWeek("11:00", "23:00"),
    createdAt: tenant.createdAt,
    updatedAt: now,
  };
  const main = await store.createBranch({
    ...branchBase,
    id: DEMO.mainBranchId,
    name: "Main Street",
    address: "12 Main Street, Indiranagar, Bengaluru 560038 (DEMO)",
    // Open around the clock so the demo works at any hour; Lake View keeps realistic hours.
    openingHours: allWeek("00:00", "23:59"),
    phone: "+91 80 4000 1000",
    deliveryEnabled: true,
    deliveryFeeMinor: 4000,
    orderSeq: 0,
  });
  const lake = await store.createBranch({
    ...branchBase,
    id: DEMO.lakeBranchId,
    name: "Lake View",
    address: "4 Lake Road, Ulsoor, Bengaluru 560008 (DEMO)",
    phone: "+91 80 4000 2000",
    deliveryEnabled: false,
    deliveryFeeMinor: 0,
    serviceChargeBps: 500,
    createdAt: addMs(tenant.createdAt, MIN),
    orderSeq: 1999,
  });

  const harbour = await store.createTenant({
    id: DEMO.tenant2Id,
    slug: "harbour-noodles",
    name: "Harbour Noodle Bar",
    legalName: "Harbour Noodle Bar Pte Ltd (DEMO)",
    status: "ACTIVE",
    country: "SG",
    currency: "SGD",
    timezone: "Asia/Singapore",
    features: { delivery: false, maxBranches: 2 },
    createdAt: addMs(now, -30 * 24 * 60 * MIN),
    updatedAt: now,
  });
  const harbourBranch = await store.createBranch({
    ...branchBase,
    id: DEMO.harbourBranchId,
    tenantId: harbour.id,
    name: "Telok Ayer",
    address: "88 Telok Ayer Street, Singapore 048470 (DEMO)",
    phone: "+65 6000 0000",
    timezone: "Asia/Singapore",
    taxRateBps: 900,
    serviceChargeBps: 1000,
    deliveryEnabled: false,
    deliveryFeeMinor: 0,
    openingHours: allWeek("10:30", "22:00"),
    createdAt: harbour.createdAt,
    orderSeq: 0,
  });

  const green = await store.createTenant({
    id: DEMO.tenant3Id,
    slug: "green-bowl",
    name: "Green Bowl Café",
    legalName: null,
    status: "ONBOARDING",
    country: "IN",
    currency: "INR",
    timezone: "Asia/Kolkata",
    features: { delivery: false, maxBranches: 1 },
    createdAt: addMs(now, -2 * 24 * 60 * MIN),
    updatedAt: now,
  });
  await store.createBranch({
    ...branchBase,
    id: DEMO.greenBranchId,
    tenantId: green.id,
    name: "Koramangala",
    address: "5th Block, Koramangala, Bengaluru (DEMO)",
    phone: null,
    isLive: false,
    deliveryEnabled: false,
    deliveryFeeMinor: 0,
    createdAt: green.createdAt,
    orderSeq: 0,
  });

  // ── Memberships & invitation ────────────────────────────────────────────
  const mem = (tenantId: string, userId: string, role: "OWNER" | "BRANCH_MANAGER" | "CASHIER" | "KITCHEN" | "RUNNER", branchIds: string[]) =>
    store.createMembership({ tenantId, userId, role, status: "ACTIVE", branchIds, createdAt: now });
  await mem(tenant.id, owner.id, "OWNER", []);
  await mem(tenant.id, manager.id, "BRANCH_MANAGER", [main.id]);
  await mem(tenant.id, cashier.id, "CASHIER", [main.id]);
  await mem(tenant.id, kitchen.id, "KITCHEN", [main.id]);
  await mem(tenant.id, runner.id, "RUNNER", [main.id]);
  await mem(harbour.id, harbourOwner.id, "OWNER", []);
  await store.createInvitation({
    tenantId: green.id,
    email: "owner@greenbowl.demo",
    role: "OWNER",
    branchIds: [],
    tokenHash: sha256("demo-invite-green-bowl"),
    expiresAt: addMs(now, 7 * 24 * 60 * MIN),
    acceptedAt: null,
    revokedAt: null,
    invitedByUserId: platform.id,
    createdAt: addMs(now, -2 * 24 * 60 * MIN),
  });

  // ── Stations ────────────────────────────────────────────────────────────
  const mainStation = await store.createStation({ tenantId: tenant.id, branchId: main.id, name: "Main" });
  const tandoor = await store.createStation({ tenantId: tenant.id, branchId: main.id, name: "Tandoor" });
  await store.createStation({ tenantId: tenant.id, branchId: lake.id, name: "Main" });
  await store.createStation({ tenantId: harbour.id, branchId: harbourBranch.id, name: "Wok" });

  // ── Menu: Spice Route ───────────────────────────────────────────────────
  const dips = await store.createModifierGroup(tenant.id, {
    name: "Dip",
    minSelect: 0,
    maxSelect: 2,
    options: [
      { name: "Extra mint chutney", priceDeltaMinor: 0, isAvailable: true, sortOrder: 0 },
      { name: "Garlic mayo", priceDeltaMinor: 2000, isAvailable: true, sortOrder: 1 },
    ],
  });
  const spice = await store.createModifierGroup(tenant.id, {
    name: "Spice level",
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: "Mild", priceDeltaMinor: 0, isAvailable: true, sortOrder: 0 },
      { name: "Medium", priceDeltaMinor: 0, isAvailable: true, sortOrder: 1 },
      { name: "Spicy", priceDeltaMinor: 0, isAvailable: true, sortOrder: 2 },
    ],
  });
  const extras = await store.createModifierGroup(tenant.id, {
    name: "Add-ons",
    minSelect: 0,
    maxSelect: 3,
    options: [
      { name: "Extra raita", priceDeltaMinor: 3000, isAvailable: true, sortOrder: 0 },
      { name: "Boiled egg", priceDeltaMinor: 2000, isAvailable: true, sortOrder: 1 },
      { name: "Fried onions", priceDeltaMinor: 1500, isAvailable: false, sortOrder: 2 },
    ],
  });
  const sweetness = await store.createModifierGroup(tenant.id, {
    name: "Style",
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: "Sweet", priceDeltaMinor: 0, isAvailable: true, sortOrder: 0 },
      { name: "Salted", priceDeltaMinor: 0, isAvailable: true, sortOrder: 1 },
      { name: "Sweet & salted", priceDeltaMinor: 0, isAvailable: true, sortOrder: 2 },
    ],
  });
  const groups = [dips, spice, extras, sweetness];
  const st = mainStation.id;
  const { items } = await seedMenu(store, tenant.id, [
    {
      name: "Starters",
      items: [
        {
          name: "Paneer Tikka",
          description: "Smoky, charred cottage cheese",
          basePriceMinor: 26000,
          dietary: "VEG",
          stationId: tandoor.id,
          variants: [],
          modifierGroupIds: [dips.id],
        },
        {
          name: "Chicken 65",
          description: "Crisp, curry leaf, chilli",
          basePriceMinor: 28000,
          dietary: "NON_VEG",
          stationId: st,
          variants: [],
          modifierGroupIds: [spice.id],
        },
        {
          name: "Veg Spring Rolls",
          description: "Served with sweet chilli dip",
          basePriceMinor: 18000,
          dietary: "VEG",
          stationId: st,
          variants: [],
          modifierGroupIds: [],
        },
        {
          name: "Masala Fries",
          description: "Peri-peri seasoning",
          basePriceMinor: 15000,
          dietary: "VEGAN",
          stationId: st,
          variants: [
            { name: "Regular", priceDeltaMinor: 0, isDefault: true, sortOrder: 0 },
            { name: "Large", priceDeltaMinor: 6000, isDefault: false, sortOrder: 1 },
          ],
          modifierGroupIds: [dips.id],
        },
      ],
    },
    {
      name: "Mains",
      items: [
        {
          name: "Veg Biryani",
          description: "Dum-cooked basmati, seasonal vegetables",
          basePriceMinor: 24000,
          dietary: "VEG",
          stationId: st,
          variants: [],
          modifierGroupIds: [extras.id],
        },
        {
          name: "Chicken Biryani",
          description: "Hyderabadi style, served with raita",
          basePriceMinor: 30000,
          dietary: "NON_VEG",
          stationId: st,
          variants: [],
          modifierGroupIds: [extras.id, spice.id],
        },
        {
          name: "Butter Chicken",
          description: "Tomato, butter, kasuri methi",
          basePriceMinor: 32000,
          dietary: "NON_VEG",
          stationId: st,
          variants: [],
          modifierGroupIds: [spice.id],
        },
        {
          name: "Dal Makhani",
          description: "Slow-cooked black lentils",
          basePriceMinor: 22000,
          dietary: "VEG",
          stationId: st,
          variants: [],
          modifierGroupIds: [],
        },
        { name: "Raita", description: "Cucumber and mint yoghurt", basePriceMinor: 6000, dietary: "VEG", stationId: st, variants: [], modifierGroupIds: [] },
      ],
    },
    {
      name: "Breads",
      items: [
        {
          name: "Butter Naan",
          description: "Tandoor-baked, brushed with butter",
          basePriceMinor: 6000,
          dietary: "VEG",
          stationId: tandoor.id,
          variants: [],
          modifierGroupIds: [],
        },
        {
          name: "Garlic Naan",
          description: "Garlic and coriander",
          basePriceMinor: 7000,
          dietary: "VEG",
          stationId: tandoor.id,
          variants: [],
          modifierGroupIds: [],
        },
        {
          name: "Tandoori Roti",
          description: "Whole wheat",
          basePriceMinor: 4000,
          dietary: "VEGAN",
          stationId: tandoor.id,
          variants: [],
          modifierGroupIds: [],
        },
      ],
    },
    {
      name: "Drinks",
      items: [
        {
          name: "Lime Soda",
          description: "Fresh lime, soda",
          basePriceMinor: 8000,
          dietary: "VEGAN",
          stationId: st,
          variants: [],
          modifierGroupIds: [sweetness.id],
        },
        {
          name: "Mango Lassi",
          description: "Alphonso mango, yoghurt",
          basePriceMinor: 11000,
          dietary: "VEG",
          stationId: st,
          variants: [
            { name: "Glass", priceDeltaMinor: 0, isDefault: true, sortOrder: 0 },
            { name: "Jug (serves 3)", priceDeltaMinor: 18000, isDefault: false, sortOrder: 1 },
          ],
          modifierGroupIds: [],
        },
        { name: "Masala Chai", description: "Spiced milk tea", basePriceMinor: 5000, dietary: "VEG", stationId: st, variants: [], modifierGroupIds: [] },
      ],
    },
    {
      name: "Desserts",
      items: [
        { name: "Gulab Jamun", description: "Two pieces, warm", basePriceMinor: 9000, dietary: "VEG", stationId: st, variants: [], modifierGroupIds: [] },
        { name: "Kulfi", description: "Pistachio, saffron", basePriceMinor: 12000, dietary: "VEG", stationId: st, variants: [], modifierGroupIds: [] },
      ],
    },
  ]);
  const menu: SeedMenu = { items, groups, pricing: pricingMenu(items, groups) };

  // Branch overrides: Lake View charges more for biryani; Kulfi is out of stock at Main Street.
  const itemId = (name: string) => items.find((i) => i.name === name)!.id;
  await store.upsertBranchMenuItem({ tenantId: tenant.id, branchId: lake.id, itemId: itemId("Chicken Biryani"), priceOverrideMinor: 32000, isAvailable: true });
  await store.upsertBranchMenuItem({ tenantId: tenant.id, branchId: main.id, itemId: itemId("Kulfi"), priceOverrideMinor: null, isAvailable: false });

  // ── Menu: Harbour ───────────────────────────────────────────────────────
  const harbourItems = (
    await seedMenu(store, harbour.id, [
      {
        name: "Noodles",
        items: [
          {
            name: "Laksa",
            description: "Coconut curry broth, prawns",
            basePriceMinor: 1290,
            dietary: "NON_VEG",
            stationId: null,
            variants: [],
            modifierGroupIds: [],
          },
          {
            name: "Char Kway Teow",
            description: "Wok-fried flat noodles",
            basePriceMinor: 1150,
            dietary: "NON_VEG",
            stationId: null,
            variants: [],
            modifierGroupIds: [],
          },
        ],
      },
      {
        name: "Drinks",
        items: [{ name: "Iced Kopi", description: "Local coffee", basePriceMinor: 320, dietary: "VEG", stationId: null, variants: [], modifierGroupIds: [] }],
      },
    ])
  ).items;
  const harbourMenu: SeedMenu = { items: harbourItems, groups: [], pricing: pricingMenu(harbourItems, []) };

  // ── Tables ──────────────────────────────────────────────────────────────
  const mainTables = new Map<number, { id: string; label: string }>();
  for (let n = 1; n <= 12; n++) {
    const qrRef = n === 12 ? DEMO.table12QrRef : n === 5 ? DEMO.table5QrRef : `t_DEMO_main_table_${n}`;
    const t = await store.createTable({
      tenantId: tenant.id,
      branchId: main.id,
      label: `Table ${n}`,
      area: n <= 8 ? "Indoor" : "Terrace",
      seats: n % 3 === 0 ? 6 : 4,
      qrRef,
      status: "ACTIVE",
      qrRotatedAt: tenant.createdAt,
      createdAt: tenant.createdAt,
    });
    mainTables.set(n, { id: t.id, label: t.label });
  }
  await store.createTable({
    tenantId: tenant.id,
    branchId: main.id,
    label: "Patio (closed)",
    area: "Outdoor",
    seats: 4,
    qrRef: DEMO.revokedQrRef,
    status: "DISABLED",
    qrRotatedAt: tenant.createdAt,
    createdAt: tenant.createdAt,
  });
  const lakeTables: Array<{ id: string; label: string }> = [];
  for (let n = 1; n <= 6; n++) {
    const t = await store.createTable({
      tenantId: tenant.id,
      branchId: lake.id,
      label: `Table ${n}`,
      area: "Lakeside",
      seats: 4,
      qrRef: `t_DEMO_lake_table_${n}`,
      status: "ACTIVE",
      qrRotatedAt: tenant.createdAt,
      createdAt: tenant.createdAt,
    });
    lakeTables.push({ id: t.id, label: t.label });
  }
  const harbourTable = await store.createTable({
    tenantId: harbour.id,
    branchId: harbourBranch.id,
    label: "Counter 1",
    area: null,
    seats: 2,
    qrRef: "t_DEMO_harbour_counter_1",
    status: "ACTIVE",
    qrRotatedAt: harbour.createdAt,
    createdAt: harbour.createdAt,
  });

  // ── Payment connections ─────────────────────────────────────────────────
  for (const [t, status] of [
    [tenant, "ACTIVE"],
    [harbour, "ACTIVE"],
    [green, "PENDING"],
  ] as const) {
    await store.upsertPaymentConnection({
      tenantId: t.id,
      provider: "mock",
      status,
      merchantAccountId: `acct_demo_${t.slug}`,
      displayName: "Mock provider (TEST ONLY)",
      createdAt: t.createdAt,
      updatedAt: now,
    });
  }

  // ── Historical orders (for reports) ─────────────────────────────────────
  const rand = mulberry32(20261017);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
  const names = ["Aisha", "Rahul", "Divya", "Vikram", "Neha", "Karthik", "Sneha", "Farhan", "Ishita", "Rohan"];
  const simpleItems = [
    "Paneer Tikka",
    "Veg Spring Rolls",
    "Veg Biryani",
    "Butter Chicken",
    "Dal Makhani",
    "Butter Naan",
    "Garlic Naan",
    "Mango Lassi",
    "Masala Chai",
    "Gulab Jamun",
    "Tandoori Roti",
    "Raita",
  ];
  const actor = { kitchen: kitchen.id, cashier: cashier.id };
  // Hourly weights roughly matching the mockup's lunch and dinner peaks.
  const hourWeights: Array<[number, number]> = [
    [11, 2],
    [12, 4],
    [13, 9],
    [14, 8],
    [15, 4],
    [16, 2],
    [17, 2],
    [18, 3],
    [19, 6],
    [20, 10],
    [21, 8],
    [22, 4],
  ];
  const pickHour = () => {
    const total = hourWeights.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [h, w] of hourWeights) if ((r -= w) <= 0) return h;
    return 20;
  };

  type Hist = Omit<OrderSpec, "tenant" | "menu"> & { tenant?: Tenant; menu?: SeedMenu };
  const history: Hist[] = [];
  for (let d = historyDays; d >= 0; d--) {
    for (const [branch, tables, perDay] of [
      [main, [...mainTables.values()], d === 0 ? 14 : 9 + Math.floor(rand() * 7)],
      [lake, lakeTables, d === 0 ? 3 : 3 + Math.floor(rand() * 3)],
    ] as const) {
      for (let k = 0; k < perDay; k++) {
        const day = new Date(nowDate);
        day.setUTCDate(day.getUTCDate() - d);
        // Bengaluru local time = UTC+5:30
        day.setUTCHours(pickHour() - 5, Math.floor(rand() * 60) - 30, Math.floor(rand() * 60), 0);
        if (day >= new Date(nowDate.getTime() - 50 * MIN)) continue; // keep "today" in the past
        const r = rand();
        const ft: FulfillmentType = r < 0.65 ? "DINE_IN" : r < 0.95 || branch.id !== main.id ? "TAKEAWAY" : "DELIVERY";
        const lines: OrderSpec["lines"] = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({
          item: pick(simpleItems),
          qty: 1 + Math.floor(rand() * 2),
        }));
        if (rand() < 0.3) lines.push({ item: "Chicken 65", qty: 1, modifiers: [pick(["Mild", "Medium", "Spicy"])] });
        const outcome = rand();
        const status: OrderStatus = outcome < 0.04 ? "CANCELLED" : outcome < 0.06 ? "REJECTED" : "COMPLETED";
        history.push({
          branch,
          lines,
          fulfillmentType: ft,
          table: ft === "DINE_IN" ? pick(tables) : undefined,
          customer:
            ft === "DINE_IN"
              ? undefined
              : {
                  name: pick(names),
                  phone: `+91 98${Math.floor(10000000 + rand() * 89999999)}`,
                  address: ft === "DELIVERY" ? `${1 + Math.floor(rand() * 200)} 80 Feet Road, Bengaluru (DEMO)` : undefined,
                },
          status,
          cancelReason: status === "CANCELLED" ? "Payment not completed within 30 minutes" : undefined,
          createdAt: iso(day),
          timings: { acceptAfter: 0.5 + rand() * 2, prepMinutes: 7 + rand() * 11, handoverAfter: 0.5 + rand() * 3 },
        });
      }
    }
  }
  history.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // Main Street numbering ends at #1038 so the live board matches the BRD mockup (#1039–#1045).
  const mainHistoryCount = history.filter((h) => h.branch.id === main.id).length;
  await store.setOrderSequence(tenant.id, main.id, 1038 - mainHistoryCount);
  for (const h of history) await createSeedOrder(store, { ...h, tenant, menu } as OrderSpec, actor);

  // ── Live orders (match BRD Figure 2) ────────────────────────────────────
  const minsAgo = (m: number) => addMs(now, -m * MIN);
  const live = (spec: Omit<OrderSpec, "tenant" | "branch" | "menu">) => createSeedOrder(store, { tenant, branch: main, menu, ...spec }, actor);
  const deliveryOrder = await live({
    lines: [
      { item: "Chicken Biryani", qty: 2, modifiers: ["Medium"] },
      { item: "Raita", qty: 1 },
    ],
    fulfillmentType: "DELIVERY",
    customer: { name: "Farhan (DEMO)", phone: "+91 98450 00001", address: "221 CMH Road, Indiranagar, Bengaluru (DEMO)" },
    status: "READY",
    createdAt: minsAgo(26),
    timings: { acceptAfter: 1, prepMinutes: 15, handoverAfter: 0 },
  });
  await live({
    lines: [{ item: "Veg Spring Rolls", qty: 2 }],
    fulfillmentType: "DINE_IN",
    table: mainTables.get(2),
    status: "READY",
    createdAt: minsAgo(16),
    timings: { acceptAfter: 0.5, prepMinutes: 6, handoverAfter: 0 },
  });
  await live({
    lines: [
      { item: "Veg Biryani", qty: 1 },
      { item: "Lime Soda", qty: 2, modifiers: ["Sweet"] },
    ],
    fulfillmentType: "DINE_IN",
    table: mainTables.get(8),
    status: "PREPARING",
    createdAt: minsAgo(5),
    timings: { acceptAfter: 0.5, prepMinutes: 0, handoverAfter: 0 },
  });
  await live({
    id: DEMO.liveOrderId,
    accessToken: DEMO.liveOrderToken,
    lines: [
      { item: "Paneer Tikka", qty: 1, modifiers: ["Extra mint chutney"] },
      { item: "Masala Fries", qty: 2, variant: "Regular" },
      { item: "Chicken 65", qty: 1, modifiers: ["Spicy"] },
    ],
    fulfillmentType: "DINE_IN",
    table: mainTables.get(12),
    status: "PREPARING",
    createdAt: minsAgo(8),
    timings: { acceptAfter: 1, prepMinutes: 0, handoverAfter: 0 },
  });
  await live({
    lines: [
      { item: "Chicken 65", qty: 2, modifiers: ["Medium"] },
      { item: "Butter Naan", qty: 1 },
    ],
    fulfillmentType: "DINE_IN",
    table: mainTables.get(5),
    status: "CONFIRMED",
    createdAt: minsAgo(1.5),
  });
  await live({
    lines: [
      { item: "Veg Biryani", qty: 1 },
      { item: "Raita", qty: 1 },
    ],
    fulfillmentType: "TAKEAWAY",
    customer: { name: "Divya (DEMO)", phone: "+91 98450 00002" },
    status: "CONFIRMED",
    createdAt: minsAgo(0.9),
  });
  await live({
    lines: [{ item: "Masala Chai", qty: 2 }],
    fulfillmentType: "DINE_IN",
    table: mainTables.get(3),
    status: "PENDING_PAYMENT",
    createdAt: minsAgo(0.5),
  });

  await store.createDeliveryAssignment({
    tenantId: tenant.id,
    branchId: main.id,
    orderId: deliveryOrder.id,
    runnerUserId: runner.id,
    status: "ASSIGNED",
    assignedByUserId: manager.id,
    note: "Call on arrival",
    createdAt: minsAgo(3),
    updatedAt: minsAgo(3),
  });

  // Harbour: a few SGD orders so reports show currency separation.
  for (let i = 0; i < 6; i++) {
    await createSeedOrder(
      store,
      {
        tenant: harbour,
        branch: harbourBranch,
        menu: harbourMenu,
        lines: [
          { item: i % 2 ? "Laksa" : "Char Kway Teow", qty: 1 },
          { item: "Iced Kopi", qty: 1 + (i % 2) },
        ],
        fulfillmentType: "DINE_IN",
        table: { id: harbourTable.id, label: harbourTable.label },
        status: "COMPLETED",
        createdAt: minsAgo(60 * 24 * (i + 1)),
      },
      actor,
    );
  }

  // ── Audit trail samples ─────────────────────────────────────────────────
  const audit = (
    tenantId: string | null,
    actorUserId: string,
    actorLabel: string,
    action: string,
    entityType: string,
    entityId: string | null,
    meta: Record<string, unknown>,
    minutesAgo: number,
  ) => store.addAudit({ tenantId, actorUserId, actorLabel, action, entityType, entityId, meta, requestId: null, createdAt: minsAgo(minutesAgo) });
  await audit(null, platform.id, platform.email, "tenant.created", "tenant", green.id, { name: green.name }, 2 * 24 * 60);
  await audit(tenant.id, owner.id, owner.email, "menu_item.updated", "menu_item", itemId("Paneer Tikka"), { fields: ["description"] }, 180);
  await audit(
    tenant.id,
    manager.id,
    manager.email,
    "branch_menu_item.updated",
    "menu_item",
    itemId("Kulfi"),
    { branch: "Main Street", isAvailable: false },
    95,
  );
  await audit(tenant.id, manager.id, manager.email, "table.qr_rotated", "table", mainTables.get(7)!.id, { label: "Table 7" }, 40);

  return { tenant, main, lake, harbour, users: { platform, owner, manager, cashier, kitchen, runner, harbourOwner } };
}
