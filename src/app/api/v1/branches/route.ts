import { api, created } from "@/server/http/api";
import { branchSchema } from "@/lib/validation";
import { createBranch, listBranches } from "@/server/services/tenancy";

export const GET = api(async ({ store, actor }) => listBranches(store, actor));
export const POST = api(async ({ store, actor, body }) => created(await createBranch(store, actor, await body(branchSchema))));
