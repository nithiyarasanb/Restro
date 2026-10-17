import type { InvitationView, SessionView, StaffMemberView } from "@/types/api";
import type { AcceptInviteInput, InviteInput } from "@/lib/validation";
import { homePathFor, invitableRoles, permissionsFor } from "@/lib/permissions";
import type { DataStore } from "@/server/store/types";
import { UniqueViolationError } from "@/server/store/types";
import { DomainError, forbidden, notFound } from "@/server/errors";
import { getConfig } from "@/server/config";
import { dummyPasswordHash, hashPassword, randomToken, sha256, verifyPassword } from "@/server/crypto";
import { rateLimit } from "@/server/http/rate-limit";
import { requirePermission, type Actor } from "@/server/auth/actor";
import { createSession, toPublicUser } from "@/server/auth/session";
import { audit, toInvitationView } from "./shared";

// Identity & Access module (DG §4): sign-in, invitations, staff membership.

const INVITE_TTL_MS = 7 * 24 * 3600_000;

export async function login(store: DataStore, input: { email: string; password: string }, clientKey: string) {
  const email = input.email.trim().toLowerCase();
  const limit = getConfig().LOGIN_RATE_LIMIT;
  rateLimit(`login:${clientKey}:${email}`, limit, 15 * 60_000);
  rateLimit(`login-ip:${clientKey}`, limit * 5, 15 * 60_000);
  const user = await store.getUserByEmail(email);
  // Always run bcrypt so response time does not reveal whether the email exists.
  const ok = await verifyPassword(input.password, user?.passwordHash ?? dummyPasswordHash());
  if (!user || !ok || user.status !== "ACTIVE") throw new DomainError("UNAUTHENTICATED", "Email or password is incorrect");
  const session = await createSession(store, user.id);
  await audit(store, null, { tenantId: null, action: "auth.login", entityType: "user", entityId: user.id, meta: { email } });
  return { ...session, user: toPublicUser(user) };
}

export function sessionView(actor: Actor): SessionView {
  if (actor.kind === "platform") {
    return {
      user: { id: actor.user.id, email: actor.user.email, name: actor.user.name },
      kind: "platform",
      role: "PLATFORM_ADMIN",
      tenant: null,
      branchScope: "ALL",
      otherTenants: [],
      permissions: [...permissionsFor("PLATFORM_ADMIN")],
      home: "/platform",
      isDemo: getConfig().isDemo,
    };
  }
  return {
    user: { id: actor.user.id, email: actor.user.email, name: actor.user.name },
    kind: "staff",
    role: actor.role,
    tenant: { id: actor.tenant.id, name: actor.tenant.name, slug: actor.tenant.slug, currency: actor.tenant.currency, features: actor.tenant.features },
    branchScope: actor.branchScope,
    otherTenants: actor.otherTenants,
    permissions: [...permissionsFor(actor.role)],
    home: homePathFor(actor.role),
    isDemo: getConfig().isDemo,
  };
}

export async function listStaff(store: DataStore, actor: Actor | null): Promise<{ members: StaffMemberView[]; invitations: InvitationView[] }> {
  const staff = requirePermission(actor, "staff.manage");
  const [memberships, invitations] = await Promise.all([store.listMemberships(staff.tenant.id), store.listInvitations(staff.tenant.id)]);
  const users = new Map((await store.getUsersByIds(memberships.map((m) => m.userId))).map((u) => [u.id, u]));
  const inScope = (branchIds: string[], role: string) =>
    staff.branchScope === "ALL" || (role !== "OWNER" && branchIds.some((b) => (staff.branchScope as string[]).includes(b)));
  return {
    members: memberships
      .filter((m) => inScope(m.branchIds, m.role))
      .map((m) => ({
        membershipId: m.id,
        userId: m.userId,
        name: users.get(m.userId)?.name ?? "",
        email: users.get(m.userId)?.email ?? "",
        role: m.role,
        status: m.status,
        branchIds: m.branchIds,
        createdAt: m.createdAt,
      })),
    invitations: invitations.filter((i) => inScope(i.branchIds, i.role)).map((i) => toInvitationView(i)),
  };
}

export async function inviteStaff(store: DataStore, actor: Actor | null, input: InviteInput) {
  const staff = requirePermission(actor, "staff.manage");
  if (!invitableRoles(staff.role).includes(input.role)) throw forbidden(`You cannot invite a ${input.role.toLowerCase().replace("_", " ")}`);
  if (input.role !== "OWNER" && input.branchIds.length === 0) throw new DomainError("VALIDATION_FAILED", "Choose at least one branch", { field: "branchIds" });
  const branches = await store.listBranches(staff.tenant.id);
  for (const b of input.branchIds) {
    if (!branches.some((x) => x.id === b)) throw new DomainError("VALIDATION_FAILED", "Unknown branch", { field: "branchIds" });
    if (staff.branchScope !== "ALL" && !staff.branchScope.includes(b)) throw forbidden("You can only invite staff to your own branches");
  }
  const email = input.email.toLowerCase();
  const existingUser = await store.getUserByEmail(email);
  if (existingUser && (await store.listMembershipsForUser(existingUser.id)).some((m) => m.tenantId === staff.tenant.id))
    throw new DomainError("CONFLICT", "This person is already a member of your team", { field: "email" });

  const token = randomToken(24);
  const now = new Date();
  const inv = await store.createInvitation({
    tenantId: staff.tenant.id,
    email,
    role: input.role,
    branchIds: input.role === "OWNER" ? [] : input.branchIds,
    tokenHash: sha256(token),
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
    acceptedAt: null,
    revokedAt: null,
    invitedByUserId: staff.user.id,
    createdAt: now.toISOString(),
  });
  await audit(store, staff, {
    tenantId: staff.tenant.id,
    action: "staff.invited",
    entityType: "invitation",
    entityId: inv.id,
    meta: { email, role: input.role },
  });
  // No email adapter yet (FR-10 "email later"): the link is returned for the inviter to share.
  return { invitation: toInvitationView(inv), inviteUrl: new URL(`/invite/${token}`, getConfig().APP_BASE_URL).toString() };
}

export async function revokeInvitation(store: DataStore, actor: Actor | null, invitationId: string) {
  const staff = requirePermission(actor, "staff.manage");
  const inv = (await store.listInvitations(staff.tenant.id)).find((i) => i.id === invitationId);
  if (!inv || inv.acceptedAt) throw notFound("Invitation");
  await store.updateInvitation(staff.tenant.id, inv.id, { revokedAt: new Date().toISOString() });
  await audit(store, staff, {
    tenantId: staff.tenant.id,
    action: "staff.invitation_revoked",
    entityType: "invitation",
    entityId: inv.id,
    meta: { email: inv.email },
  });
}

async function loadValidInvitation(store: DataStore, token: string) {
  const inv = await store.getInvitationByTokenHash(sha256(token));
  if (!inv) throw notFound("Invitation");
  const view = toInvitationView(inv);
  if (view.status !== "PENDING")
    throw new DomainError(
      "CONFLICT",
      view.status === "ACCEPTED"
        ? "This invitation was already used"
        : view.status === "EXPIRED"
          ? "This invitation has expired"
          : "This invitation was revoked",
    );
  return inv;
}

export async function previewInvitation(store: DataStore, token: string) {
  const inv = await loadValidInvitation(store, token);
  const tenant = await store.getTenant(inv.tenantId);
  const existingUser = await store.getUserByEmail(inv.email);
  return { email: inv.email, role: inv.role, restaurantName: tenant?.name ?? "", existingAccount: !!existingUser };
}

/** Single-use: the invitation is marked accepted in the same transaction as the membership. */
export async function acceptInvitation(store: DataStore, token: string, input: AcceptInviteInput | null, clientKey: string) {
  rateLimit(`invite:${clientKey}`, 20, 15 * 60_000);
  const inv = await loadValidInvitation(store, token);
  const passwordHash = input ? await hashPassword(input.password) : null;
  const result = await store.tx(async (tx) => {
    const fresh = await tx.getInvitationByTokenHash(inv.tokenHash);
    if (!fresh || fresh.acceptedAt || fresh.revokedAt) throw new DomainError("CONFLICT", "This invitation was already used");
    let user = await tx.getUserByEmail(inv.email);
    if (!user) {
      if (!input || !passwordHash) throw new DomainError("VALIDATION_FAILED", "Choose a name and password");
      user = await tx.createUser({
        email: inv.email,
        name: input.name,
        passwordHash,
        isPlatformAdmin: false,
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
      });
    }
    // An existing account keeps its password: the invite link never resets credentials.
    try {
      await tx.createMembership({
        tenantId: inv.tenantId,
        userId: user.id,
        role: inv.role,
        status: "ACTIVE",
        branchIds: inv.branchIds,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      if (e instanceof UniqueViolationError) throw new DomainError("CONFLICT", "You are already a member of this restaurant");
      throw e;
    }
    await tx.updateInvitation(inv.tenantId, inv.id, { acceptedAt: new Date().toISOString() });
    if (inv.role === "OWNER") {
      const tenant = await tx.getTenant(inv.tenantId);
      if (tenant?.status === "ONBOARDING") await tx.updateTenant(tenant.id, { status: "ACTIVE" });
    }
    return user;
  });
  await audit(store, null, {
    tenantId: inv.tenantId,
    action: "staff.invitation_accepted",
    entityType: "invitation",
    entityId: inv.id,
    meta: { email: inv.email, role: inv.role },
  });
  const session = await createSession(store, result.id);
  return { ...session, home: homePathFor(inv.role), tenantId: inv.tenantId };
}

export async function updateMembership(
  store: DataStore,
  actor: Actor | null,
  membershipId: string,
  patch: { role?: InviteInput["role"]; branchIds?: string[]; status?: "ACTIVE" | "DISABLED" },
) {
  const staff = requirePermission(actor, "staff.manage");
  const m = await store.getMembership(staff.tenant.id, membershipId);
  if (!m) throw notFound("Team member");
  if (m.userId === staff.user.id) throw new DomainError("CONFLICT", "You cannot change your own access");
  const manageable = invitableRoles(staff.role);
  if (!manageable.includes(m.role) || (patch.role && !manageable.includes(patch.role))) throw forbidden("You cannot change this team member");
  if (staff.branchScope !== "ALL") {
    const scope = staff.branchScope;
    if (!m.branchIds.some((b) => scope.includes(b))) throw notFound("Team member");
    if (patch.branchIds?.some((b) => !scope.includes(b))) throw forbidden("You can only assign your own branches");
  }
  if (m.role === "OWNER" && patch.status === "DISABLED") {
    const owners = (await store.listMemberships(staff.tenant.id)).filter((x) => x.role === "OWNER" && x.status === "ACTIVE");
    if (owners.length <= 1) throw new DomainError("CONFLICT", "A restaurant must keep at least one active owner");
  }
  const updated = await store.updateMembership(staff.tenant.id, m.id, patch);
  // Disabling access ends existing sessions immediately.
  if (patch.status === "DISABLED") await store.deleteSessionsForUser(m.userId);
  await audit(store, staff, { tenantId: staff.tenant.id, action: "staff.updated", entityType: "membership", entityId: m.id, meta: patch });
  return updated!;
}
