import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaffPage } from "@/server/auth/current";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { TenantSettingsForm } from "@/features/settings/tenant-settings-form";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  const actor = await requireStaffPage("tenant.settings", "/admin/settings");
  const t = actor.tenant;
  return (
    <>
      <PageHeader title="Settings" description="Business details for your restaurant. Branch-level settings live under Branches." />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader title="Business profile" />
          <CardBody>
            <TenantSettingsForm defaults={{ name: t.name, legalName: t.legalName, timezone: t.timezone }} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Plan & region" description="Set by the platform team." />
          <CardBody>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Web address</dt>
                <dd className="font-mono">/r/{t.slug}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Country</dt>
                <dd className="font-semibold">{t.country}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Currency</dt>
                <dd className="font-semibold">{t.currency}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Branches allowed</dt>
                <dd className="font-semibold">{t.features.maxBranches}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Delivery</dt>
                <dd>
                  <Badge tone={t.features.delivery ? "success" : "neutral"}>{t.features.delivery ? "Enabled" : "Not included"}</Badge>
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-muted">Currency is fixed once orders exist, so historical amounts are never re-interpreted.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
