// Identifiers and credentials of the DEMO seed (sample data only).

export const DEMO_PASSWORD = "Demo@1234";

/** Deterministic, RFC-valid v4-shaped UUIDs so demo links stay stable. */
export const did = (kind: number, n: number) => `${kind.toString(16).padStart(8, "0")}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const DEMO = {
  tenantId: did(0xa, 1),
  tenant2Id: did(0xa, 2),
  tenant3Id: did(0xa, 3),
  mainBranchId: did(0xb, 1),
  lakeBranchId: did(0xb, 2),
  harbourBranchId: did(0xb, 3),
  greenBranchId: did(0xb, 4),
  /** Opaque in production; readable here so the demo is easy to follow. */
  table12QrRef: "t_DEMO_main_table_12",
  table5QrRef: "t_DEMO_main_table_5",
  revokedQrRef: "t_DEMO_revoked_example",
  liveOrderId: did(0xc, 1042),
  liveOrderToken: "demo-track-1042",
  users: {
    platform: "admin@platform.demo",
    owner: "owner@spiceroute.demo",
    manager: "manager@spiceroute.demo",
    cashier: "cashier@spiceroute.demo",
    kitchen: "kitchen@spiceroute.demo",
    runner: "runner@spiceroute.demo",
    harbourOwner: "owner@harbour.demo",
  },
} as const;
