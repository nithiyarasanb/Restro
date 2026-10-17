import { z } from "zod";
import { api } from "@/server/http/api";
import { getPublicMenu } from "@/server/services/catalog";

export const GET = api<{ slug: string; branchId: string }>(async ({ store, params }) =>
  getPublicMenu(store, { kind: "branch", tenantSlug: params.slug, branchId: z.uuid().parse(params.branchId) }),
);
