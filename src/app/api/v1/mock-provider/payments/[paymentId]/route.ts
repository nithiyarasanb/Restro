import { api } from "@/server/http/api";
import { notFound } from "@/server/errors";
import { getMockCheckout } from "@/server/payments/mock-provider";

/** MOCK PROVIDER (test only): the hosted checkout page reads its payment from the provider ledger. */
export const GET = api<{ paymentId: string }>(async ({ params }) => {
  const p = getMockCheckout(params.paymentId);
  if (!p) throw notFound("Payment");
  return { paymentId: p.paymentId, amountMinor: p.amountMinor, currency: p.currency, description: p.description, status: p.status, returnUrl: p.returnUrl };
});
