import { api } from "@/server/http/api";
import { activatePaymentConnection } from "@/server/services/tenancy";

/** Activates the (mock) payment connection. Real providers are blocked on the launch-country decision. */
export const POST = api<{ id: string }>(async ({ store, actor, params }) => activatePaymentConnection(store, actor, params.id));
