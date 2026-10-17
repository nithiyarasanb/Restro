import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePlatformPage } from "@/server/auth/current";
import { getRequestStore } from "@/server/store/request";
import { listAudit } from "@/server/services/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { AuditTable } from "@/features/audit/audit-table";

export const metadata: Metadata = { title: "Platform audit" };

export default function PlatformAuditPage(props: PageProps<"/platform/audit">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Audit searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Audit({ searchParams }: { searchParams: PageProps<"/platform/audit">["searchParams"] }) {
  const actor = await requirePlatformPage("/platform/audit");
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const store = await getRequestStore();
  const [r, tenants] = await Promise.all([listAudit(store, actor, page), store.listTenants()]);
  return (
    <>
      <PageHeader title="Platform audit" description="Every privileged action across all tenants, including sign-ins." />
      <Card>
        <AuditTable items={r.items} tenantNames={new Map(tenants.map((t) => [t.id, t.name]))} />
        <Pagination page={r.page} pageSize={r.pageSize} total={r.total} hrefFor={(p) => `/platform/audit?page=${p}`} />
      </Card>
    </>
  );
}
