import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";
import { getRequestStore } from "@/server/store/request";
import { getConfig } from "@/server/config";
import { isDomainError } from "@/server/errors";
import { getPublicMenu } from "@/server/services/catalog";
import { MenuScreen } from "@/features/customer/menu-screen";
import { CustomerError, MenuSkeleton } from "@/features/customer/customer-error";

export const metadata: Metadata = { title: "Menu" };

export default function BranchMenuPage(props: PageProps<"/r/[slug]/b/[branchId]">) {
  return (
    <Suspense fallback={<MenuSkeleton />}>
      <BranchMenu params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function BranchMenu({ params, searchParams }: Pick<PageProps<"/r/[slug]/b/[branchId]">, "params" | "searchParams">) {
  const { slug, branchId } = await params;
  const sp = await searchParams;
  const type = sp.type === "DELIVERY" ? "DELIVERY" : "TAKEAWAY";
  if (!z.uuid().safeParse(branchId).success) return <CustomerError title="Branch not found" message="Check the link and try again." />;
  let menu;
  try {
    menu = await getPublicMenu(await getRequestStore(), { kind: "branch", tenantSlug: slug, branchId });
  } catch (e) {
    if (isDomainError(e) && e.code === "NOT_FOUND") return <CustomerError title="Branch not found" message="Check the link and try again." />;
    throw e;
  }
  if (type === "DELIVERY" && !menu.branch.deliveryEnabled)
    return <CustomerError title="Delivery isn't available here" message="Try takeaway, or another branch." />;
  return (
    <MenuScreen
      menu={menu}
      isDemo={getConfig().isDemo}
      context={{
        kind: "branch",
        tenantSlug: slug,
        branchId,
        restaurantName: menu.restaurant.name,
        branchName: menu.branch.name,
        currency: menu.restaurant.currency,
        fulfillmentType: type,
      }}
    />
  );
}
