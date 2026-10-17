import "server-only";
import { connection, NextResponse, type NextRequest } from "next/server";
import { z, ZodError, type ZodType } from "zod";
import type { DataStore } from "@/server/store/types";
import { UniqueViolationError } from "@/server/store/types";
import { getStore } from "@/server/store";
import { getConfig } from "@/server/config";
import { DomainError, isDomainError } from "@/server/errors";
import { resolveActor, SESSION_COOKIE, TENANT_COOKIE } from "@/server/auth/session";
import type { Actor } from "@/server/auth/actor";
import { relayOutbox } from "@/server/realtime/outbox";
import { rateLimit } from "./rate-limit";

// Route-handler wrapper (DG §2 request path): request id, CSRF origin check,
// rate limit, payload limit, actor resolution, Zod parsing, error mapping,
// structured logging, and outbox relay after successful mutations.

export interface ApiContext<P> {
  req: NextRequest;
  params: P;
  requestId: string;
  store: DataStore;
  actor: Actor | null;
  clientKey: string;
  origin: string;
  body<S extends ZodType>(schema: S): Promise<z.infer<S>>;
  rawBody(): Promise<string>;
  query<S extends ZodType>(schema: S): z.infer<S>;
  idempotencyKey(): string;
}

export interface ApiOptions {
  /** Max request body in bytes (default 64 KiB). */
  maxBodyBytes?: number;
  /** Requests per minute per client for this route (default 120; 0 disables). */
  rateLimitPerMinute?: number;
  /** Skip the cookie CSRF origin check (server-to-server webhooks only). */
  skipCsrf?: boolean;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export class JsonResponse {
  constructor(
    readonly data: unknown,
    readonly status = 200,
    readonly headers: Record<string, string> = {},
  ) {}
}
export const created = (data: unknown) => new JsonResponse(data, 201);

function clientKeyOf(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

function errorBody(code: string, message: string, requestId: string, details?: unknown) {
  return details === undefined ? { code, message, requestId } : { code, message, requestId, details };
}

export function readSessionToken(req: NextRequest): string | undefined {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return req.cookies.get(SESSION_COOKIE)?.value;
}

export function api<P = Record<string, never>>(
  handler: (ctx: ApiContext<P>) => Promise<unknown>,
  options: ApiOptions = {},
): (req: NextRequest, routeCtx: { params: Promise<P> }) => Promise<Response> {
  return async (req, routeCtx) => {
    await connection(); // always request-time (Cache Components)
    const started = Date.now();
    const requestId = req.headers.get("x-request-id")?.slice(0, 64) || crypto.randomUUID();
    const clientKey = clientKeyOf(req);
    let status = 500;
    let response: Response;
    try {
      const config = getConfig();
      const limit = Math.round((options.rateLimitPerMinute ?? 120) * config.API_RATE_LIMIT_MULTIPLIER);
      if (limit > 0) rateLimit(`api:${clientKey}:${req.nextUrl.pathname}`, limit, 60_000);

      // CSRF: cookie-authenticated mutations must come from our own origin (in addition to SameSite=Lax).
      if (!SAFE_METHODS.has(req.method) && !options.skipCsrf && req.cookies.get(SESSION_COOKIE) && !req.headers.get("authorization")) {
        const origin = req.headers.get("origin");
        const allowed = new Set([req.nextUrl.origin, new URL(config.APP_BASE_URL).origin]);
        if (!origin || !allowed.has(origin)) throw new DomainError("CSRF_REJECTED", "Cross-site request rejected");
      }

      const store = await getStore();
      const actor = await resolveActor(store, readSessionToken(req), req.cookies.get(TENANT_COOKIE)?.value);
      const params = (await routeCtx.params) ?? ({} as P);
      let raw: string | null = null;
      const maxBody = options.maxBodyBytes ?? 64 * 1024;
      const readRaw = async () => {
        if (raw !== null) return raw;
        const declared = Number(req.headers.get("content-length") ?? 0);
        if (declared > maxBody) throw new DomainError("PAYLOAD_TOO_LARGE", "Request body is too large");
        raw = await req.text();
        if (Buffer.byteLength(raw) > maxBody) throw new DomainError("PAYLOAD_TOO_LARGE", "Request body is too large");
        return raw;
      };

      const ctx: ApiContext<P> = {
        req,
        params,
        requestId,
        store,
        actor,
        clientKey,
        origin: req.nextUrl.origin,
        rawBody: readRaw,
        async body(schema) {
          const text = await readRaw();
          let json: unknown;
          try {
            json = text ? JSON.parse(text) : {};
          } catch {
            throw new DomainError("VALIDATION_FAILED", "Request body must be valid JSON");
          }
          return schema.parse(json);
        },
        query(schema) {
          return schema.parse(Object.fromEntries(req.nextUrl.searchParams));
        },
        idempotencyKey() {
          const key = req.headers.get("idempotency-key");
          if (!key) throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", "The Idempotency-Key header is required");
          return key;
        },
      };

      const result = await handler(ctx);
      if (!SAFE_METHODS.has(req.method)) await relayOutbox(store).catch((e) => console.error("[outbox] relay failed", e));

      if (result instanceof Response) {
        response = result;
      } else if (result instanceof JsonResponse) {
        response = NextResponse.json(result.data, { status: result.status, headers: result.headers });
      } else if (result === undefined) {
        response = new NextResponse(null, { status: 204 });
      } else {
        response = NextResponse.json(result);
      }
      status = response.status;
    } catch (e) {
      if (isDomainError(e)) {
        status = e.status;
        response = NextResponse.json(errorBody(e.code, e.message, requestId, e.details), { status });
        if (e.code === "RATE_LIMITED") response.headers.set("retry-after", String((e.details as { retryAfterSeconds?: number })?.retryAfterSeconds ?? 60));
      } else if (e instanceof ZodError) {
        status = 422;
        const issues = e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
        response = NextResponse.json(errorBody("VALIDATION_FAILED", issues[0]?.message ?? "Invalid request", requestId, { issues }), { status });
      } else if (e instanceof UniqueViolationError) {
        status = 409;
        response = NextResponse.json(errorBody("CONFLICT", "This conflicts with an existing record", requestId), { status });
      } else if (e instanceof Error && e.message.startsWith("Invalid environment")) {
        status = 500;
        console.error(e.message);
        response = NextResponse.json(errorBody("INTERNAL", "Server is misconfigured", requestId), { status });
      } else {
        status = 500;
        console.error(
          JSON.stringify({
            level: "error",
            requestId,
            path: req.nextUrl.pathname,
            error: e instanceof Error ? { message: e.message, stack: e.stack } : String(e),
          }),
        );
        response = NextResponse.json(errorBody("INTERNAL", "Something went wrong. Please try again.", requestId), { status });
      }
    }
    response.headers.set("x-request-id", requestId);
    if (!response.headers.has("cache-control")) response.headers.set("cache-control", "no-store");
    console.info(
      JSON.stringify({ level: "info", msg: "request", method: req.method, path: req.nextUrl.pathname, status, ms: Date.now() - started, requestId }),
    );
    return response;
  };
}
