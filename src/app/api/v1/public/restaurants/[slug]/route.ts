import { api } from "@/server/http/api";
import { getPublicRestaurant } from "@/server/services/catalog";

export const GET = api<{ slug: string }>(async ({ store, params }) => getPublicRestaurant(store, params.slug));
