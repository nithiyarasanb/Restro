import type { Metadata } from "next";
import { Suspense } from "react";
import { getRequestStore } from "@/server/store/request";
import { getConfig } from "@/server/config";
import { isDomainError } from "@/server/errors";
import { getPublicMenu } from "@/server/services/catalog";
import { MenuScreen } from "@/features/customer/menu-screen";
import { CustomerError, MenuSkeleton } from "@/features/customer/customer-error";

export const metadata: Metadata = { title: "Menu" };

/** Table QR entry point: resolves restaurant, branch and table, then shows the dine-in menu. */
export default function QrPage(props: PageProps<"/q/[ref]">) {
  return (
    <Suspense fallback={<MenuSkeleton />}>
      <QrMenu params={props.params} />
    </Suspense>
  );
}

async function QrMenu({ params }: { params: PageProps<"/q/[ref]">["params"] }) {
  const { ref } = await params;
  let menu;
  try {
    menu = await getPublicMenu(await getRequestStore(), { kind: "table", qrRef: ref.slice(0, 64) });
  } catch (e) {
    if (isDomainError(e) && (e.code === "QR_INVALID" || e.code === "NOT_FOUND")) return <CustomerError title="This QR code isn't active" message={e.message} />;
    throw e;
  }
  return (
    <MenuScreen
      menu={menu}
      isDemo={getConfig().isDemo}
      context={{
        kind: "table",
        qrRef: ref,
        tableLabel: menu.table!.label,
        restaurantName: menu.restaurant.name,
        branchName: menu.branch.name,
        currency: menu.restaurant.currency,
      }}
    />
  );
}
