import { NextResponse } from "next/server";
import { api } from "@/server/http/api";
import { loginSchema } from "@/lib/validation";
import { login, sessionView } from "@/server/services/identity";
import { resolveActor } from "@/server/auth/session";
import { setSessionCookie } from "@/server/http/cookies";

export const POST = api(
  async ({ store, body, clientKey }) => {
    const input = await body(loginSchema);
    const session = await login(store, input, clientKey);
    const actor = await resolveActor(store, session.token);
    if (!actor) return NextResponse.json({ code: "FORBIDDEN", message: "Your account has no active restaurant access" }, { status: 403 });
    const res = NextResponse.json(sessionView(actor));
    setSessionCookie(res, session.token, session.expiresAt);
    return res;
  },
  // Throttled per email and client inside login() (LOGIN_RATE_LIMIT).
  { rateLimitPerMinute: 0 },
);
