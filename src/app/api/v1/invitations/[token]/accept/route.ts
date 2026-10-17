import { NextResponse } from "next/server";
import { api } from "@/server/http/api";
import { acceptInviteSchema } from "@/lib/validation";
import { acceptInvitation } from "@/server/services/identity";
import { setSessionCookie, setTenantCookie } from "@/server/http/cookies";

export const POST = api<{ token: string }>(
  async ({ store, params, body, rawBody, clientKey }) => {
    const raw = await rawBody();
    // Existing accounts accept with an empty body; new accounts send name + password.
    const input = raw && raw !== "{}" ? await body(acceptInviteSchema) : null;
    const result = await acceptInvitation(store, params.token, input, clientKey);
    const res = NextResponse.json({ home: result.home });
    setSessionCookie(res, result.token, result.expiresAt);
    setTenantCookie(res, result.tenantId);
    return res;
  },
  { rateLimitPerMinute: 20 },
);
