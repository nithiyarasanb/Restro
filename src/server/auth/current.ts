import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getRequestStore } from "@/server/store/request";
import { homePathFor, type Permission } from "@/lib/permissions";
import { can, type Actor, type PlatformActor, type StaffActor } from "./actor";
import { resolveActor, SESSION_COOKIE, TENANT_COOKIE } from "./session";

// Server Component helpers. Reading cookies makes the caller dynamic, so
// callers must sit inside a <Suspense> boundary (Cache Components).

export const getCurrentActor = cache(async (): Promise<Actor | null> => {
  const jar = await cookies();
  const store = await getRequestStore();
  return resolveActor(store, jar.get(SESSION_COOKIE)?.value, jar.get(TENANT_COOKIE)?.value);
});

function homeFor(actor: Actor): string {
  return actor.kind === "platform" ? "/platform" : homePathFor(actor.role);
}

/** Staff page guard: redirects to login, or to the user's home if not permitted. */
export async function requireStaffPage(permission: Permission | Permission[], nextPath: string): Promise<StaffActor> {
  const actor = await getCurrentActor();
  if (!actor) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (actor.kind !== "staff") redirect(homeFor(actor));
  const perms = Array.isArray(permission) ? permission : [permission];
  if (!perms.some((p) => can(actor, p))) redirect(`${homeFor(actor)}?denied=1`);
  return actor;
}

export async function requirePlatformPage(nextPath: string): Promise<PlatformActor> {
  const actor = await getCurrentActor();
  if (!actor) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (actor.kind !== "platform") redirect(`${homeFor(actor)}?denied=1`);
  return actor;
}
