// k6 load test (BRD §14: p95 < 500 ms for ordinary reads/writes at agreed pilot peak).
//   k6 run -e BASE=http://localhost:3000 tests/load/menu-and-orders.js
// Pilot peak is still an open question (BRD §21 Q7); RATE below is a placeholder.
import http from "k6/http";
import { check } from "k6";

const BASE = __ENV.BASE || "http://localhost:3000";
const QR = __ENV.QR || "t_DEMO_main_table_12";
const RATE = Number(__ENV.RATE || 20); // menu views per second

export const options = {
  scenarios: {
    menu: { executor: "constant-arrival-rate", rate: RATE, timeUnit: "1s", duration: "2m", preAllocatedVUs: 50, exec: "menu" },
    orders: { executor: "constant-arrival-rate", rate: Math.max(1, Math.round(RATE / 5)), timeUnit: "1s", duration: "2m", preAllocatedVUs: 20, exec: "order" },
  },
  thresholds: { http_req_duration: ["p(95)<500"], http_req_failed: ["rate<0.01"] },
};

let itemId;
export function setup() {
  const menu = http.get(`${BASE}/api/v1/public/qr/${QR}`).json();
  return { itemId: menu.items.find((i) => i.available && i.variants.length === 0 && i.modifierGroupIds.length === 0).id };
}

export function menu() {
  check(http.get(`${BASE}/api/v1/public/qr/${QR}`), { "menu 200": (r) => r.status === 200 });
}

export function order(data) {
  itemId = data.itemId;
  const body = JSON.stringify({ context: { kind: "table", qrRef: QR }, fulfillmentType: "DINE_IN", lines: [{ menuItemId: itemId, quantity: 1 }] });
  const res = http.post(`${BASE}/api/v1/public/orders`, body, {
    headers: { "content-type": "application/json", "idempotency-key": `k6-${__VU}-${__ITER}-${Date.now()}` },
  });
  check(res, { "order 201": (r) => r.status === 201 });
}
