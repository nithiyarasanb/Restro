import { z, type ZodType } from "zod";
import * as v from "@/lib/validation";

// OpenAPI 3.1 document generated from the same Zod schemas the handlers use,
// so the contract cannot drift from validation (NFR-10).

type Method = "get" | "post" | "put" | "patch" | "delete";
interface Op {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  auth: "none" | "session" | "order-token" | "signature";
  body?: ZodType;
  query?: ZodType;
  idempotent?: boolean;
  responses?: Record<string, string>;
}

const ops: Op[] = [
  { method: "post", path: "/auth/login", tag: "Auth", summary: "Sign in (sets HTTP-only session cookie)", auth: "none", body: v.loginSchema },
  { method: "post", path: "/auth/logout", tag: "Auth", summary: "Sign out", auth: "session" },
  { method: "get", path: "/auth/session", tag: "Auth", summary: "Current session, role, tenant and permissions", auth: "session" },
  { method: "post", path: "/auth/switch-tenant", tag: "Auth", summary: "Switch active restaurant", auth: "session", body: z.object({ tenantId: z.uuid() }) },
  { method: "get", path: "/invitations/{token}", tag: "Auth", summary: "Preview a staff invitation", auth: "none" },
  { method: "post", path: "/invitations/{token}/accept", tag: "Auth", summary: "Accept invitation (single use)", auth: "none", body: v.acceptInviteSchema },

  { method: "get", path: "/public/restaurants/{slug}", tag: "Public", summary: "Restaurant and live branches", auth: "none" },
  { method: "get", path: "/public/restaurants/{slug}/branches/{branchId}/menu", tag: "Public", summary: "Branch menu (takeaway/delivery)", auth: "none" },
  { method: "get", path: "/public/qr/{ref}", tag: "Public", summary: "Resolve table QR → context and menu", auth: "none" },
  {
    method: "post",
    path: "/public/quotes",
    tag: "Checkout",
    summary: "Server-calculated quote (client totals are never accepted)",
    auth: "none",
    body: v.quoteRequestSchema,
  },
  {
    method: "post",
    path: "/public/orders",
    tag: "Checkout",
    summary: "Create order (PENDING_PAYMENT)",
    auth: "none",
    body: v.placeOrderSchema,
    idempotent: true,
    responses: { "201": "Created", "200": "Idempotent replay" },
  },
  { method: "get", path: "/public/orders/{id}", tag: "Checkout", summary: "Customer order status (?t=order token)", auth: "order-token" },
  {
    method: "post",
    path: "/public/orders/{id}/payment-intents",
    tag: "Payments",
    summary: "Start a hosted payment",
    auth: "order-token",
    body: z.object({ token: z.string() }),
    idempotent: true,
  },
  {
    method: "post",
    path: "/webhooks/payments/{provider}",
    tag: "Payments",
    summary: "Provider webhook (signature over raw body)",
    auth: "signature",
    responses: { "200": "Processed / duplicate / rejected-for-review", "401": "Invalid signature" },
  },

  { method: "get", path: "/orders", tag: "Orders", summary: "List orders (filter + paginate)", auth: "session", query: v.orderListQuerySchema },
  { method: "get", path: "/orders/{id}", tag: "Orders", summary: "Order detail with history, payments, refunds, delivery", auth: "session" },
  {
    method: "post",
    path: "/orders/{id}/transitions",
    tag: "Orders",
    summary: "Guarded state transition (409 if stale)",
    auth: "session",
    body: v.transitionSchema,
    responses: { "200": "Updated", "409": "Stale version", "422": "Invalid transition" },
  },
  {
    method: "post",
    path: "/orders/{id}/refunds",
    tag: "Payments",
    summary: "Refund (full or partial)",
    auth: "session",
    body: v.refundSchema,
    idempotent: true,
  },
  { method: "post", path: "/refunds/{id}/retry", tag: "Payments", summary: "Retry a failed refund", auth: "session" },
  { method: "get", path: "/payments", tag: "Payments", summary: "Payment connection, attempts, refunds, webhooks", auth: "session" },
  { method: "get", path: "/payments/reconciliation", tag: "Payments", summary: "Reconciliation status", auth: "session" },
  { method: "post", path: "/payments/reconciliation/run", tag: "Payments", summary: "Run reconciliation now", auth: "session" },
  { method: "get", path: "/counter", tag: "Orders", summary: "Front-of-house board", auth: "session" },

  { method: "get", path: "/branches/{id}/kitchen/queue", tag: "Kitchen", summary: "Kitchen queue snapshot", auth: "session" },
  {
    method: "post",
    path: "/kitchen/tickets/{orderId}/reject",
    tag: "Kitchen",
    summary: "Reject with reason",
    auth: "session",
    body: z.object({ reason: z.string(), expectedVersion: z.int() }),
  },

  { method: "post", path: "/orders/{id}/delivery-assignments", tag: "Fulfillment", summary: "Assign a runner", auth: "session", body: v.deliveryAssignSchema },
  { method: "get", path: "/me/delivery-jobs", tag: "Fulfillment", summary: "My assigned delivery jobs", auth: "session" },
  {
    method: "post",
    path: "/delivery-jobs/{id}/events",
    tag: "Fulfillment",
    summary: "Picked up / delivered / failed",
    auth: "session",
    body: v.deliveryEventSchema,
  },

  { method: "get", path: "/branches", tag: "Tenancy", summary: "Branches in scope", auth: "session" },
  { method: "post", path: "/branches", tag: "Tenancy", summary: "Create branch", auth: "session", body: v.branchSchema },
  { method: "patch", path: "/branches/{id}", tag: "Tenancy", summary: "Update branch settings", auth: "session", body: v.branchSchema },
  {
    method: "post",
    path: "/branches/{id}/live",
    tag: "Tenancy",
    summary: "Go live / take offline (go-live gate)",
    auth: "session",
    body: z.object({ live: z.boolean() }),
  },
  { method: "get", path: "/tenant", tag: "Tenancy", summary: "Current tenant", auth: "session" },
  { method: "patch", path: "/tenant", tag: "Tenancy", summary: "Update tenant settings", auth: "session", body: v.tenantSettingsSchema },
  { method: "get", path: "/audit", tag: "Tenancy", summary: "Audit log", auth: "session" },

  { method: "get", path: "/menu", tag: "Catalog", summary: "Admin menu (categories, items, modifiers, branch overrides)", auth: "session" },
  { method: "post", path: "/menu/categories", tag: "Catalog", summary: "Create category", auth: "session", body: v.categorySchema },
  { method: "patch", path: "/menu/categories/{id}", tag: "Catalog", summary: "Update / retire category", auth: "session", body: v.categorySchema.partial() },
  { method: "post", path: "/menu/items", tag: "Catalog", summary: "Create item", auth: "session", body: v.menuItemSchema },
  { method: "put", path: "/menu/items/{id}", tag: "Catalog", summary: "Update item", auth: "session", body: v.menuItemSchema },
  {
    method: "post",
    path: "/menu/items/{id}/retire",
    tag: "Catalog",
    summary: "Retire (soft delete) or restore",
    auth: "session",
    body: z.object({ retired: z.boolean() }),
  },
  { method: "post", path: "/menu/modifier-groups", tag: "Catalog", summary: "Create modifier group", auth: "session", body: v.modifierGroupSchema },
  { method: "put", path: "/menu/modifier-groups/{id}", tag: "Catalog", summary: "Update modifier group", auth: "session", body: v.modifierGroupSchema },
  {
    method: "patch",
    path: "/branches/{id}/menu-items/{itemId}",
    tag: "Catalog",
    summary: "Branch availability / price override",
    auth: "session",
    body: v.branchMenuItemSchema,
  },
  { method: "post", path: "/files", tag: "Catalog", summary: "Upload menu image (multipart, ≤2 MB, PNG/JPEG/WebP)", auth: "session" },

  { method: "get", path: "/tables", tag: "Tables", summary: "Tables in scope", auth: "session" },
  { method: "post", path: "/branches/{id}/tables", tag: "Tables", summary: "Create table (new opaque QR ref)", auth: "session", body: v.tableSchema },
  { method: "patch", path: "/tables/{id}", tag: "Tables", summary: "Update / disable table", auth: "session", body: v.tableSchema.partial() },
  { method: "post", path: "/tables/{id}/qr/rotate", tag: "Tables", summary: "Rotate QR (old code stops working)", auth: "session" },
  { method: "get", path: "/tables/{id}/qr", tag: "Tables", summary: "QR code SVG", auth: "session" },

  { method: "get", path: "/staff", tag: "Staff", summary: "Members and invitations", auth: "session" },
  { method: "post", path: "/staff/invitations", tag: "Staff", summary: "Invite staff", auth: "session", body: v.inviteSchema },
  { method: "delete", path: "/staff/invitations/{id}", tag: "Staff", summary: "Revoke invitation", auth: "session" },
  {
    method: "patch",
    path: "/staff/memberships/{id}",
    tag: "Staff",
    summary: "Change role, branches or disable",
    auth: "session",
    body: v.membershipUpdateSchema,
  },

  { method: "get", path: "/reports/overview", tag: "Reports", summary: "Today vs same day last week", auth: "session" },
  { method: "get", path: "/reports/sales", tag: "Reports", summary: "Sales by currency, day, hour, item, status", auth: "session", query: v.reportQuerySchema },
  {
    method: "get",
    path: "/reports/prep-times",
    tag: "Reports",
    summary: "Average accept / prep / handover times",
    auth: "session",
    query: v.reportQuerySchema,
  },
  { method: "get", path: "/reports/payments", tag: "Reports", summary: "Payment success / failure and refunds", auth: "session", query: v.reportQuerySchema },

  { method: "get", path: "/platform/tenants", tag: "Platform", summary: "Tenants with stats", auth: "session" },
  {
    method: "post",
    path: "/platform/tenants",
    tag: "Platform",
    summary: "Onboard tenant (+ branch + owner invitation)",
    auth: "session",
    body: v.onboardTenantSchema,
  },
  { method: "get", path: "/platform/tenants/{id}", tag: "Platform", summary: "Tenant detail", auth: "session" },
  {
    method: "patch",
    path: "/platform/tenants/{id}",
    tag: "Platform",
    summary: "Suspend / activate / entitlements",
    auth: "session",
    body: v.tenantPlatformUpdateSchema,
  },
  {
    method: "post",
    path: "/platform/tenants/{id}/payment-connection/activate",
    tag: "Platform",
    summary: "Activate (mock) payment connection",
    auth: "session",
  },
  { method: "get", path: "/platform/audit", tag: "Platform", summary: "Platform-wide audit log", auth: "session" },

  { method: "get", path: "/stream", tag: "Realtime", summary: "Server-Sent Events (channel=kitchen|orders|order|runner)", auth: "session" },
  { method: "get", path: "/health", tag: "Ops", summary: "Liveness", auth: "none" },
  { method: "get", path: "/ready", tag: "Ops", summary: "Readiness (data source reachable)", auth: "none" },
];

const errorSchema = {
  type: "object",
  required: ["code", "message", "requestId"],
  properties: { code: { type: "string" }, message: { type: "string" }, requestId: { type: "string" }, details: {} },
};

function jsonSchema(schema: ZodType) {
  return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
}

export function buildOpenApi(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of ops) {
    const params = [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    if (op.idempotent) params.push({ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } });
    if (op.query) {
      const qs = jsonSchema(op.query) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, schema] of Object.entries(qs.properties ?? {}))
        params.push({ name, in: "query", required: qs.required?.includes(name) ?? false, schema: schema as { type: string } });
    }
    const responses: Record<string, unknown> = {};
    for (const [code, description] of Object.entries(op.responses ?? { "200": "OK" })) responses[code] = { description };
    responses.default = { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
    (paths[op.path] ??= {})[op.method] = {
      tags: [op.tag],
      summary: op.summary,
      security: op.auth === "session" ? [{ session: [] }, { bearer: [] }] : [],
      ...(op.auth === "order-token" && { description: "Requires the order access token returned at order creation." }),
      ...(op.auth === "signature" && { description: "Provider signature header verified against the raw request body." }),
      parameters: params,
      ...(op.body && { requestBody: { required: true, content: { "application/json": { schema: jsonSchema(op.body) } } } }),
      responses,
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Restaurant Platform API",
      version: "1.0.0",
      description: "Multi-tenant ordering, payments and kitchen operations. Money is integer minor units with an ISO 4217 currency.",
    },
    servers: [{ url: `${serverUrl}/api/v1` }],
    components: {
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: "rp_session" },
        bearer: { type: "http", scheme: "bearer", description: "Same opaque session token, for non-browser clients" },
      },
      schemas: { Error: errorSchema },
    },
    paths,
  };
}
