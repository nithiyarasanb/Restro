import { api } from "@/server/http/api";
import { getConfig } from "@/server/config";

/** Readiness: the configured data source answers. */
export const GET = api(
  async ({ store }) => {
    await store.ping();
    return { status: "ready", dataSource: store.kind, demo: getConfig().isDemo };
  },
  { rateLimitPerMinute: 0 },
);
