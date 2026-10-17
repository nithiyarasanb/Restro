import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { requirePlatformPage } from "@/server/auth/current";
import { getRequestStore } from "@/server/store/request";
import { listTenantSummaries } from "@/server/services/tenancy";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageSkeleton } from "@/components/ui/feedback";
import { DataTable, Td, Th, Tr } from "@/components/ui/table";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Tenants" };

export default function PlatformHome() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading tenants" />}>
      <Tenants />
    </Suspense>
  );
}

async function Tenants() {
  const actor = await requirePlatformPage("/platform");
  const tenants = await listTenantSummaries(await getRequestStore(), actor);
  return (
    <>
      <PageHeader
        title="Tenants"
        description="Each restaurant business is isolated: its data, staff and payment connection never cross tenants."
        actions={
          <ButtonLink href="/platform/tenants/new" icon={<Plus className="size-4" aria-hidden />}>
            Onboard restaurant
          </ButtonLink>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Tenants" value={tenants.length} />
        <StatCard label="Active" value={tenants.filter((t) => t.status === "ACTIVE").length} />
        <StatCard label="Onboarding" value={tenants.filter((t) => t.status === "ONBOARDING").length} />
        <StatCard label="Live branches" value={tenants.reduce((s, t) => s + t.liveBranchCount, 0)} />
      </div>
      <Card>
        <DataTable caption="Tenants">
          <thead>
            <tr>
              <Th>Restaurant</Th>
              <Th>Status</Th>
              <Th>Region</Th>
              <Th>Branches</Th>
              <Th>Staff</Th>
              <Th>Orders (30 d)</Th>
              <Th>Payments</Th>
              <Th>Since</Th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <Tr key={t.id}>
                <Td>
                  <Link href={`/platform/tenants/${t.id}`} className="font-bold text-brand-700 hover:underline">
                    {t.name}
                  </Link>
                  <span className="block font-mono text-xs text-muted">{t.slug}</span>
                </Td>
                <Td>
                  <Badge tone={t.status === "ACTIVE" ? "success" : t.status === "SUSPENDED" ? "danger" : "warning"}>{t.status.toLowerCase()}</Badge>
                </Td>
                <Td>
                  {t.country} · {t.currency}
                </Td>
                <Td className="tabular">
                  {t.liveBranchCount}/{t.branchCount} live
                </Td>
                <Td className="tabular">{t.staffCount}</Td>
                <Td className="tabular">{t.ordersLast30Days}</Td>
                <Td>
                  <Badge tone={t.paymentConnectionStatus === "ACTIVE" ? "success" : "neutral"}>{t.paymentConnectionStatus.toLowerCase()}</Badge>
                </Td>
                <Td className="text-muted">{formatDate(t.createdAt)}</Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      </Card>
    </>
  );
}
