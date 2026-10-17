import { api } from "@/server/http/api";
import { DomainError } from "@/server/errors";
import { sessionView } from "@/server/services/identity";

export const GET = api(async ({ actor }) => {
  if (!actor) throw new DomainError("UNAUTHENTICATED", "Not signed in");
  return sessionView(actor);
});
