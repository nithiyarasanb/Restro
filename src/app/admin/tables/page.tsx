import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaffPage } from "@/server/auth/current";
import { getRequestStore } from "@/server/store/request";
import { listTables } from "@/server/services/tables";
import { listBranches } from "@/server/services/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/feedback";
import { TablesManager } from "@/features/tables/tables-manager";

export const metadata: Metadata = { title: "Tables & QR" };

export default function TablesPage() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading tables" />}>
      <Tables />
    </Suspense>
  );
}

async function Tables() {
  const actor = await requireStaffPage("tables.manage", "/admin/tables");
  const store = await getRequestStore();
  const [tables, branches] = await Promise.all([listTables(store, actor), listBranches(store, actor)]);
  return (
    <>
      <PageHeader
        title="Tables & QR codes"
        description="Each QR code is an opaque, revocable link to one table. It identifies the table — it never logs anyone in."
      />
      <TablesManager tables={tables} branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
    </>
  );
}
