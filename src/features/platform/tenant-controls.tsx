"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { Tenant } from "@/types/domain";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/field";

export function TenantControls({ tenant, paymentStatus }: { tenant: Tenant; paymentStatus: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [maxBranches, setMaxBranches] = useState(String(tenant.features.maxBranches));
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const patch = (body: unknown) => apiFetch(`/platform/tenants/${tenant.id}`, { method: "PATCH", body });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {tenant.status !== "ACTIVE" && (
          <Button variant="success" loading={busy === "act"} onClick={() => run("act", () => patch({ status: "ACTIVE" }), "Tenant activated")}>
            Activate tenant
          </Button>
        )}
        {tenant.status !== "SUSPENDED" && (
          <Button
            variant="danger"
            loading={busy === "sus"}
            onClick={() => {
              if (confirm(`Suspend ${tenant.name}? Staff lose access and guests cannot order until reactivated.`))
                void run("sus", () => patch({ status: "SUSPENDED" }), "Tenant suspended");
            }}
          >
            Suspend
          </Button>
        )}
        {paymentStatus !== "ACTIVE" && (
          <Button
            variant="secondary"
            loading={busy === "pay"}
            onClick={() =>
              run("pay", () => apiFetch(`/platform/tenants/${tenant.id}/payment-connection/activate`, { method: "POST" }), "Mock payment connection activated")
            }
          >
            Activate test payments
          </Button>
        )}
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-bold">Entitlements</legend>
        <Switch
          label="Restaurant-managed delivery"
          checked={tenant.features.delivery}
          disabled={busy === "feat"}
          onChange={(e) => run("feat", () => patch({ features: { ...tenant.features, delivery: e.target.checked } }), "Entitlements updated")}
        />
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run("feat", () => patch({ features: { ...tenant.features, maxBranches: Number(maxBranches) } }), "Entitlements updated");
          }}
        >
          <label htmlFor="maxb" className="text-sm">
            Max branches
          </label>
          <input
            id="maxb"
            type="number"
            min={1}
            max={500}
            value={maxBranches}
            onChange={(e) => setMaxBranches(e.target.value)}
            className="h-9 w-20 rounded-lg border border-line-strong px-2 text-sm"
          />
          <Button type="submit" size="sm" variant="secondary">
            Save
          </Button>
        </form>
      </fieldset>
    </div>
  );
}
