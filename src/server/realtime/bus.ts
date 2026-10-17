import { EventEmitter } from "node:events";
import type { OutboxEvent } from "@/types/domain";

// In-process pub/sub (ADR-0002). Replace with Redis pub/sub when running
// more than one app instance; the interface stays the same.

export interface RealtimeMessage {
  eventId: string;
  type: OutboxEvent["type"];
  tenantId: string;
  branchId: string | null;
  orderId: string | null;
  payload: Record<string, unknown>;
  at: string;
}

export interface RealtimeBus {
  publish(channel: string, message: RealtimeMessage): void;
  subscribe(channels: string[], listener: (message: RealtimeMessage) => void): () => void;
}

class LocalBus implements RealtimeBus {
  private readonly emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(0);
  }
  publish(channel: string, message: RealtimeMessage) {
    this.emitter.emit(channel, message);
  }
  subscribe(channels: string[], listener: (message: RealtimeMessage) => void) {
    for (const c of channels) this.emitter.on(c, listener);
    return () => {
      for (const c of channels) this.emitter.off(c, listener);
    };
  }
}

const g = globalThis as unknown as { __rpBus?: RealtimeBus };
export function getBus(): RealtimeBus {
  return (g.__rpBus ??= new LocalBus());
}

export const channels = {
  kitchen: (tenantId: string, branchId: string) => `kitchen:${tenantId}:${branchId}`,
  orders: (tenantId: string, branchId: string) => `orders:${tenantId}:${branchId}`,
  order: (orderId: string) => `order:${orderId}`,
  runner: (tenantId: string, userId: string) => `runner:${tenantId}:${userId}`,
};

/** Every channel an outbox event fans out to. */
export function channelsFor(e: OutboxEvent): string[] {
  const out: string[] = [];
  if (e.branchId) out.push(channels.kitchen(e.tenantId, e.branchId), channels.orders(e.tenantId, e.branchId));
  if (e.orderId) out.push(channels.order(e.orderId));
  const runner = e.payload.runnerUserId;
  if (typeof runner === "string") out.push(channels.runner(e.tenantId, runner));
  return out;
}
