// Typed browser client for /api/v1. Errors carry the server's code,
// message and request id so UIs can show actionable messages.

import type { ApiErrorBody } from "@/types/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Field-level messages from a 422 response, keyed by dotted path. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    const d = this.details as { issues?: Array<{ path: string; message: string }>; field?: string } | undefined;
    for (const i of d?.issues ?? []) out[i.path] ??= i.message;
    if (d?.field) out[d.field] ??= this.message;
    return out;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "NETWORK", "You appear to be offline. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (json ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(res.status, err.code ?? "HTTP_ERROR", err.message ?? `Request failed (${res.status})`, err.requestId, err.details);
  }
  return json as T;
}

export function newIdempotencyKey(prefix = "k"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.requestId ? `${e.message} (ref ${e.requestId.slice(0, 8)})` : e.message;
  return e instanceof Error ? e.message : "Something went wrong";
}
