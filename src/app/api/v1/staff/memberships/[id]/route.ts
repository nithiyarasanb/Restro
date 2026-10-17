import { api } from "@/server/http/api";
import { membershipUpdateSchema } from "@/lib/validation";
import { updateMembership } from "@/server/services/identity";

export const PATCH = api<{ id: string }>(async ({ store, actor, params, body }) =>
  updateMembership(store, actor, params.id, await body(membershipUpdateSchema)),
);
