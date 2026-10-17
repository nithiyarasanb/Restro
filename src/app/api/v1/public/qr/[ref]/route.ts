import { api } from "@/server/http/api";
import { getPublicMenu } from "@/server/services/catalog";

/** Resolve a table QR reference to its restaurant/branch/table context and menu. */
export const GET = api<{ ref: string }>(async ({ store, params }) => getPublicMenu(store, { kind: "table", qrRef: params.ref.slice(0, 64) }), {
  rateLimitPerMinute: 60,
});
