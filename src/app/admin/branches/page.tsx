import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaffPage } from "@/server/auth/current";
import { getRequestStore } from "@/server/store/request";
import { can } from "@/server/auth/actor";
import { listBranches } from "@/server/services/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/feedback";
import { BranchManager } from "@/features/branches/branch-manager";

export const metadata: Metadata = { title: "Branches" };

export default function BranchesPage() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading branches" />}>
      <Branches />
    </Suspense>
  );
}

async function Branches() {
  const actor = await requireStaffPage("branch.settings", "/admin/branches");
  const branches = await listBranches(await getRequestStore(), actor);
  return (
    <>
      <PageHeader
        title="Branches"
        description="Hours, tax, service charge and fulfilment options per location. Going live requires an active payment connection, a menu and at least one table."
      />
      <BranchManager
        branches={branches}
        currency={actor.tenant.currency}
        canCreate={can(actor, "branch.manage")}
        canGoLive={can(actor, "branch.manage")}
        canEditTax={actor.role === "OWNER"}
        deliveryAllowed={actor.tenant.features.delivery}
        maxBranches={actor.tenant.features.maxBranches}
      />
    </>
  );
}
