import { api } from "@/server/http/api";
import { revokeInvitation } from "@/server/services/identity";

export const DELETE = api<{ id: string }>(async ({ store, actor, params }) => {
  await revokeInvitation(store, actor, params.id);
});
