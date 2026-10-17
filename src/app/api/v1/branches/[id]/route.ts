import { api } from "@/server/http/api";
import { branchSchema } from "@/lib/validation";
import { notFound } from "@/server/errors";
import { listBranches, updateBranch } from "@/server/services/tenancy";

export const GET = api<{ id: string }>(async ({ store, actor, params }) => {
  const branch = (await listBranches(store, actor)).find((b) => b.id === params.id);
  if (!branch) throw notFound("Branch");
  return branch;
});
export const PATCH = api<{ id: string }>(async ({ store, actor, params, body }) => updateBranch(store, actor, params.id, await body(branchSchema)));
