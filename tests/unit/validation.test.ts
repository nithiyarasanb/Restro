import { describe, expect, it } from "vitest";
import { menuItemSchema, modifierGroupSchema, placeOrderSchema, transitionSchema } from "@/lib/validation";

const uuid = "00000000-0000-4000-8000-000000000001";
const base = { context: { kind: "table", qrRef: "t_abcdef" }, fulfillmentType: "DINE_IN", lines: [{ menuItemId: uuid, quantity: 1 }] };

describe("shared validation", () => {
  it("strips client-supplied totals and prices (BR-06)", () => {
    const parsed = placeOrderSchema.parse({ ...base, totalMinor: 1, lines: [{ menuItemId: uuid, quantity: 1, unitPriceMinor: 1 }] });
    expect(parsed).not.toHaveProperty("totalMinor");
    expect(parsed.lines[0]).not.toHaveProperty("unitPriceMinor");
  });

  it("requires contact details for takeaway and an address for delivery", () => {
    const ctx = { kind: "branch", tenantSlug: "x", branchId: uuid };
    expect(placeOrderSchema.safeParse({ ...base, context: ctx, fulfillmentType: "TAKEAWAY" }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...base, context: ctx, fulfillmentType: "TAKEAWAY", customer: { name: "A", phone: "+91 98450 00000" } }).success).toBe(
      true,
    );
    expect(placeOrderSchema.safeParse({ ...base, context: ctx, fulfillmentType: "DELIVERY", customer: { name: "A", phone: "+91 98450 00000" } }).success).toBe(
      false,
    );
  });

  it("rejects dine-in without a table and silly quantities", () => {
    expect(placeOrderSchema.safeParse({ ...base, context: { kind: "branch", tenantSlug: "x", branchId: uuid } }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...base, lines: [{ menuItemId: uuid, quantity: 0 }] }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...base, lines: [{ menuItemId: uuid, quantity: 51 }] }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
  });

  it("validates menu items and modifier groups", () => {
    const item = { categoryId: uuid, name: "X", basePriceMinor: 100, variants: [{ name: "A", priceDeltaMinor: 0, isDefault: false }] };
    expect(menuItemSchema.safeParse(item).success).toBe(false); // needs one default
    expect(menuItemSchema.safeParse({ ...item, variants: [{ name: "A", priceDeltaMinor: -200, isDefault: true }] }).success).toBe(false); // negative price
    expect(modifierGroupSchema.safeParse({ name: "G", minSelect: 2, maxSelect: 1, options: [{ name: "a", priceDeltaMinor: 0 }] }).success).toBe(false);
    expect(modifierGroupSchema.safeParse({ name: "G", minSelect: 0, maxSelect: 3, options: [{ name: "a", priceDeltaMinor: 0 }] }).success).toBe(false);
  });

  it("does not allow SYSTEM or runner transitions through the staff endpoint", () => {
    expect(transitionSchema.safeParse({ action: "confirm", expectedVersion: 1 }).success).toBe(false);
    expect(transitionSchema.safeParse({ action: "dispatch", expectedVersion: 1 }).success).toBe(false);
  });
});
