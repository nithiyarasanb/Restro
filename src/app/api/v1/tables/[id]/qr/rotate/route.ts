import { api } from "@/server/http/api";
import { rotateTableQr } from "@/server/services/tables";

/** Issues a new QR reference; previously printed codes stop working. */
export const POST = api<{ id: string }>(async ({ store, actor, params }) => rotateTableQr(store, actor, params.id));
