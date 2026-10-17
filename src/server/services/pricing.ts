// Server-side pricing (FR-04, BR-06). Pure function over a menu snapshot so it
// is easy to unit test and identical for quotes, orders and the demo seed.
// Clients send identifiers and quantities only; every amount is derived here.

import { applyBps, assertMinor } from "@/lib/money";
import type { Branch, BranchMenuItem, FulfillmentType, MenuItem, ModifierGroup, OrderItem } from "@/types/domain";
import type { CartLineInput } from "@/lib/validation";
import { DomainError } from "@/server/errors";

export interface PricingMenu {
  items: Map<string, MenuItem>;
  groups: Map<string, ModifierGroup>;
  branchItems: Map<string, BranchMenuItem>; // keyed by itemId
}

export interface QuoteLine extends Omit<OrderItem, "id"> {
  available: true;
}

export interface Quote {
  currency: string;
  fulfillmentType: FulfillmentType;
  lines: QuoteLine[];
  subtotalMinor: number;
  discountMinor: number;
  serviceChargeMinor: number;
  taxMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
  taxRateBps: number;
  serviceChargeBps: number;
}

export interface LineIssue {
  index: number;
  menuItemId: string;
  code: "ITEM_NOT_FOUND" | "ITEM_UNAVAILABLE" | "VARIANT_INVALID" | "MODIFIER_INVALID" | "MODIFIER_UNAVAILABLE" | "MODIFIER_COUNT";
  message: string;
}

export function effectiveBasePrice(item: MenuItem, branchItem: BranchMenuItem | undefined): number {
  return branchItem?.priceOverrideMinor ?? item.basePriceMinor;
}

export function isItemAvailable(item: MenuItem, branchItem: BranchMenuItem | undefined): boolean {
  return !item.retiredAt && (branchItem?.isAvailable ?? true);
}

export function priceOrder(input: {
  menu: PricingMenu;
  branch: Pick<Branch, "taxRateBps" | "serviceChargeBps" | "deliveryFeeMinor">;
  currency: string;
  fulfillmentType: FulfillmentType;
  lines: CartLineInput[];
}): Quote {
  const { menu, branch, currency, fulfillmentType, lines } = input;
  const issues: LineIssue[] = [];
  const priced: QuoteLine[] = [];

  lines.forEach((line, index) => {
    const item = menu.items.get(line.menuItemId);
    const issue = (code: LineIssue["code"], message: string) => issues.push({ index, menuItemId: line.menuItemId, code, message });
    if (!item) return issue("ITEM_NOT_FOUND", "This item is no longer on the menu");
    const branchItem = menu.branchItems.get(item.id);
    if (!isItemAvailable(item, branchItem)) return issue("ITEM_UNAVAILABLE", `${item.name} is currently unavailable`);

    let unit = effectiveBasePrice(item, branchItem);
    let variantName: string | null = null;
    if (item.variants.length > 0) {
      const variant = line.variantId ? item.variants.find((v) => v.id === line.variantId) : item.variants.find((v) => v.isDefault);
      if (!variant) return issue("VARIANT_INVALID", `Choose a valid option for ${item.name}`);
      unit += variant.priceDeltaMinor;
      variantName = variant.name;
    } else if (line.variantId) {
      return issue("VARIANT_INVALID", `${item.name} has no size options`);
    }

    const chosen = new Set(line.modifierOptionIds);
    if (chosen.size !== line.modifierOptionIds.length) return issue("MODIFIER_INVALID", "Duplicate add-on selected");
    const modifiers: QuoteLine["modifiers"] = [];
    const accounted = new Set<string>();
    for (const groupId of item.modifierGroupIds) {
      const group = menu.groups.get(groupId);
      if (!group || group.retiredAt) continue;
      const picked = group.options.filter((o) => chosen.has(o.id));
      picked.forEach((o) => accounted.add(o.id));
      if (picked.length < group.minSelect || picked.length > group.maxSelect) {
        const range = group.minSelect === group.maxSelect ? `${group.minSelect}` : `${group.minSelect}–${group.maxSelect}`;
        return issue("MODIFIER_COUNT", `${item.name}: choose ${range} from “${group.name}”`);
      }
      for (const o of picked) {
        if (!o.isAvailable) return issue("MODIFIER_UNAVAILABLE", `${o.name} is unavailable`);
        modifiers.push({ id: "", optionId: o.id, groupName: group.name, optionName: o.name, priceDeltaMinor: o.priceDeltaMinor });
        unit += o.priceDeltaMinor;
      }
    }
    if (accounted.size !== chosen.size) return issue("MODIFIER_INVALID", `An add-on does not belong to ${item.name}`);

    assertMinor(unit);
    priced.push({
      available: true,
      menuItemId: item.id,
      nameSnapshot: item.name,
      variantId: item.variants.length ? (line.variantId ?? item.variants.find((v) => v.isDefault)!.id) : null,
      variantName,
      unitPriceMinor: unit,
      quantity: line.quantity,
      lineTotalMinor: unit * line.quantity,
      notes: line.notes,
      stationId: item.stationId,
      modifiers,
    });
  });

  if (issues.length) {
    const unavailable = issues.some((i) => i.code === "ITEM_UNAVAILABLE" || i.code === "ITEM_NOT_FOUND" || i.code === "MODIFIER_UNAVAILABLE");
    throw new DomainError(unavailable ? "ITEM_UNAVAILABLE" : "VALIDATION_FAILED", issues[0].message, { lines: issues });
  }

  const subtotalMinor = priced.reduce((sum, l) => sum + l.lineTotalMinor, 0);
  const discountMinor = 0; // discounts are out of MVP scope (assumption A3)
  const serviceChargeMinor = fulfillmentType === "DINE_IN" ? applyBps(subtotalMinor - discountMinor, branch.serviceChargeBps) : 0;
  // Assumption A3: tax-exclusive prices; tax on (subtotal − discount + service charge); delivery fee untaxed.
  const taxMinor = applyBps(subtotalMinor - discountMinor + serviceChargeMinor, branch.taxRateBps);
  const deliveryFeeMinor = fulfillmentType === "DELIVERY" ? branch.deliveryFeeMinor : 0;
  const totalMinor = subtotalMinor - discountMinor + serviceChargeMinor + taxMinor + deliveryFeeMinor;

  return {
    currency,
    fulfillmentType,
    lines: priced,
    subtotalMinor,
    discountMinor,
    serviceChargeMinor,
    taxMinor,
    deliveryFeeMinor,
    totalMinor,
    taxRateBps: branch.taxRateBps,
    serviceChargeBps: fulfillmentType === "DINE_IN" ? branch.serviceChargeBps : 0,
  };
}
