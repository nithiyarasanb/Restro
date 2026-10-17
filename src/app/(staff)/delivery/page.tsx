import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaffPage } from "@/server/auth/current";
import { getConfig } from "@/server/config";
import { RunnerJobs } from "@/features/delivery/runner-jobs";
import { StaffTopBar } from "@/features/staff/staff-top-bar";
import { StaffMain, StaffScreenSkeleton } from "@/features/staff/staff-page";

export const metadata: Metadata = { title: "My deliveries" };

export default function DeliveryPage() {
  return (
    <Suspense fallback={<StaffScreenSkeleton title="deliveries" />}>
      <Delivery />
    </Suspense>
  );
}

async function Delivery() {
  const actor = await requireStaffPage(["delivery.run"], "/delivery");
  return (
    <>
      <StaffTopBar title="Deliveries" subtitle={actor.tenant.name} userName={actor.user.name} isDemo={getConfig().isDemo} />
      <StaffMain>
        <RunnerJobs />
      </StaffMain>
    </>
  );
}
