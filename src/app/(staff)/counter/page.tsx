import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaffPage } from "@/server/auth/current";
import { getRequestStore } from "@/server/store/request";
import { getConfig } from "@/server/config";
import { can } from "@/server/auth/actor";
import { listBranches } from "@/server/services/tenancy";
import { CounterBoard } from "@/features/counter/counter-board";
import { StaffTopBar } from "@/features/staff/staff-top-bar";
import { StaffMain, StaffScreenSkeleton } from "@/features/staff/staff-page";

export const metadata: Metadata = { title: "Front of house" };

export default function CounterPage() {
  return (
    <Suspense fallback={<StaffScreenSkeleton title="counter" />}>
      <Counter />
    </Suspense>
  );
}

async function Counter() {
  const actor = await requireStaffPage(["orders.handover"], "/counter");
  const branches = await listBranches(await getRequestStore(), actor);
  const links = [
    can(actor, "kitchen.operate") && { href: "/kitchen", label: "Kitchen" },
    can(actor, "reports.view") && { href: "/admin", label: "Admin" },
  ].filter(Boolean) as Array<{ href: string; label: string }>;
  return (
    <>
      <StaffTopBar title="Front of House" subtitle={actor.tenant.name} userName={actor.user.name} isDemo={getConfig().isDemo} links={links} />
      <StaffMain>
        <CounterBoard branches={branches.map((b) => ({ id: b.id, name: b.name }))} canOpenAdmin={can(actor, "delivery.assign")} />
      </StaffMain>
    </>
  );
}
