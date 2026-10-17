import { describe, expect, it } from "vitest";
import { availableActions, canApply, findTransition, TRANSITIONS } from "@/lib/order-states";
import { ORDER_STATUSES } from "@/types/domain";

describe("order state machine (FR-06, DG §6)", () => {
  it("only offers fulfilment-appropriate handover actions", () => {
    expect(availableActions("READY", "DINE_IN").map((a) => a.action)).toEqual(["serve"]);
    expect(availableActions("READY", "TAKEAWAY").map((a) => a.action)).toEqual(["pickup"]);
    expect(availableActions("READY", "DELIVERY").map((a) => a.action)).toEqual(["dispatch"]);
  });

  it("never exposes the SYSTEM confirm transition to staff", () => {
    for (const s of ORDER_STATUSES)
      for (const f of ["DINE_IN", "TAKEAWAY", "DELIVERY"] as const) expect(availableActions(s, f).some((a) => a.action === "confirm")).toBe(false);
  });

  it("follows the base path and allows no transitions out of terminal states", () => {
    expect(canApply(findTransition("accept"), "CONFIRMED", "DINE_IN")).toBe(true);
    expect(canApply(findTransition("accept"), "PENDING_PAYMENT", "DINE_IN")).toBe(false);
    expect(canApply(findTransition("ready"), "ACCEPTED", "DINE_IN")).toBe(false);
    expect(canApply(findTransition("serve"), "READY", "TAKEAWAY")).toBe(false);
    for (const terminal of ["COMPLETED", "REJECTED", "CANCELLED", "DELIVERY_FAILED"] as const) expect(availableActions(terminal, "DINE_IN")).toEqual([]);
  });

  it("cannot cancel once food is ready; reasons are required for exceptions", () => {
    expect(canApply(findTransition("cancel"), "READY", "DINE_IN")).toBe(false);
    expect(
      TRANSITIONS.filter((t) => t.reasonRequired)
        .map((t) => t.action)
        .sort(),
    ).toEqual(["cancel", "fail_delivery", "reject"]);
  });
});
