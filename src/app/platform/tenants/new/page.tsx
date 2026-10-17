import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePlatformPage } from "@/server/auth/current";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { OnboardForm } from "@/features/platform/onboard-form";

export const metadata: Metadata = { title: "Onboard restaurant" };

async function Guard() {
  await requirePlatformPage("/platform/tenants/new");
  return <OnboardForm />;
}

export default function OnboardPage() {
  return (
    <>
      <PageHeader
        title="Onboard a restaurant"
        description="Creates the tenant, its first branch (not live), a pending payment connection and a single-use owner invitation."
      />
      <Card className="max-w-3xl">
        <CardBody>
          <Suspense fallback={<Skeleton className="h-96" />}>
            <Guard />
          </Suspense>
        </CardBody>
      </Card>
    </>
  );
}
