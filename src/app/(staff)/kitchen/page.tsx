import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaffPage } from "@/server/auth/current";
import { getRequestStore } from "@/server/store/request";
import { getConfig } from "@/server/config";
import { can } from "@/server/auth/actor";
import { listBranches } from "@/server/services/tenancy";
import { KitchenBoard } from "@/features/kitchen/kitchen-board";
import { StaffTopBar } from "@/features/staff/staff-top-bar";
import { StaffMain, StaffScreenSkeleton } from "@/features/staff/staff-page";

export const metadata: Metadata = { title: "Kitchen display" };

export default function KitchenPage() {
  return (
    <Suspense fallback={<StaffScreenSkeleton title="kitchen display" />}>
      <Kitchen />
    </Suspense>
  );
}

async function Kitchen() {
  const actor = await requireStaffPage(["kitchen.operate"], "/kitchen");
  const branches = await listBranches(await getRequestStore(), actor);
  const links = [
    can(actor, "orders.handover") && { href: "/counter", label: "Counter" },
    can(actor, "reports.view") && { href: "/admin", label: "Admin" },
  ].filter(Boolean) as Array<{ href: string; label: string }>;
  return (
    <>
      <StaffTopBar title="Kitchen Display" subtitle={actor.tenant.name} userName={actor.user.name} isDemo={getConfig().isDemo} links={links} />
      <StaffMain>
        <KitchenBoard branches={branches.map((b) => ({ id: b.id, name: b.name }))} canHandover={can(actor, "orders.handover")} />
      </StaffMain>
    </>
  );
}
