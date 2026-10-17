// Role → permission matrix (docs/01-requirements-analysis.md §2).
// Isomorphic so the UI can hide actions, but the server is the only
// enforcement point (BRD §6: "Hiding a button in the UI is not authorization").

import type { Role, StaffRole } from "@/types/domain";

export const PERMISSIONS = [
  "platform.manage",
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
  "delivery.run",
  "payments.refund",
  "payments.configure",
  "reports.view",
  "audit.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, readonly Permission[]> = {
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

export function roleHas(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return MATRIX[role];
}

/** Roles a given inviter may grant (assumption A9). */
export function invitableRoles(role: StaffRole): StaffRole[] {
  if (role === "OWNER") return ["OWNER", "BRANCH_MANAGER", "CASHIER", "KITCHEN", "RUNNER"];
  if (role === "BRANCH_MANAGER") return ["CASHIER", "KITCHEN", "RUNNER"];
  return [];
}

export const ROLE_LABELS: Record<Role, string> = {
  PLATFORM_ADMIN: "Platform admin",
  OWNER: "Owner",
  BRANCH_MANAGER: "Branch manager",
  CASHIER: "Cashier / front of house",
  KITCHEN: "Kitchen staff",
  RUNNER: "Runner / delivery",
};

/** Where each role lands after signing in. */
export function homePathFor(role: Role): string {
  switch (role) {
    case "PLATFORM_ADMIN":
      return "/platform";
    case "KITCHEN":
      return "/kitchen";
    case "CASHIER":
      return "/counter";
    case "RUNNER":
      return "/delivery";
    default:
      return "/admin";
  }
}
