"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

export function ReconcileButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      loading={busy}
      icon={<RefreshCw className="size-4" aria-hidden />}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await apiFetch<{ checked: number; captured: number; failed: number; cancelledOrders: number }>("/payments/reconciliation/run", {
            method: "POST",
          });
          toast.success(`Checked ${r.checked} pending payment(s): ${r.captured} captured, ${r.failed} failed, ${r.cancelledOrders} unpaid order(s) cancelled.`);
          router.refresh();
        } catch (e) {
          toast.error(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      Run reconciliation
    </Button>
  );
}
