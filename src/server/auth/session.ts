import type { DataStore } from "@/server/store/types";
import type { PublicUser, User } from "@/types/domain";
import { randomToken, sha256 } from "@/server/crypto";
import type { Actor } from "./actor";

// Opaque server-side sessions (ADR-0003). The cookie holds a random token;
// only its SHA-256 is stored.

export const SESSION_COOKIE = "rp_session";
export const TENANT_COOKIE = "rp_tenant";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

export function toPublicUser(u: User): PublicUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, ...rest } = u;
  return rest;
}

export async function createSession(store: DataStore, userId: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  await store.createSession({ userId, tokenHash: sha256(token), expiresAt, lastSeenAt: now.toISOString(), createdAt: now.toISOString() });
  return { token, expiresAt };
}

export async function destroySession(store: DataStore, token: string): Promise<void> {
  const session = await store.getSessionByTokenHash(sha256(token));
  if (session) await store.deleteSession(session.id);
}

/**
 * Resolve the actor for a session token. Returns null for unknown/expired
 * sessions, disabled users, or users without an active membership.
 */
export async function resolveActor(store: DataStore, token: string | undefined, preferredTenantId?: string): Promise<Actor | null> {
  if (!token || token.length > 200) return null;
  const session = await store.getSessionByTokenHash(sha256(token));
  if (!session) return null;
  const now = Date.now();
  if (new Date(session.expiresAt).getTime() <= now) {
    await store.deleteSession(session.id);
    return null;
  }
  const user = await store.getUserById(session.userId);
  if (!user || user.status !== "ACTIVE") return null;

  if (now - new Date(session.lastSeenAt).getTime() > TOUCH_INTERVAL_MS) {
    await store.touchSession(session.id, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString());
  }

  const publicUser = toPublicUser(user);
  if (user.isPlatformAdmin) return { kind: "platform", user: publicUser, sessionId: session.id };

  const memberships = (await store.listMembershipsForUser(user.id)).filter((m) => m.status === "ACTIVE");
  const tenants = (await Promise.all(memberships.map((m) => store.getTenant(m.tenantId)))).map((t, i) => ({ t, m: memberships[i] }));
  const usable = tenants.filter((x): x is { t: NonNullable<typeof x.t>; m: (typeof memberships)[number] } => !!x.t && x.t.status !== "SUSPENDED");
  if (usable.length === 0) return null;
  const chosen = usable.find((x) => x.t.id === preferredTenantId) ?? usable[0];

  return {
    kind: "staff",
    user: publicUser,
    sessionId: session.id,
    tenant: chosen.t,
    membership: chosen.m,
    role: chosen.m.role,
    branchScope: chosen.m.role === "OWNER" ? "ALL" : chosen.m.branchIds,
    otherTenants: usable.filter((x) => x !== chosen).map((x) => ({ id: x.t.id, name: x.t.name, role: x.m.role })),
  };
}
