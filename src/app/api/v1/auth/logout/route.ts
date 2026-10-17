import { NextResponse } from "next/server";
import { api, readSessionToken } from "@/server/http/api";
import { destroySession } from "@/server/auth/session";
import { clearSessionCookies } from "@/server/http/cookies";

export const POST = api(async ({ store, req }) => {
  const token = readSessionToken(req);
  if (token) await destroySession(store, token);
  const res = new NextResponse(null, { status: 204 });
  clearSessionCookies(res);
  return res;
});
