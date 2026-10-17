import { randomUUID } from "node:crypto";
import { getConfig } from "@/server/config";
import { DomainError } from "@/server/errors";
import { hmacSha256Hex, randomToken, safeEqualHex } from "@/server/crypto";
import type { PaymentProvider, ProviderPayment, ProviderWebhookEvent } from "./provider";

// MOCK PAYMENT PROVIDER — TEST ONLY.
// Simulates an external gateway: it keeps its own ledger (as a real provider
// would), hosts a checkout page (/pay/mock/[paymentId]) and sends signed
// webhooks over HTTP to /api/v1/webhooks/payments/mock. Config refuses it in
// production unless ALLOW_DEMO_MODE=true.

export const MOCK_SIGNATURE_HEADER = "x-mock-signature";
const TOLERANCE_SECONDS = 300;
/** Refund reasons containing this marker fail in the mock, to exercise NT-9. */
export const MOCK_REFUND_FAILURE_MARKER = "[mock-fail]";

interface LedgerPayment extends ProviderPayment {
  description: string;
  returnUrl: string;
  origin: string;
  createdAt: string;
}

interface Ledger {
  payments: Map<string, LedgerPayment>;
  refunds: Map<string, { refundId: string; ok: boolean; reason?: string }>;
}

const g = globalThis as unknown as { __rpMockLedger?: Ledger };
const ledger = (): Ledger => (g.__rpMockLedger ??= { payments: new Map(), refunds: new Map() });

export function signMockPayload(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${hmacSha256Hex(secret, `${timestamp}.${rawBody}`)}`;
}

class MockProvider implements PaymentProvider {
  readonly key = "mock" as const;
  readonly label = "Mock provider (TEST ONLY)";
  readonly testOnly = true;

  async createIntent(input: Parameters<PaymentProvider["createIntent"]>[0]) {
    const paymentId = `mock_pay_${randomToken(10)}`;
    ledger().payments.set(paymentId, {
      paymentId,
      reference: input.reference,
      accountId: input.accountId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      status: "PENDING",
      failureReason: null,
      description: input.description,
      returnUrl: input.returnUrl,
      origin: input.origin,
      createdAt: new Date().toISOString(),
    });
    return { paymentId, checkoutUrl: `/pay/mock/${paymentId}` };
  }

  verifyWebhook(rawBody: string, headers: Headers): ProviderWebhookEvent {
    const header = headers.get(MOCK_SIGNATURE_HEADER) ?? "";
    const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
    const t = Number(parts.t);
    if (!parts.v1 || !Number.isFinite(t)) throw new DomainError("INVALID_SIGNATURE", "Missing or malformed signature");
    if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_SECONDS) throw new DomainError("INVALID_SIGNATURE", "Signature timestamp outside tolerance");
    const expected = hmacSha256Hex(getConfig().PAYMENT_WEBHOOK_SECRET, `${t}.${rawBody}`);
    if (!safeEqualHex(expected, parts.v1)) throw new DomainError("INVALID_SIGNATURE", "Signature mismatch");

    let body: { id?: unknown; type?: unknown; created?: unknown; data?: Record<string, unknown> };
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new DomainError("VALIDATION_FAILED", "Webhook body is not JSON");
    }
    const d = body.data ?? {};
    const type = body.type;
    if (typeof body.id !== "string" || (type !== "payment.captured" && type !== "payment.failed" && type !== "payment.authorized"))
      throw new DomainError("VALIDATION_FAILED", "Unsupported webhook event");
    if (
      typeof d.paymentId !== "string" ||
      typeof d.reference !== "string" ||
      typeof d.accountId !== "string" ||
      !Number.isSafeInteger(d.amountMinor) ||
      typeof d.currency !== "string"
    )
      throw new DomainError("VALIDATION_FAILED", "Webhook data incomplete");
    return {
      eventId: body.id,
      type,
      occurredAt: typeof body.created === "string" ? body.created : new Date().toISOString(),
      paymentId: d.paymentId,
      reference: d.reference,
      accountId: d.accountId,
      amountMinor: d.amountMinor as number,
      currency: d.currency,
      failureReason: typeof d.failureReason === "string" ? d.failureReason : null,
    };
  }

  async fetchPayment(paymentId: string): Promise<ProviderPayment | null> {
    const p = ledger().payments.get(paymentId);
    if (!p) return null;
    return {
      paymentId: p.paymentId,
      reference: p.reference,
      accountId: p.accountId,
      amountMinor: p.amountMinor,
      currency: p.currency,
      status: p.status,
      failureReason: p.failureReason,
    };
  }

  async refund(input: Parameters<PaymentProvider["refund"]>[0]) {
    const existing = ledger().refunds.get(input.idempotencyKey);
    if (existing) return existing.ok ? { ok: true as const, refundId: existing.refundId } : { ok: false as const, reason: existing.reason ?? "Refund failed" };
    const p = ledger().payments.get(input.paymentId);
    // Seeded historical payments are not in the live ledger; treat them as settled captures.
    const known = p ?? (input.paymentId.startsWith("mock_pay_") ? { status: "CAPTURED" } : null);
    let result: { refundId: string; ok: boolean; reason?: string };
    if (!known || known.status !== "CAPTURED") result = { refundId: "", ok: false, reason: "Payment is not captured at the provider" };
    else if (input.reason.includes(MOCK_REFUND_FAILURE_MARKER))
      result = { refundId: "", ok: false, reason: "Provider declined the refund (simulated failure)" };
    else result = { refundId: `mock_rf_${randomToken(8)}`, ok: true };
    // Only successful refunds are remembered, so a failed one can be retried.
    if (result.ok) ledger().refunds.set(input.idempotencyKey, result);
    return result.ok ? { ok: true as const, refundId: result.refundId } : { ok: false as const, reason: result.reason! };
  }
}

let instance: MockProvider | null = null;
export function getMockProvider(): PaymentProvider {
  return (instance ??= new MockProvider());
}

// ── Provider-side simulation (what a real gateway would do on its own servers) ──

export function getMockCheckout(paymentId: string) {
  const p = ledger().payments.get(paymentId);
  return p ? { ...p } : null;
}

export type MockOutcome = "success" | "decline";

export interface MockCompletionOptions {
  /** Deliver the same webhook twice (NT-3). */
  duplicate?: boolean;
  /** Report a different amount than was requested (NT-5). */
  tamperAmount?: boolean;
  /** Sign with the wrong secret (invalid signature). */
  badSignature?: boolean;
}

export async function completeMockPayment(paymentId: string, outcome: MockOutcome, opts: MockCompletionOptions = {}) {
  const p = ledger().payments.get(paymentId);
  if (!p) throw new DomainError("NOT_FOUND", "Mock payment not found");
  if (p.status !== "PENDING") throw new DomainError("CONFLICT", `Mock payment already ${p.status.toLowerCase()}`);
  p.status = outcome === "success" ? "CAPTURED" : "FAILED";
  p.failureReason = outcome === "success" ? null : "Card declined (simulated)";

  const event = {
    id: `evt_${randomUUID()}`,
    type: outcome === "success" ? "payment.captured" : "payment.failed",
    created: new Date().toISOString(),
    data: {
      paymentId: p.paymentId,
      reference: p.reference,
      accountId: p.accountId,
      amountMinor: opts.tamperAmount ? p.amountMinor - 100 : p.amountMinor,
      currency: p.currency,
      failureReason: p.failureReason,
    },
  };
  const rawBody = JSON.stringify(event);
  const secret = opts.badSignature ? "not-the-real-webhook-secret" : getConfig().PAYMENT_WEBHOOK_SECRET;
  const deliveries = opts.duplicate ? 2 : 1;
  const responses: Array<{ status: number; body: unknown }> = [];
  for (let i = 0; i < deliveries; i++) {
    const res = await fetch(new URL("/api/v1/webhooks/payments/mock", p.origin), {
      method: "POST",
      headers: { "content-type": "application/json", [MOCK_SIGNATURE_HEADER]: signMockPayload(secret, rawBody) },
      body: rawBody,
    });
    responses.push({ status: res.status, body: await res.json().catch(() => null) });
  }
  return { returnUrl: p.returnUrl, eventId: event.id, deliveries: responses };
}

/** Test helper: build a signed webhook request body without HTTP. */
export function buildMockWebhook(event: { id: string; type: string; data: Record<string, unknown> }, secret = getConfig().PAYMENT_WEBHOOK_SECRET) {
  const rawBody = JSON.stringify({ ...event, created: new Date().toISOString() });
  return { rawBody, headers: new Headers({ "content-type": "application/json", [MOCK_SIGNATURE_HEADER]: signMockPayload(secret, rawBody) }) };
}

/** Test helper: mark a ledger payment as captured without sending a webhook (reconciliation path). */
export function settleMockPaymentSilently(paymentId: string, status: "CAPTURED" | "FAILED") {
  const p = ledger().payments.get(paymentId);
  if (p) p.status = status;
}
