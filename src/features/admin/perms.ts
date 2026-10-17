import type { Permission } from "@/lib/permissions";

/** Any of these grants access to the restaurant admin console. */
export const ADMIN_PERMS: Permission[] = ["reports.view", "menu.availability", "staff.manage", "tables.manage"];
