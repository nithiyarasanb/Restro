import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaffPage } from "@/server/auth/current";
import { getRequestStore } from "@/server/store/request";
import { getAdminMenu } from "@/server/services/catalog";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/feedback";
import { ItemEditor } from "@/features/menu/item-editor";

export const metadata: Metadata = { title: "New menu item" };

export default function NewItemPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewItem />
    </Suspense>
  );
}

async function NewItem() {
  const actor = await requireStaffPage("menu.manage", "/admin/menu/items/new");
  const menu = await getAdminMenu(await getRequestStore(), actor);
  return (
    <>
      <PageHeader title="New menu item" eyebrow="Menu" />
      <ItemEditor item={null} menu={menu} currency={actor.tenant.currency} imagePreview={null} />
    </>
  );
}
