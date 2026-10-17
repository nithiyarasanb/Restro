import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaffPage } from "@/server/auth/current";
import { getRequestStore } from "@/server/store/request";
import { can } from "@/server/auth/actor";
import { getAdminMenu } from "@/server/services/catalog";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/feedback";
import { MenuManager } from "@/features/menu/menu-manager";

export const metadata: Metadata = { title: "Menu" };

export default function MenuPage() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading menu" />}>
      <Menu />
    </Suspense>
  );
}

async function Menu() {
  const actor = await requireStaffPage("menu.availability", "/admin/menu");
  const menu = await getAdminMenu(await getRequestStore(), actor);
  return (
    <>
      <PageHeader title="Menu" description="Categories, items, sizes and modifiers. Mark items sold out per branch in one tap." />
      <MenuManager menu={menu} currency={actor.tenant.currency} canManage={can(actor, "menu.manage")} />
    </>
  );
}
