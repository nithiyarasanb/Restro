import type { NextResponse } from "next/server";
import { getConfig } from "@/server/config";
import { SESSION_COOKIE, TENANT_COOKIE } from "@/server/auth/session";

export function setSessionCookie(res: NextResponse, token: string, expiresAt: string) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: getConfig().cookieSecure,
    path: "/",
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookies(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: getConfig().cookieSecure, path: "/", maxAge: 0 });
  res.cookies.set(TENANT_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: getConfig().cookieSecure, path: "/", maxAge: 0 });
}

export function setTenantCookie(res: NextResponse, tenantId: string) {
  res.cookies.set(TENANT_COOKIE, tenantId, { httpOnly: true, sameSite: "lax", secure: getConfig().cookieSecure, path: "/", maxAge: 60 * 60 * 24 * 30 });
}
