import { NextResponse } from "next/server";
import { z } from "zod";
import { api, readSessionToken } from "@/server/http/api";
import { requireStaff } from "@/server/auth/actor";
import { resolveActor } from "@/server/auth/session";
import { DomainError } from "@/server/errors";
import { sessionView } from "@/server/services/identity";
import { setTenantCookie } from "@/server/http/cookies";

export const POST = api(async ({ store, actor, body, req }) => {
  requireStaff(actor);
  const { tenantId } = await body(z.object({ tenantId: z.uuid() }));
  const next = await resolveActor(store, readSessionToken(req), tenantId);
  if (!next || next.kind !== "staff" || next.tenant.id !== tenantId) throw new DomainError("NOT_FOUND", "Restaurant not found");
  const res = NextResponse.json(sessionView(next));
  setTenantCookie(res, tenantId);
  return res;
});
