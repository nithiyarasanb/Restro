import { api } from "@/server/http/api";
import { listMyJobs } from "@/server/services/fulfillment";

export const GET = api(async ({ store, actor }) => listMyJobs(store, actor));
