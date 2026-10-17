import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requirePlatformPage } from "@/server/auth/current";
import { getRequestStore } from "@/server/store/request";
import { isDomainError } from "@/server/errors";
import { getTenantDetail } from "@/server/services/tenancy";
import { ROLE_LABELS } from "@/lib/permissions";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageSkeleton } from "@/components/ui/feedback";
import { DataTable, Td, Th } from "@/components/ui/table";
import { TenantControls } from "@/features/platform/tenant-controls";
import { AuditTable } from "@/features/audit/audit-table";

export const metadata: Metadata = { title: "Tenant" };

export default function TenantPage(props: PageProps<"/platform/tenants/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TenantDetail params={props.params} />
    </Suspense>
  );
}

async function TenantDetail({ params }: { params: PageProps<"/platform/tenants/[id]">["params"] }) {
  const { id } = await params;
  const actor = await requirePlatformPage(`/platform/tenants/${id}`);
  let d;
  try {
    d = await getTenantDetail(await getRequestStore(), actor, id);
  } catch (e) {
    if (isDomainError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const { tenant } = d;
  return (
    <>
      <PageHeader
        eyebrow="Tenant"
        title={
          <span className="flex items-center gap-3">
            {tenant.name}{" "}
            <Badge tone={tenant.status === "ACTIVE" ? "success" : tenant.status === "SUSPENDED" ? "danger" : "warning"}>{tenant.status.toLowerCase()}</Badge>
          </span>
        }
        description={`/r/${tenant.slug} · ${tenant.country} · ${tenant.currency} · ${tenant.timezone} · since ${formatDate(tenant.createdAt)}`}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader title="Controls" description={`Payment connection: ${d.paymentConnection?.status.toLowerCase() ?? "none"}`} />
          <CardBody>
            <TenantControls tenant={tenant} paymentStatus={d.paymentConnection?.status ?? "NONE"} />
          </CardBody>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title={`Branches (${d.branches.length})`} />
            <ul className="divide-y divide-line text-sm">
              {d.branches.map((b) => (
                <li key={b.id} className="flex items-center justify-between px-5 py-3">
                  <span>
                    <span className="font-semibold">{b.name}</span> <span className="text-muted">· {b.address}</span>
                  </span>
                  <Badge tone={b.isLive ? "success" : "neutral"}>{b.isLive ? "live" : "not live"}</Badge>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="People" />
            <DataTable caption="Staff and invitations">
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {d.staff.map((m) => (
                  <tr key={m.membershipId}>
                    <Td>
                      {m.name} <span className="block text-xs text-muted">{m.email}</span>
                    </Td>
                    <Td>{ROLE_LABELS[m.role]}</Td>
                    <Td>
                      <Badge tone={m.status === "ACTIVE" ? "success" : "neutral"}>{m.status.toLowerCase()}</Badge>
                    </Td>
                  </tr>
                ))}
                {d.invitations.map((i) => (
                  <tr key={i.id}>
                    <Td>
                      {i.email} <span className="block text-xs text-muted">invitation</span>
                    </Td>
                    <Td>{ROLE_LABELS[i.role]}</Td>
                    <Td>
                      <Badge tone={i.status === "PENDING" ? "warning" : "neutral"}>{i.status.toLowerCase()}</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Card>
          <Card>
            <CardHeader title="Recent activity" />
            <AuditTable items={d.recentAudit} timezone={tenant.timezone} />
          </Card>
        </div>
      </div>
    </>
  );
}
