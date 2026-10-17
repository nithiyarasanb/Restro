// Zod schemas shared by browser forms and API handlers so they cannot drift
// (DG §1 "Shared validation"). API schemas carry money as integer minor units.

import { z } from "zod";
import { FULFILLMENT_TYPES, ORDER_STATUSES, STAFF_ROLES } from "@/types/domain";
import { SUPPORTED_CURRENCIES } from "@/lib/money";

const id = z.uuid({ message: "Invalid id" });
const minor = z.int().min(0).max(100_000_000);
const shortText = (max: number) => z.string().trim().max(max);
const requiredText = (label: string, max: number) => z.string().trim().min(1, `${label} is required`).max(max, `${label} must be at most ${max} characters`);

// ─── Auth ─────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.email("Enter a valid email address").max(254),
  password: z.string().min(1, "Password is required").max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Include at least one letter and one number");

export const acceptInviteSchema = z.object({
  name: requiredText("Name", 80),
  password: passwordSchema,
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

// ─── Checkout ─────────────────────────────────────────────────────────────

export const cartLineSchema = z.object({
  menuItemId: id,
  variantId: id.nullable().default(null),
  modifierOptionIds: z.array(id).max(20).default([]),
  quantity: z.int().min(1, "Quantity must be at least 1").max(50, "Maximum 50 per item"),
  notes: shortText(140).nullable().default(null),
});
export type CartLineInput = z.infer<typeof cartLineSchema>;

export const orderContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("table"), qrRef: z.string().min(4).max(64) }),
  z.object({ kind: z.literal("branch"), tenantSlug: z.string().min(1).max(64), branchId: id }),
]);
export type OrderContextInput = z.infer<typeof orderContextSchema>;

export const quoteRequestSchema = z.object({
  context: orderContextSchema,
  fulfillmentType: z.enum(FULFILLMENT_TYPES),
  lines: z.array(cartLineSchema).min(1, "Your cart is empty").max(50),
});
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number");

export const customerDetailsSchema = z.object({
  name: shortText(80).nullable().default(null),
  phone: phone.nullable().default(null),
  address: shortText(300).nullable().default(null),
});

export const placeOrderSchema = quoteRequestSchema
  .extend({
    customer: customerDetailsSchema.default({ name: null, phone: null, address: null }),
    notes: shortText(300).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.fulfillmentType === "DINE_IN" && v.context.kind !== "table") {
      ctx.addIssue({ code: "custom", path: ["context"], message: "Dine-in orders must come from a table QR code" });
    }
    if (v.fulfillmentType !== "DINE_IN") {
      if (!v.customer.name) ctx.addIssue({ code: "custom", path: ["customer", "name"], message: "Name is required" });
      if (!v.customer.phone) ctx.addIssue({ code: "custom", path: ["customer", "phone"], message: "Phone is required" });
    }
    if (v.fulfillmentType === "DELIVERY" && !v.customer.address) {
      ctx.addIssue({ code: "custom", path: ["customer", "address"], message: "Delivery address is required" });
    }
  });
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

/** Client-side checkout form (fields the guest types). */
export const checkoutFormSchema = z.object({
  name: z.string().trim().max(80),
  phone: z.string().trim().max(20),
  address: z.string().trim().max(300),
  notes: z.string().trim().max(300),
});
export type CheckoutFormValues = z.infer<typeof checkoutFormSchema>;

// ─── Orders / kitchen ─────────────────────────────────────────────────────

export const transitionSchema = z.object({
  action: z.enum(["accept", "reject", "start", "ready", "serve", "pickup", "complete", "cancel"]),
  expectedVersion: z.int().min(1),
  reason: shortText(200).nullable().default(null),
});
export type TransitionInput = z.infer<typeof transitionSchema>;

export const orderListQuerySchema = z.object({
  branchId: id.optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  fulfillmentType: z.enum(FULFILLMENT_TYPES).optional(),
  q: z.string().trim().max(60).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const refundSchema = z.object({
  amountMinor: z.int().min(1, "Amount must be greater than zero"),
  reason: requiredText("Reason", 200),
});
export type RefundInput = z.infer<typeof refundSchema>;

export const deliveryAssignSchema = z.object({
  runnerUserId: id,
  note: shortText(200).nullable().default(null),
});

export const deliveryEventSchema = z.object({
  type: z.enum(["PICKED_UP", "DELIVERED", "FAILED"]),
  note: shortText(200).nullable().default(null),
});

// ─── Catalog ──────────────────────────────────────────────────────────────

export const categorySchema = z.object({
  name: requiredText("Name", 60),
  sortOrder: z.int().min(0).max(10_000).default(0),
});
export type CategoryInput = z.infer<typeof categorySchema>;

export const variantSchema = z.object({
  id: id.optional(),
  name: requiredText("Variant name", 40),
  priceDeltaMinor: z.int().min(-10_000_000).max(10_000_000),
  isDefault: z.boolean().default(false),
});

export const menuItemSchema = z
  .object({
    categoryId: id,
    name: requiredText("Name", 80),
    description: shortText(300).default(""),
    basePriceMinor: minor,
    dietary: z.enum(["VEG", "NON_VEG", "VEGAN", "EGG"]).nullable().default(null),
    stationId: id.nullable().default(null),
    imageUrl: z.string().max(500).nullable().default(null),
    sortOrder: z.int().min(0).max(10_000).default(0),
    variants: z.array(variantSchema).max(10).default([]),
    modifierGroupIds: z.array(id).max(10).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.variants.length > 0 && v.variants.filter((x) => x.isDefault).length !== 1) {
      ctx.addIssue({ code: "custom", path: ["variants"], message: "Choose exactly one default variant" });
    }
    v.variants.forEach((variant, i) => {
      if (v.basePriceMinor + variant.priceDeltaMinor < 0) {
        ctx.addIssue({ code: "custom", path: ["variants", i, "priceDeltaMinor"], message: "Variant price would be negative" });
      }
    });
  });
export type MenuItemInput = z.infer<typeof menuItemSchema>;

export const modifierGroupSchema = z
  .object({
    name: requiredText("Name", 60),
    minSelect: z.int().min(0).max(10),
    maxSelect: z.int().min(1).max(10),
    options: z
      .array(
        z.object({
          id: id.optional(),
          name: requiredText("Option name", 60),
          priceDeltaMinor: z.int().min(0).max(10_000_000),
          isAvailable: z.boolean().default(true),
        }),
      )
      .min(1, "Add at least one option")
      .max(20),
  })
  .superRefine((v, ctx) => {
    if (v.minSelect > v.maxSelect) ctx.addIssue({ code: "custom", path: ["minSelect"], message: "Minimum cannot exceed maximum" });
    if (v.maxSelect > v.options.length) ctx.addIssue({ code: "custom", path: ["maxSelect"], message: "Maximum cannot exceed the number of options" });
  });
export type ModifierGroupInput = z.infer<typeof modifierGroupSchema>;

export const branchMenuItemSchema = z.object({
  isAvailable: z.boolean().optional(),
  priceOverrideMinor: minor.nullable().optional(),
});

// ─── Tables ───────────────────────────────────────────────────────────────

export const tableSchema = z.object({
  label: requiredText("Label", 20),
  area: shortText(40).nullable().default(null),
  seats: z.int().min(1).max(50).default(4),
});
export type TableInput = z.infer<typeof tableSchema>;

export const tableStatusSchema = z.object({ status: z.enum(["ACTIVE", "DISABLED"]) });

// ─── Tenancy / branches ───────────────────────────────────────────────────

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const openingHoursSchema = z.array(z.object({ day: z.int().min(0).max(6), open: hhmm, close: hhmm })).max(21);

export const branchSchema = z.object({
  name: requiredText("Branch name", 80),
  address: requiredText("Address", 200),
  phone: phone.nullable().default(null),
  timezone: requiredText("Timezone", 60),
  taxRateBps: z.int().min(0).max(5000),
  serviceChargeBps: z.int().min(0).max(3000),
  takeawayEnabled: z.boolean(),
  deliveryEnabled: z.boolean(),
  deliveryFeeMinor: minor,
  acceptingOrders: z.boolean(),
  openingHours: openingHoursSchema.default([]),
});
export type BranchInput = z.infer<typeof branchSchema>;

export const tenantSettingsSchema = z.object({
  name: requiredText("Restaurant name", 80),
  legalName: shortText(120).nullable().default(null),
  timezone: requiredText("Timezone", 60),
});
export type TenantSettingsInput = z.infer<typeof tenantSettingsSchema>;

const slug = z
  .string()
  .trim()
  .min(3, "At least 3 characters")
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lowercase letters, numbers and single hyphens only");

export const onboardTenantSchema = z.object({
  name: requiredText("Restaurant name", 80),
  slug,
  country: z.string().length(2, "Use a 2-letter country code").toUpperCase(),
  currency: z.enum(SUPPORTED_CURRENCIES as [string, ...string[]]),
  timezone: requiredText("Timezone", 60),
  branchName: requiredText("Branch name", 80),
  branchAddress: requiredText("Branch address", 200),
  ownerEmail: z.email("Enter a valid email").max(254),
});
export type OnboardTenantInput = z.infer<typeof onboardTenantSchema>;

export const tenantPlatformUpdateSchema = z.object({
  status: z.enum(["ONBOARDING", "ACTIVE", "SUSPENDED"]).optional(),
  features: z.object({ delivery: z.boolean(), maxBranches: z.int().min(1).max(500) }).optional(),
});

// ─── Staff ────────────────────────────────────────────────────────────────

export const inviteSchema = z.object({
  email: z.email("Enter a valid email").max(254),
  role: z.enum(STAFF_ROLES),
  branchIds: z.array(id).max(50).default([]),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const membershipUpdateSchema = z.object({
  role: z.enum(STAFF_ROLES).optional(),
  branchIds: z.array(id).max(50).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

// ─── Reports ──────────────────────────────────────────────────────────────

export const reportQuerySchema = z
  .object({
    branchId: id.optional(),
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine((v) => v.from <= v.to, { message: "Start date must be on or before end date", path: ["from"] });
export type ReportQuery = z.infer<typeof reportQuerySchema>;
