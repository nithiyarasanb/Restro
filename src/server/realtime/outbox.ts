import type { Order, OutboxEvent, RealtimeEventType } from "@/types/domain";
import type { DataStore } from "@/server/store/types";
import { channelsFor, getBus } from "./bus";

// Transactional outbox (DG §2): events are written in the same transaction as
// the state change and published only after commit, by relayOutbox().

const MAX_ATTEMPTS = 10;

export function orderEventPayload(order: Order, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orderId: order.id,
    number: order.number,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentType: order.fulfillmentType,
    tableLabel: order.tableLabel,
    version: order.version,
    ...extra,
  };
}

export function enqueueOrderEvent(store: DataStore, type: RealtimeEventType, order: Order, extra: Record<string, unknown> = {}) {
  return store.addOutboxEvent({
    tenantId: order.tenantId,
    branchId: order.branchId,
    orderId: order.id,
    type,
    payload: orderEventPayload(order, extra),
    createdAt: new Date().toISOString(),
    publishedAt: null,
    attempts: 0,
    lastError: null,
    deadAt: null,
  });
}

let relaying: Promise<number> | null = null;

/** Publish pending outbox rows. Safe to call often; concurrent calls coalesce. */
export function relayOutbox(store: DataStore): Promise<number> {
  if (relaying) return relaying;
  relaying = (async () => {
    let published = 0;
    try {
      const pending = await store.listUnpublishedOutbox(200);
      const bus = getBus();
      const done: string[] = [];
      for (const e of pending) {
        try {
          publishEvent(bus, e);
          done.push(e.id);
        } catch (err) {
          await store.markOutboxFailed(e.id, String(err), e.attempts + 1 >= MAX_ATTEMPTS);
        }
      }
      if (done.length) await store.markOutboxPublished(done, new Date().toISOString());
      published = done.length;
    } finally {
      relaying = null;
    }
    return published;
  })();
  return relaying;
}

function publishEvent(bus: ReturnType<typeof getBus>, e: OutboxEvent) {
  const message = {
    eventId: e.id,
    type: e.type,
    tenantId: e.tenantId,
    branchId: e.branchId,
    orderId: e.orderId,
    payload: e.payload,
    at: e.createdAt,
  };
  for (const channel of channelsFor(e)) bus.publish(channel, message);
}

const g = globalThis as unknown as { __rpSweeper?: NodeJS.Timeout };

/** Periodic sweep republishes anything a crash left between commit and relay. */
export function startOutboxSweeper(intervalMs = 5000) {
  if (g.__rpSweeper || process.env.NODE_ENV === "test") return;
  g.__rpSweeper = setInterval(async () => {
    try {
      const { getStore } = await import("@/server/store");
      await relayOutbox(await getStore());
    } catch (e) {
      console.error("[outbox] sweep failed", e);
    }
  }, intervalMs);
  g.__rpSweeper.unref?.();
}
