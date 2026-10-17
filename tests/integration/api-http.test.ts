import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { seededMemoryStore, DEMO } from "../support/fixtures";
import { createSession } from "@/server/auth/session";
import { DEMO_PASSWORD } from "@/server/store/demo-constants";
import { resetRateLimits } from "@/server/http/rate-limit";

// Route handlers exercised end to end (wrapper + guards + services) without a
// running server. `connection()` only works inside Next's request scope.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const BASE = "http://localhost:3000";
const ctx = <P>(params: P) => ({ params: Promise.resolve(params) });
function req(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {}) {
  return new NextRequest(`${BASE}/api/v1${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...init.headers },
    body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
}

let ownerCookie: string;
let harbourCookie: string;

beforeAll(async () => {
  const { store } = await seededMemoryStore();
  (globalThis as unknown as { __rpStore?: Promise<unknown> }).__rpStore = Promise.resolve(store);
  resetRateLimits();
  const owner = await store.getUserByEmail(DEMO.users.owner);
  const harbour = await store.getUserByEmail(DEMO.users.harbourOwner);
  ownerCookie = `rp_session=${(await createSession(store, owner!.id)).token}`;
  harbourCookie = `rp_session=${(await createSession(store, harbour!.id)).token}`;
});

describe("HTTP API contract", () => {
  it("login sets an HttpOnly SameSite session cookie and returns the session view", async () => {
    const { POST } = await import("@/app/api/v1/auth/login/route");
    const res = await POST(req("/auth/login", { method: "POST", body: { email: DEMO.users.kitchen, password: DEMO_PASSWORD } }), ctx({}));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/rp_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(await res.json()).toMatchObject({ role: "KITCHEN", home: "/kitchen" });
  });

  it("errors use {code, message, requestId} and echo x-request-id", async () => {
    const { POST } = await import("@/app/api/v1/auth/login/route");
    const res = await POST(
      req("/auth/login", { method: "POST", body: { email: DEMO.users.kitchen, password: "bad" }, headers: { "x-request-id": "req-123" } }),
      ctx({}),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("x-request-id")).toBe("req-123");
    expect(await res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Email or password is incorrect", requestId: "req-123" });
  });

  it("validation failures return 422 with field issues", async () => {
    const { POST } = await import("@/app/api/v1/public/quotes/route");
    const res = await POST(
      req("/public/quotes", { method: "POST", body: { context: { kind: "table", qrRef: "t_x" }, fulfillmentType: "DINE_IN", lines: [] } }),
      ctx({}),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.details.issues.length).toBeGreaterThan(0);
  });

  it("rejects malformed JSON and oversized bodies", async () => {
    const { POST } = await import("@/app/api/v1/public/quotes/route");
    expect((await POST(req("/public/quotes", { method: "POST", raw: "{not json" }), ctx({}))).status).toBe(422);
    expect((await POST(req("/public/quotes", { method: "POST", raw: JSON.stringify({ pad: "x".repeat(70_000) }) }), ctx({}))).status).toBe(413);
  });

  it("order creation requires an Idempotency-Key header", async () => {
    const { POST } = await import("@/app/api/v1/public/orders/route");
    const res = await POST(req("/public/orders", { method: "POST", body: {} }), ctx({}));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("staff endpoints require a session (401) and the right tenant", async () => {
    const { GET } = await import("@/app/api/v1/orders/route");
    expect((await GET(req("/orders"), ctx({}))).status).toBe(401);
    const ok = await GET(req("/orders", { headers: { cookie: ownerCookie } }), ctx({}));
    expect(ok.status).toBe(200);
    const detail = await import("@/app/api/v1/orders/[id]/route");
    expect((await detail.GET(req(`/orders/${DEMO.liveOrderId}`, { headers: { cookie: harbourCookie } }), ctx({ id: DEMO.liveOrderId }))).status).toBe(404);
  });

  it("restaurant roles get 403 on /platform/*", async () => {
    const { GET } = await import("@/app/api/v1/platform/tenants/route");
    expect((await GET(req("/platform/tenants", { headers: { cookie: ownerCookie } }), ctx({}))).status).toBe(403);
  });

  it("cookie-authenticated mutations from another origin are rejected (CSRF)", async () => {
    const { POST } = await import("@/app/api/v1/orders/[id]/transitions/route");
    const body = { action: "accept", expectedVersion: 1 };
    const evil = await POST(
      req(`/orders/${DEMO.liveOrderId}/transitions`, { method: "POST", body, headers: { cookie: ownerCookie, origin: "https://evil.example" } }),
      ctx({ id: DEMO.liveOrderId }),
    );
    expect(evil.status).toBe(403);
    expect((await evil.json()).code).toBe("CSRF_REJECTED");
    const noOrigin = await POST(
      req(`/orders/${DEMO.liveOrderId}/transitions`, { method: "POST", body, headers: { cookie: ownerCookie } }),
      ctx({ id: DEMO.liveOrderId }),
    );
    expect(noOrigin.status).toBe(403);
    // Same origin passes CSRF and reaches the state machine (stale version → 409).
    const same = await POST(
      req(`/orders/${DEMO.liveOrderId}/transitions`, { method: "POST", body, headers: { cookie: ownerCookie, origin: BASE } }),
      ctx({ id: DEMO.liveOrderId }),
    );
    expect([409, 422]).toContain(same.status);
  });

  it("webhooks with a bad signature get 401 and are not CSRF-checked", async () => {
    const { POST } = await import("@/app/api/v1/webhooks/payments/[provider]/route");
    const res = await POST(
      req("/webhooks/payments/mock", { method: "POST", raw: '{"id":"evt_1"}', headers: { "x-mock-signature": "t=1,v1=00" } }),
      ctx({ provider: "mock" }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("INVALID_SIGNATURE");
  });

  it("serves an OpenAPI 3.1 document generated from the validation schemas", async () => {
    const { GET } = await import("@/app/api/v1/openapi.json/route");
    const doc = await (await GET(req("/openapi.json"), ctx({}))).json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/public/orders"].post.parameters.some((p: { name: string }) => p.name === "Idempotency-Key")).toBe(true);
    expect(doc.paths["/orders/{id}/transitions"].post.requestBody.content["application/json"].schema.properties.action.enum).toContain("accept");
  });
});
