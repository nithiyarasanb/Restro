import type { PaymentProviderKey } from "@/types/domain";

// Provider adapter interface (DG §4 Payments). Business logic only sees this
// interface; provider differences stay inside adapters.

export type ProviderEventType = "payment.authorized" | "payment.captured" | "payment.failed";

export interface ProviderWebhookEvent {
  eventId: string;
  type: ProviderEventType;
  occurredAt: string;
  paymentId: string;
  /** Our payment attempt id, echoed back by the provider. */
  reference: string;
  accountId: string;
  amountMinor: number;
  currency: string;
  failureReason: string | null;
}

export interface ProviderPayment {
  paymentId: string;
  reference: string;
  accountId: string;
  amountMinor: number;
  currency: string;
  status: "PENDING" | "CAPTURED" | "FAILED";
  failureReason: string | null;
}

export interface PaymentProvider {
  readonly key: PaymentProviderKey;
  readonly label: string;
  readonly testOnly: boolean;
  createIntent(input: {
    reference: string;
    amountMinor: number;
    currency: string;
    accountId: string;
    description: string;
    returnUrl: string;
    origin: string;
  }): Promise<{ paymentId: string; checkoutUrl: string }>;
  /** Verifies the signature over the raw body. Throws DomainError(INVALID_SIGNATURE). */
  verifyWebhook(rawBody: string, headers: Headers): ProviderWebhookEvent;
  fetchPayment(paymentId: string): Promise<ProviderPayment | null>;
  refund(input: {
    paymentId: string;
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
    reason: string;
  }): Promise<{ ok: true; refundId: string } | { ok: false; reason: string }>;
}

export async function getProvider(key: PaymentProviderKey): Promise<PaymentProvider> {
  switch (key) {
    case "mock": {
      const { getMockProvider } = await import("./mock-provider");
      return getMockProvider();
    }
  }
}
