import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaffPage } from "@/server/auth/current";
import { getRequestStore } from "@/server/store/request";
import { listStaff } from "@/server/services/identity";
import { listBranches } from "@/server/services/tenancy";
import { invitableRoles } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/feedback";
import { StaffManager } from "@/features/staff-admin/staff-manager";

export const metadata: Metadata = { title: "Staff" };

export default function StaffPage() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading staff" />}>
      <Staff />
    </Suspense>
  );
}

async function Staff() {
  const actor = await requireStaffPage("staff.manage", "/admin/staff");
  const store = await getRequestStore();
  const [{ members, invitations }, branches] = await Promise.all([listStaff(store, actor), listBranches(store, actor)]);
  return (
    <>
      <PageHeader title="Staff" description="Invite people, set their role and the branches they can work in." />
      <StaffManager
        members={members}
        invitations={invitations}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        invitable={invitableRoles(actor.role)}
        currentUserId={actor.user.id}
      />
    </>
  );
}
