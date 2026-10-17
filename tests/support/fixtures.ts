import { MemoryStore } from "@/server/store/memory/memory-store";
import { DEMO, seedDemoData } from "@/server/store/seed";
import type { DataStore } from "@/server/store/types";
import { createSession, resolveActor } from "@/server/auth/session";
import type { StaffActor, Actor } from "@/server/auth/actor";
import { placeOrder } from "@/server/services/checkout";
import { createPaymentIntent, handleWebhook } from "@/server/services/payments";
import { buildMockWebhook, settleMockPaymentSilently } from "@/server/payments/mock-provider";
import type { PlaceOrderInput } from "@/lib/validation";

export { DEMO };

export async function seededMemoryStore() {
  const store = new MemoryStore();
  const seed = await seedDemoData(store, { historyDays: 1 });
  return { store, seed };
}

export async function actorFor(store: DataStore, email: string): Promise<Actor> {
  const user = await store.getUserByEmail(email);
  if (!user) throw new Error(`No user ${email}`);
  const { token } = await createSession(store, user.id);
  const actor = await resolveActor(store, token);
  if (!actor) throw new Error(`No actor for ${email}`);
  return actor;
}

export async function staffFor(store: DataStore, email: string) {
  return (await actorFor(store, email)) as StaffActor;
}

let keyCounter = 0;
export const newKey = (prefix = "test") => `${prefix}-${Date.now()}-${++keyCounter}-key`;

export async function menuItemId(store: DataStore, tenantId: string, name: string) {
  const item = (await store.listMenuItems(tenantId, { includeRetired: true })).find((i) => i.name === name);
  if (!item) throw new Error(`No item ${name}`);
  return item;
}

export async function dineInOrderInput(store: DataStore, overrides: Partial<PlaceOrderInput> = {}): Promise<PlaceOrderInput> {
  const tikka = await menuItemId(store, DEMO.tenantId, "Paneer Tikka");
  return {
    context: { kind: "table", qrRef: DEMO.table12QrRef },
    fulfillmentType: "DINE_IN",
    lines: [{ menuItemId: tikka.id, variantId: null, modifierOptionIds: [], quantity: 2, notes: null }],
    customer: { name: null, phone: null, address: null },
    notes: null,
    ...overrides,
  };
}

/** Place an order and start a mock payment. Returns ids needed to send webhooks. */
export async function orderWithIntent(store: DataStore, input?: PlaceOrderInput) {
  const placed = await placeOrder(store, input ?? (await dineInOrderInput(store)), newKey("order"));
  const intent = await createPaymentIntent(store, {
    orderId: placed.order.orderId,
    token: placed.order.accessToken,
    idempotencyKey: newKey("pay"),
    origin: "http://localhost:3000",
  });
  const attempt = (await store.getPaymentAttemptUnscoped(intent.attemptId))!;
  return { placed, intent, attempt };
}

export function webhookFor(
  attempt: { id: string; providerPaymentId: string | null; providerAccountId: string; amountMinor: number; currency: string },
  type: "payment.captured" | "payment.failed" = "payment.captured",
  overrides: Record<string, unknown> = {},
  eventId = `evt_${crypto.randomUUID()}`,
) {
  // Mirror what the provider does on its side before it sends the webhook.
  if (attempt.providerPaymentId && Object.keys(overrides).length === 0)
    settleMockPaymentSilently(attempt.providerPaymentId, type === "payment.captured" ? "CAPTURED" : "FAILED");
  return buildMockWebhook({
    id: eventId,
    type,
    data: {
      paymentId: attempt.providerPaymentId,
      reference: attempt.id,
      accountId: attempt.providerAccountId,
      amountMinor: attempt.amountMinor,
      currency: attempt.currency,
      failureReason: type === "payment.failed" ? "Declined" : null,
      ...overrides,
    },
  });
}

export async function deliver(store: DataStore, hook: { rawBody: string; headers: Headers }) {
  return handleWebhook(store, "mock", hook.rawBody, hook.headers);
}
