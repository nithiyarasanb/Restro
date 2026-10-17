import { describe, expect, it } from "vitest";
import { priceOrder, type PricingMenu } from "@/server/services/pricing";
import type { MenuItem, ModifierGroup } from "@/types/domain";
import { DomainError } from "@/server/errors";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (over: Partial<MenuItem>): MenuItem => ({
  id: id(1),
  tenantId: id(100),
  categoryId: id(200),
  name: "Item",
  description: "",
  basePriceMinor: 10000,
  imageUrl: null,
  dietary: null,
  stationId: null,
  sortOrder: 0,
  retiredAt: null,
  variants: [],
  modifierGroupIds: [],
  createdAt: "",
  updatedAt: "",
  ...over,
});

const spice: ModifierGroup = {
  id: id(50),
  tenantId: id(100),
  name: "Spice",
  minSelect: 1,
  maxSelect: 1,
  retiredAt: null,
  options: [
    { id: id(51), groupId: id(50), name: "Mild", priceDeltaMinor: 0, isAvailable: true, sortOrder: 0 },
    { id: id(52), groupId: id(50), name: "Hot", priceDeltaMinor: 0, isAvailable: true, sortOrder: 1 },
  ],
};
const extras: ModifierGroup = {
  id: id(60),
  tenantId: id(100),
  name: "Extras",
  minSelect: 0,
  maxSelect: 2,
  retiredAt: null,
  options: [
    { id: id(61), groupId: id(60), name: "Cheese", priceDeltaMinor: 3000, isAvailable: true, sortOrder: 0 },
    { id: id(62), groupId: id(60), name: "Egg", priceDeltaMinor: 2000, isAvailable: false, sortOrder: 1 },
  ],
};

const fries = item({
  id: id(2),
  name: "Fries",
  basePriceMinor: 15000,
  variants: [
    { id: id(3), itemId: id(2), name: "Regular", priceDeltaMinor: 0, isDefault: true, sortOrder: 0 },
    { id: id(4), itemId: id(2), name: "Large", priceDeltaMinor: 6000, isDefault: false, sortOrder: 1 },
  ],
});
const curry = item({ id: id(5), name: "Curry", basePriceMinor: 30000, modifierGroupIds: [spice.id, extras.id] });
const menu = (branchItems: PricingMenu["branchItems"] = new Map()): PricingMenu => ({
  items: new Map([fries, curry].map((i) => [i.id, i])),
  groups: new Map([spice, extras].map((g) => [g.id, g])),
  branchItems,
});
const branch = { taxRateBps: 500, serviceChargeBps: 1000, deliveryFeeMinor: 4000 };
const line = (menuItemId: string, over: Record<string, unknown> = {}) => ({
  menuItemId,
  variantId: null,
  modifierOptionIds: [] as string[],
  quantity: 1,
  notes: null,
  ...over,
});

describe("server-side pricing (FR-04)", () => {
  it("prices variants and modifiers and snapshots names", () => {
    const q = priceOrder({
      menu: menu(),
      branch,
      currency: "INR",
      fulfillmentType: "TAKEAWAY",
      lines: [line(fries.id, { variantId: id(4), quantity: 2 }), line(curry.id, { modifierOptionIds: [id(52), id(61)] })],
    });
    expect(q.lines[0]).toMatchObject({ nameSnapshot: "Fries", variantName: "Large", unitPriceMinor: 21000, lineTotalMinor: 42000 });
    expect(q.lines[1]).toMatchObject({
      unitPriceMinor: 33000,
      modifiers: [expect.objectContaining({ optionName: "Hot" }), expect.objectContaining({ optionName: "Cheese" })],
    });
    expect(q.subtotalMinor).toBe(75000);
    expect(q.serviceChargeMinor).toBe(0); // takeaway: no service charge
    expect(q.taxMinor).toBe(3750);
    expect(q.totalMinor).toBe(78750);
  });

  it("uses the default variant when none is chosen", () => {
    const q = priceOrder({ menu: menu(), branch, currency: "INR", fulfillmentType: "TAKEAWAY", lines: [line(fries.id)] });
    expect(q.lines[0]).toMatchObject({ variantName: "Regular", unitPriceMinor: 15000 });
  });

  it("applies service charge to dine-in and taxes it; delivery fee is untaxed", () => {
    const dine = priceOrder({ menu: menu(), branch, currency: "INR", fulfillmentType: "DINE_IN", lines: [line(fries.id)] });
    expect(dine.serviceChargeMinor).toBe(1500);
    expect(dine.taxMinor).toBe(applyTax(15000 + 1500));
    const del = priceOrder({ menu: menu(), branch, currency: "INR", fulfillmentType: "DELIVERY", lines: [line(fries.id)] });
    expect(del.deliveryFeeMinor).toBe(4000);
    expect(del.totalMinor).toBe(15000 + 750 + 4000);
  });

  it("applies branch price overrides", () => {
    const q = priceOrder({
      menu: menu(new Map([[fries.id, { tenantId: id(100), branchId: id(9), itemId: fries.id, priceOverrideMinor: 17000, isAvailable: true }]])),
      branch,
      currency: "INR",
      fulfillmentType: "TAKEAWAY",
      lines: [line(fries.id)],
    });
    expect(q.lines[0].unitPriceMinor).toBe(17000);
  });

  it.each([
    [
      "unavailable at branch",
      () =>
        priceOrder({
          menu: menu(new Map([[fries.id, { tenantId: id(100), branchId: id(9), itemId: fries.id, priceOverrideMinor: null, isAvailable: false }]])),
          branch,
          currency: "INR",
          fulfillmentType: "TAKEAWAY",
          lines: [line(fries.id)],
        }),
      "ITEM_UNAVAILABLE",
    ],
    ["unknown item", () => priceOrder({ menu: menu(), branch, currency: "INR", fulfillmentType: "TAKEAWAY", lines: [line(id(999))] }), "ITEM_UNAVAILABLE"],
    [
      "required modifier missing",
      () => priceOrder({ menu: menu(), branch, currency: "INR", fulfillmentType: "TAKEAWAY", lines: [line(curry.id)] }),
      "VALIDATION_FAILED",
    ],
    [
      "too many in a single-choice group",
      () =>
        priceOrder({ menu: menu(), branch, currency: "INR", fulfillmentType: "TAKEAWAY", lines: [line(curry.id, { modifierOptionIds: [id(51), id(52)] })] }),
      "VALIDATION_FAILED",
    ],
    [
      "option from another item",
      () => priceOrder({ menu: menu(), branch, currency: "INR", fulfillmentType: "TAKEAWAY", lines: [line(fries.id, { modifierOptionIds: [id(61)] })] }),
      "VALIDATION_FAILED",
    ],
    [
      "unavailable option",
      () =>
        priceOrder({ menu: menu(), branch, currency: "INR", fulfillmentType: "TAKEAWAY", lines: [line(curry.id, { modifierOptionIds: [id(51), id(62)] })] }),
      "ITEM_UNAVAILABLE",
    ],
    [
      "variant of another item",
      () =>
        priceOrder({
          menu: menu(),
          branch,
          currency: "INR",
          fulfillmentType: "TAKEAWAY",
          lines: [line(curry.id, { variantId: id(4), modifierOptionIds: [id(51)] })],
        }),
      "VALIDATION_FAILED",
    ],
    [
      "duplicate option",
      () =>
        priceOrder({ menu: menu(), branch, currency: "INR", fulfillmentType: "TAKEAWAY", lines: [line(curry.id, { modifierOptionIds: [id(51), id(51)] })] }),
      "VALIDATION_FAILED",
    ],
  ])("rejects %s", (_, run, code) => {
    try {
      run();
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe(code);
      expect((e as DomainError).details).toMatchObject({ lines: [expect.objectContaining({ index: 0 })] });
    }
  });

  it("rejects retired items", () => {
    const retired = { ...menu(), items: new Map([[fries.id, { ...fries, retiredAt: "2026-01-01T00:00:00Z" }]]) };
    expect(() => priceOrder({ menu: retired, branch, currency: "INR", fulfillmentType: "TAKEAWAY", lines: [line(fries.id)] })).toThrow(/unavailable/);
  });
});

function applyTax(amount: number) {
  return Math.floor((amount * 500 + 5000) / 10000);
}
