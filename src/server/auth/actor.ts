import type { PublicUser, StaffRole, Tenant, TenantMembership } from "@/types/domain";
import { roleHas, type Permission } from "@/lib/permissions";
import { DomainError, forbidden } from "@/server/errors";

// The authenticated principal for a request. Every service call that touches
// tenant data takes an Actor and derives tenant/branch scope from it — never
// from client input.

export interface PlatformActor {
  kind: "platform";
  user: PublicUser;
  sessionId: string;
}

export interface StaffActor {
  kind: "staff";
  user: PublicUser;
  sessionId: string;
  tenant: Tenant;
  membership: TenantMembership;
  role: StaffRole;
  /** "ALL" for owners; explicit branch ids for everyone else. */
  branchScope: "ALL" | string[];
  /** Other tenants this user can switch to. */
  otherTenants: Array<{ id: string; name: string; role: StaffRole }>;
}

export type Actor = PlatformActor | StaffActor;

export function actorLabel(actor: Actor | null): string {
  return actor ? actor.user.email : "anonymous";
}

export function requireStaff(actor: Actor | null): StaffActor {
  if (!actor) throw new DomainError("UNAUTHENTICATED", "Please sign in");
  if (actor.kind !== "staff") throw forbidden("This action is for restaurant staff");
  return actor;
}

export function requirePlatform(actor: Actor | null): PlatformActor {
  if (!actor) throw new DomainError("UNAUTHENTICATED", "Please sign in");
  if (actor.kind !== "platform") throw forbidden("Platform administrators only");
  return actor;
}

export function can(actor: StaffActor, permission: Permission, branchId?: string): boolean {
  if (!roleHas(actor.role, permission)) return false;
  if (branchId && actor.branchScope !== "ALL" && !actor.branchScope.includes(branchId)) return false;
  return true;
}

/** Permission + optional branch scope check. Throws 403. */
export function requirePermission(actor: Actor | null, permission: Permission, branchId?: string): StaffActor {
  const staff = requireStaff(actor);
  if (!roleHas(staff.role, permission)) throw forbidden();
  if (branchId && staff.branchScope !== "ALL" && !staff.branchScope.includes(branchId)) {
    // Same response as a missing branch so scope is not disclosed.
    throw new DomainError("NOT_FOUND", "Branch not found");
  }
  return staff;
}

/** Branch filter for list queries: undefined means all branches of the tenant. */
export function branchFilter(actor: StaffActor, requested?: string): string[] | undefined {
  if (requested) {
    if (actor.branchScope !== "ALL" && !actor.branchScope.includes(requested)) throw new DomainError("NOT_FOUND", "Branch not found");
    return [requested];
  }
  return actor.branchScope === "ALL" ? undefined : actor.branchScope;
}
