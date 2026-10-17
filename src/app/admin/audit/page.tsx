import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaffPage } from "@/server/auth/current";
import { getRequestStore } from "@/server/store/request";
import { listAudit } from "@/server/services/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { AuditTable } from "@/features/audit/audit-table";

export const metadata: Metadata = { title: "Audit log" };

export default function AuditPage(props: PageProps<"/admin/audit">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Audit searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Audit({ searchParams }: { searchParams: PageProps<"/admin/audit">["searchParams"] }) {
  const actor = await requireStaffPage("audit.view", "/admin/audit");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const r = await listAudit(await getRequestStore(), actor, page);
  return (
    <>
      <PageHeader title="Audit log" description="Privileged changes to menu, tables, staff, branches, payments and settings." />
      <Card>
        <AuditTable items={r.items} timezone={actor.tenant.timezone} />
        <Pagination page={r.page} pageSize={r.pageSize} total={r.total} hrefFor={(p) => `/admin/audit?page=${p}`} />
      </Card>
    </>
  );
}
