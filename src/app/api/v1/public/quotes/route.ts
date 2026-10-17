import { api } from "@/server/http/api";
import { quoteRequestSchema } from "@/lib/validation";
import { quote } from "@/server/services/checkout";

export const POST = api(async ({ store, body }) => quote(store, await body(quoteRequestSchema)), { rateLimitPerMinute: 120 });
