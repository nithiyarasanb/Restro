import { api } from "@/server/http/api";
import { buildOpenApi } from "@/server/http/openapi";

export const GET = api(async ({ origin }) => buildOpenApi(origin), { rateLimitPerMinute: 30 });
