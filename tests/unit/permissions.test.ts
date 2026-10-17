import { describe, expect, it } from "vitest";
import { invitableRoles, roleHas, type Permission } from "@/lib/permissions";
import type { Role } from "@/types/domain";

// Role matrix (docs/01 §2). Every cell is asserted so a change is deliberate.
const expected: Record<Role, Permission[]> = {
  PLATFORM_ADMIN: ["platform.manage", "audit.view"],
  OWNER: [
    "tenant.settings",
    "branch.manage",
    "branch.settings",
    "staff.manage",
    "menu.manage",
    "menu.availability",
    "tables.manage",
    "orders.view",
    "orders.cancel",
    "orders.handover",
    "kitchen.operate",
    "delivery.assign",
    "payments.refund",
    "payments.configure",
    "reports.view",
    "audit.view",
  ],
  BRANCH_MANAGER: [
    "branch.settings",
    "staff.manage",
    "menu.availability",
    "tables.manage",
    "orders.view",
    "orders.cancel",
    "orders.handover",
    "kitchen.operate",
    "delivery.assign",
    "payments.refund",
    "reports.view",
  ],
  CASHIER: ["orders.view", "orders.handover"],
  KITCHEN: ["orders.view", "kitchen.operate"],
  RUNNER: ["delivery.run"],
};
const ALL: Permission[] = [...new Set(Object.values(expected).flat()), "delivery.run"];

describe("role matrix", () => {
  for (const [role, perms] of Object.entries(expected) as Array<[Role, Permission[]]>) {
    it(`${role} has exactly its permissions`, () => {
      for (const p of ALL) expect(roleHas(role, p), `${role} ${p}`).toBe(perms.includes(p));
    });
  }
  it("limits who can invite whom (A9)", () => {
    expect(invitableRoles("BRANCH_MANAGER")).toEqual(["CASHIER", "KITCHEN", "RUNNER"]);
    expect(invitableRoles("KITCHEN")).toEqual([]);
    expect(invitableRoles("OWNER")).toContain("OWNER");
  });
});
