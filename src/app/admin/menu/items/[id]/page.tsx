import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/server/auth/current";
import { getRequestStore } from "@/server/store/request";
import { getAdminMenu } from "@/server/services/catalog";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/feedback";
import { ItemEditor } from "@/features/menu/item-editor";

export const metadata: Metadata = { title: "Edit menu item" };

export default function EditItemPage(props: PageProps<"/admin/menu/items/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditItem params={props.params} />
    </Suspense>
  );
}

async function EditItem({ params }: { params: PageProps<"/admin/menu/items/[id]">["params"] }) {
  const { id } = await params;
  const actor = await requireStaffPage("menu.manage", `/admin/menu/items/${id}`);
  const menu = await getAdminMenu(await getRequestStore(), actor);
  const item = menu.items.find((i) => i.id === id);
  if (!item) notFound();
  return (
    <>
      <PageHeader
        title={`Edit ${item.name}`}
        eyebrow="Menu"
        description="Changes apply to new orders. Existing orders keep the name and price they were placed with."
      />
      <ItemEditor item={item} menu={menu} currency={actor.tenant.currency} imagePreview={menu.imageUrls[item.id] ?? null} />
    </>
  );
}
