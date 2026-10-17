import { api } from "@/server/http/api";
import { previewInvitation } from "@/server/services/identity";

export const GET = api<{ token: string }>(async ({ store, params }) => previewInvitation(store, params.token), { rateLimitPerMinute: 30 });
