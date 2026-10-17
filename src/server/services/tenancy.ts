import type { Branch } from "@/types/domain";
import type { TenantDetailView, TenantSummaryView } from "@/types/api";
import type { BranchInput, OnboardTenantInput, TenantSettingsInput } from "@/lib/validation";
import type { DataStore } from "@/server/store/types";
import { UniqueViolationError } from "@/server/store/types";
import { DomainError, notFound } from "@/server/errors";
import { getConfig } from "@/server/config";
import { randomToken, sha256 } from "@/server/crypto";
import { requirePermission, requirePlatform, requireStaff, type Actor } from "@/server/auth/actor";
import { audit, toInvitationView } from "./shared";

// Tenancy & Branches + Platform Operations (FR-01, BR-11).

/** Branches within the actor's scope (any staff role). */
export async function listBranches(store: DataStore, actor: Actor | null): Promise<Branch[]> {
  const staff = requireStaff(actor);
  const all = await store.listBranches(staff.tenant.id);
  return all.filter((b) => staff.branchScope === "ALL" || staff.branchScope.includes(b.id));
}

export async function createBranch(store: DataStore, actor: Actor | null, input: BranchInput) {
  const staff = requirePermission(actor, "branch.manage");
  const existing = await store.listBranches(staff.tenant.id);
  if (existing.length >= staff.tenant.features.maxBranches)
    throw new DomainError("FEATURE_DISABLED", `Your plan allows ${staff.tenant.features.maxBranches} branch(es). Contact support to add more.`);
  if (input.deliveryEnabled && !staff.tenant.features.delivery)
    throw new DomainError("FEATURE_DISABLED", "Delivery is not enabled for your restaurant", { field: "deliveryEnabled" });
  const now = new Date().toISOString();
  const b = await store.createBranch({ ...input, tenantId: staff.tenant.id, isLive: false, orderSeq: 1000, createdAt: now, updatedAt: now });
  await store.createStation({ tenantId: staff.tenant.id, branchId: b.id, name: "Main" });
  await audit(store, staff, { tenantId: staff.tenant.id, action: "branch.created", entityType: "branch", entityId: b.id, meta: { name: b.name } });
  return b;
}

export async function updateBranch(store: DataStore, actor: Actor | null, id: string, input: BranchInput) {
  const staff = requirePermission(actor, "branch.settings", id);
  const before = await store.getBranch(staff.tenant.id, id);
  if (!before) throw notFound("Branch");
  if (input.deliveryEnabled && !staff.tenant.features.delivery)
    throw new DomainError("FEATURE_DISABLED", "Delivery is not enabled for your restaurant", { field: "deliveryEnabled" });
  // Tax and service-charge changes affect pricing: owner only.
  if (staff.role !== "OWNER" && (input.taxRateBps !== before.taxRateBps || input.serviceChargeBps !== before.serviceChargeBps))
    throw new DomainError("FORBIDDEN", "Only the owner can change tax or service charge");
  const b = await store.updateBranch(staff.tenant.id, id, input);
  const changed = (Object.keys(input) as Array<keyof BranchInput>).filter((k) => JSON.stringify(input[k]) !== JSON.stringify(before[k]));
  await audit(store, staff, { tenantId: staff.tenant.id, action: "branch.updated", entityType: "branch", entityId: id, meta: { fields: changed } });
  return b!;
}

/** Go-live gate (BR-11): an active payment connection, a menu and at least one table. */
export async function setBranchLive(store: DataStore, actor: Actor | null, id: string, live: boolean) {
  const staff = requirePermission(actor, "branch.manage");
  const branch = await store.getBranch(staff.tenant.id, id);
  if (!branch) throw notFound("Branch");
  if (live) {
    const [conn, items, tables] = await Promise.all([
      store.getPaymentConnection(staff.tenant.id),
      store.listMenuItems(staff.tenant.id),
      store.listTables(staff.tenant.id, id),
    ]);
    const missing: string[] = [];
    if (!conn || conn.status !== "ACTIVE") missing.push("an active payment connection");
    if (items.length === 0) missing.push("at least one menu item");
    if (!tables.some((t) => t.status === "ACTIVE")) missing.push("at least one active table");
    if (missing.length) throw new DomainError("VALIDATION_FAILED", `Before going live, add ${missing.join(", ")}.`, { missing });
  }
  const b = await store.updateBranch(staff.tenant.id, id, { isLive: live });
  await audit(store, staff, {
    tenantId: staff.tenant.id,
    action: live ? "branch.went_live" : "branch.taken_offline",
    entityType: "branch",
    entityId: id,
    meta: { name: branch.name },
  });
  return b!;
}

export async function updateTenantSettings(store: DataStore, actor: Actor | null, input: TenantSettingsInput) {
  const staff = requirePermission(actor, "tenant.settings");
  const t = await store.updateTenant(staff.tenant.id, input);
  await audit(store, staff, { tenantId: staff.tenant.id, action: "tenant.settings_updated", entityType: "tenant", entityId: staff.tenant.id, meta: input });
  return t!;
}

export async function listAudit(store: DataStore, actor: Actor | null, page: number) {
  const pageSize = 50;
  if (actor?.kind === "platform") {
    const r = await store.listAudit({ tenantId: null, limit: pageSize, offset: (page - 1) * pageSize });
    return { ...r, page, pageSize };
  }
  const staff = requirePermission(actor, "audit.view");
  const r = await store.listAudit({ tenantId: staff.tenant.id, limit: pageSize, offset: (page - 1) * pageSize });
  return { ...r, page, pageSize };
}

// ── Platform operations ───────────────────────────────────────────────────

export async function listTenantSummaries(store: DataStore, actor: Actor | null): Promise<TenantSummaryView[]> {
  requirePlatform(actor);
  const tenants = await store.listTenants();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  return Promise.all(
    tenants.map(async (t) => {
      const [branches, members, orders, conn] = await Promise.all([
        store.listBranches(t.id),
        store.listMemberships(t.id),
        store.listOrders(t.id, { createdFrom: since, offset: 0, limit: 1 }),
        store.getPaymentConnection(t.id),
      ]);
      return {
        ...t,
        branchCount: branches.length,
        liveBranchCount: branches.filter((b) => b.isLive).length,
        staffCount: members.filter((m) => m.status === "ACTIVE").length,
        ordersLast30Days: orders.total,
        paymentConnectionStatus: conn?.status ?? "NONE",
      };
    }),
  );
}

export async function getTenantDetail(store: DataStore, actor: Actor | null, tenantId: string): Promise<TenantDetailView> {
  requirePlatform(actor);
  const tenant = await store.getTenant(tenantId);
  if (!tenant) throw notFound("Tenant");
  const [branches, memberships, invitations, paymentConnection, auditLog] = await Promise.all([
    store.listBranches(tenantId),
    store.listMemberships(tenantId),
    store.listInvitations(tenantId),
    store.getPaymentConnection(tenantId),
    store.listAudit({ tenantId, limit: 15, offset: 0 }),
  ]);
  const users = new Map((await store.getUsersByIds(memberships.map((m) => m.userId))).map((u) => [u.id, u]));
  return {
    tenant,
    branches,
    staff: memberships.map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      name: users.get(m.userId)?.name ?? "",
      email: users.get(m.userId)?.email ?? "",
      role: m.role,
      status: m.status,
      branchIds: m.branchIds,
      createdAt: m.createdAt,
    })),
    invitations: invitations.map((i) => toInvitationView(i)),
    paymentConnection,
    recentAudit: auditLog.items,
  };
}

/** Onboarding (journey A): tenant + first branch + pending payment connection + owner invitation. */
export async function onboardTenant(store: DataStore, actor: Actor | null, input: OnboardTenantInput) {
  const platform = requirePlatform(actor);
  const now = new Date().toISOString();
  const token = randomToken(24);
  try {
    const result = await store.tx(async (tx) => {
      const tenant = await tx.createTenant({
        slug: input.slug,
        name: input.name,
        legalName: null,
        status: "ONBOARDING",
        country: input.country,
        currency: input.currency,
        timezone: input.timezone,
        features: { delivery: false, maxBranches: 1 },
        createdAt: now,
        updatedAt: now,
      });
      const branch = await tx.createBranch({
        tenantId: tenant.id,
        name: input.branchName,
        address: input.branchAddress,
        phone: null,
        timezone: input.timezone,
        taxRateBps: 0,
        serviceChargeBps: 0,
        takeawayEnabled: true,
        deliveryEnabled: false,
        deliveryFeeMinor: 0,
        isLive: false,
        acceptingOrders: true,
        openingHours: [],
        orderSeq: 1000,
        createdAt: now,
        updatedAt: now,
      });
      await tx.createStation({ tenantId: tenant.id, branchId: branch.id, name: "Main" });
      await tx.upsertPaymentConnection({
        tenantId: tenant.id,
        provider: "mock",
        status: "PENDING",
        merchantAccountId: `acct_pending_${tenant.slug}`,
        displayName: "Awaiting provider onboarding",
        createdAt: now,
        updatedAt: now,
      });
      const invitation = await tx.createInvitation({
        tenantId: tenant.id,
        email: input.ownerEmail.toLowerCase(),
        role: "OWNER",
        branchIds: [],
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        acceptedAt: null,
        revokedAt: null,
        invitedByUserId: platform.user.id,
        createdAt: now,
      });
      return { tenant, branch, invitation };
    });
    await audit(store, platform, {
      tenantId: result.tenant.id,
      action: "tenant.created",
      entityType: "tenant",
      entityId: result.tenant.id,
      meta: { name: input.name, slug: input.slug, ownerEmail: input.ownerEmail },
    });
    return { tenant: result.tenant, inviteUrl: new URL(`/invite/${token}`, getConfig().APP_BASE_URL).toString() };
  } catch (e) {
    if (e instanceof UniqueViolationError) throw new DomainError("CONFLICT", "That web address (slug) is already taken", { field: "slug" });
    throw e;
  }
}

export async function updateTenantAsPlatform(
  store: DataStore,
  actor: Actor | null,
  tenantId: string,
  patch: { status?: "ONBOARDING" | "ACTIVE" | "SUSPENDED"; features?: { delivery: boolean; maxBranches: number } },
) {
  const platform = requirePlatform(actor);
  const tenant = await store.updateTenant(tenantId, patch);
  if (!tenant) throw notFound("Tenant");
  await audit(store, platform, {
    tenantId,
    action: patch.status ? `tenant.status_${patch.status.toLowerCase()}` : "tenant.entitlements_updated",
    entityType: "tenant",
    entityId: tenantId,
    meta: patch,
  });
  return tenant;
}

export async function activatePaymentConnection(store: DataStore, actor: Actor | null, tenantId: string) {
  const platform = requirePlatform(actor);
  const tenant = await store.getTenant(tenantId);
  if (!tenant) throw notFound("Tenant");
  const now = new Date().toISOString();
  // Real providers: blocked until launch country/provider is decided (⛔ Q1/Q2). Mock only.
  const conn = await store.upsertPaymentConnection({
    tenantId,
    provider: "mock",
    status: "ACTIVE",
    merchantAccountId: `acct_demo_${tenant.slug}`,
    displayName: "Mock provider (TEST ONLY)",
    createdAt: now,
    updatedAt: now,
  });
  await audit(store, platform, {
    tenantId,
    action: "payment_connection.activated",
    entityType: "payment_connection",
    entityId: conn.id,
    meta: { provider: "mock" },
  });
  return conn;
}
