import { DomainError } from "@/server/errors";

// Fixed-window in-memory limiter. Per instance only — put a shared limiter
// (Redis or the WAF) in front when running several instances.

interface Window {
  count: number;
  resetAt: number;
}

const g = globalThis as unknown as { __rpRate?: Map<string, Window> };
const windows = (g.__rpRate ??= new Map());

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + windowMs };
    windows.set(key, w);
  }
  w.count += 1;
  if (w.count > limit) {
    throw new DomainError("RATE_LIMITED", "Too many requests. Please wait a moment and try again.", { retryAfterSeconds: Math.ceil((w.resetAt - now) / 1000) });
  }
  if (windows.size > 50_000) for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
}

export function resetRateLimits(): void {
  windows.clear();
}
