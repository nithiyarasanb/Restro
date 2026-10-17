import type { DataStore } from "@/server/store/types";
import { DomainError, notFound } from "@/server/errors";
import { can, requirePermission, requireStaff, type Actor } from "@/server/auth/actor";
import { verifyOrderAccess } from "@/server/services/checkout";
import { channels, getBus, type RealtimeMessage } from "./bus";

// SSE channel authorisation (FR-08). Every subscription is checked with the
// same guards as REST; tenant and branch scope come from the session.

export type StreamRequest =
  { channel: "kitchen" | "orders"; branchId: string } | { channel: "order"; orderId: string; token: string | null } | { channel: "runner" };

export async function authorizeStream(store: DataStore, actor: Actor | null, req: StreamRequest): Promise<{ channels: string[]; tenantId: string | null }> {
  switch (req.channel) {
    case "kitchen":
    case "orders": {
      const staff = requireStaff(actor);
      const perm = req.channel === "kitchen" && can(staff, "kitchen.operate") ? "kitchen.operate" : "orders.view";
      requirePermission(staff, perm, req.branchId);
      if (!(await store.getBranch(staff.tenant.id, req.branchId))) throw notFound("Branch");
      return {
        channels: [req.channel === "kitchen" ? channels.kitchen(staff.tenant.id, req.branchId) : channels.orders(staff.tenant.id, req.branchId)],
        tenantId: staff.tenant.id,
      };
    }
    case "order": {
      const order = await store.getOrderUnscoped(req.orderId);
      if (!order) throw notFound("Order");
      const staffOk = actor?.kind === "staff" && actor.tenant.id === order.tenantId && can(actor, "orders.view", order.branchId);
      if (!staffOk && !verifyOrderAccess(order, req.token)) throw notFound("Order");
      return { channels: [channels.order(order.id)], tenantId: order.tenantId };
    }
    case "runner": {
      const staff = requirePermission(actor, "delivery.run");
      return { channels: [channels.runner(staff.tenant.id, staff.user.id)], tenantId: staff.tenant.id };
    }
    default:
      throw new DomainError("VALIDATION_FAILED", "Unknown channel");
  }
}

const HEARTBEAT_MS = 15_000;
const MAX_STREAM_MS = 30 * 60_000; // force periodic re-authorisation

export function sseResponse(subscribed: { channels: string[]; tenantId: string | null }, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (event: string, data: unknown, id?: string) => write(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      write("retry: 3000\n\n");
      send("ready", { serverTime: new Date().toISOString(), heartbeatMs: HEARTBEAT_MS });
      const unsubscribe = getBus().subscribe(subscribed.channels, (m: RealtimeMessage) => {
        // Defence in depth: never forward another tenant's event.
        if (subscribed.tenantId && m.tenantId !== subscribed.tenantId) return;
        send("message", m, m.eventId);
      });
      const heartbeat = setInterval(() => send("heartbeat", { serverTime: new Date().toISOString() }), HEARTBEAT_MS);
      const expiry = setTimeout(() => cleanup(), MAX_STREAM_MS);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(expiry);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
