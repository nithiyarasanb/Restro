"use client";

import { useSyncExternalStore } from "react";
import type { FulfillmentType } from "@/types/domain";

// Client cart: identifiers + display hints only. Prices shown here are
// estimates; the server quote is authoritative (BR-06).

export type CartContext =
  | { kind: "table"; qrRef: string; tableLabel: string; restaurantName: string; branchName: string; currency: string }
  | {
      kind: "branch";
      tenantSlug: string;
      branchId: string;
      restaurantName: string;
      branchName: string;
      currency: string;
      fulfillmentType: Exclude<FulfillmentType, "DINE_IN">;
    };

export interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  variantId: string | null;
  variantName: string | null;
  modifierOptionIds: string[];
  modifierLabels: string[];
  quantity: number;
  notes: string | null;
  unitEstimateMinor: number;
}

export interface CartState {
  context: CartContext | null;
  lines: CartLine[];
}

const KEY = "rp-cart-v1";
const EMPTY: CartState = { context: null, lines: [] };
const listeners = new Set<() => void>();
let cache: CartState | null = null;

function read(): CartState {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as CartState) : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function write(next: CartState) {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: keep in memory */
  }
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      cache = null;
      listeners.forEach((l) => l());
    }
  });
}

export function sameContext(a: CartContext | null, b: CartContext | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "table" && b.kind === "table") return a.qrRef === b.qrRef;
  if (a.kind === "branch" && b.kind === "branch") return a.branchId === b.branchId && a.fulfillmentType === b.fulfillmentType;
  return false;
}

export const cart = {
  get: read,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** Switch context; a different restaurant/table starts a fresh cart. Returns true if lines were dropped. */
  setContext(ctx: CartContext): boolean {
    const s = read();
    if (sameContext(s.context, ctx)) {
      write({ ...s, context: ctx });
      return false;
    }
    const dropped = s.lines.length > 0;
    write({ context: ctx, lines: [] });
    return dropped;
  },
  add(line: Omit<CartLine, "key">) {
    const s = read();
    const same = s.lines.find(
      (l) =>
        l.menuItemId === line.menuItemId &&
        l.variantId === line.variantId &&
        l.notes === line.notes &&
        [...l.modifierOptionIds].sort().join() === [...line.modifierOptionIds].sort().join(),
    );
    const lines = same
      ? s.lines.map((l) => (l === same ? { ...l, quantity: Math.min(50, l.quantity + line.quantity) } : l))
      : [...s.lines, { ...line, key: crypto.randomUUID() }];
    write({ ...s, lines });
  },
  setQuantity(key: string, quantity: number) {
    const s = read();
    write({
      ...s,
      lines: quantity <= 0 ? s.lines.filter((l) => l.key !== key) : s.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, quantity) } : l)),
    });
  },
  remove(key: string) {
    const s = read();
    write({ ...s, lines: s.lines.filter((l) => l.key !== key) });
  },
  clear() {
    const s = read();
    write({ context: s.context, lines: [] });
  },
};

export function useCart(): CartState {
  return useSyncExternalStore(cart.subscribe, cart.get, () => EMPTY);
}

export function cartCount(s: CartState) {
  return s.lines.reduce((n, l) => n + l.quantity, 0);
}

export function cartEstimate(s: CartState) {
  return s.lines.reduce((n, l) => n + l.unitEstimateMinor * l.quantity, 0);
}

// Recent orders on this device so guests can find their tracking page again.
const RECENT_KEY = "rp-recent-orders-v1";
export interface RecentOrder {
  orderId: string;
  number: number;
  trackingUrl: string;
  restaurantName: string;
  at: string;
}
export function rememberOrder(o: RecentOrder) {
  try {
    const list = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as RecentOrder[];
    window.localStorage.setItem(RECENT_KEY, JSON.stringify([o, ...list.filter((x) => x.orderId !== o.orderId)].slice(0, 10)));
  } catch {
    /* ignore */
  }
}
export function recentOrders(): RecentOrder[] {
  try {
    return JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as RecentOrder[];
  } catch {
    return [];
  }
}
