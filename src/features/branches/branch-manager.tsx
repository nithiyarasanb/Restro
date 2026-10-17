"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Clock, MapPin, Pencil, Plus, Power } from "lucide-react";
import type { Branch } from "@/types/domain";
import { branchSchema, type BranchInput } from "@/lib/validation";
import { apiFetch, ApiError, errorMessage } from "@/lib/api-client";
import { formatMoney, parseMajor, toMajorString } from "@/lib/money";
import { bpsToPercent } from "@/lib/utils";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Switch } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
  branches: Branch[];
  currency: string;
  canCreate: boolean;
  canGoLive: boolean;
  canEditTax: boolean;
  deliveryAllowed: boolean;
  maxBranches: number;
}

export function BranchManager({ branches, currency, canCreate, canGoLive, canEditTax, deliveryAllowed, maxBranches }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<Branch | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const toggleLive = async (b: Branch) => {
    setBusy(b.id);
    try {
      await apiFetch(`/branches/${b.id}/live`, { method: "POST", body: { live: !b.isLive } });
      toast.success(b.isLive ? `${b.name} is offline` : `${b.name} is live`);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {canCreate && (
        <div className="mb-4 flex items-center justify-end gap-3">
          <span className="text-sm text-muted">
            {branches.length} of {maxBranches} branches on your plan
          </span>
          <Button onClick={() => setEditing("new")} disabled={branches.length >= maxBranches} icon={<Plus className="size-4" aria-hidden />}>
            New branch
          </Button>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {branches.map((b) => (
          <Card key={b.id}>
            <CardHeader
              title={b.name}
              description={
                <span className="flex items-start gap-1">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {b.address}
                </span>
              }
              actions={
                <>
                  <Badge tone={b.isLive ? "success" : "neutral"}>{b.isLive ? "Live" : "Not live"}</Badge>
                  {b.isLive && !b.acceptingOrders && <Badge tone="warning">Paused</Badge>}
                </>
              }
            />
            <CardBody>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">Tax</dt>
                <dd className="font-semibold">{bpsToPercent(b.taxRateBps)}</dd>
                <dt className="text-muted">Service charge (dine-in)</dt>
                <dd className="font-semibold">{bpsToPercent(b.serviceChargeBps)}</dd>
                <dt className="text-muted">Takeaway</dt>
                <dd className="font-semibold">{b.takeawayEnabled ? "On" : "Off"}</dd>
                <dt className="text-muted">Delivery</dt>
                <dd className="font-semibold">{b.deliveryEnabled ? `On · ${formatMoney(b.deliveryFeeMinor, currency)} fee` : "Off"}</dd>
                <dt className="text-muted">Hours</dt>
                <dd className="font-semibold">
                  <span className="flex items-center gap-1">
                    <Clock className="size-3.5" aria-hidden />
                    {b.openingHours.length === 0
                      ? "Always open"
                      : b.openingHours.every((h) => h.open === b.openingHours[0].open && h.close === b.openingHours[0].close) && b.openingHours.length === 7
                        ? `Daily ${b.openingHours[0].open}–${b.openingHours[0].close}`
                        : `${b.openingHours.length} time slots`}
                  </span>
                </dd>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(b)} icon={<Pencil className="size-4" aria-hidden />}>
                  Edit settings
                </Button>
                {canGoLive && (
                  <Button
                    size="sm"
                    variant={b.isLive ? "ghost" : "success"}
                    loading={busy === b.id}
                    onClick={() => toggleLive(b)}
                    icon={<Power className="size-4" aria-hidden />}
                  >
                    {b.isLive ? "Take offline" : "Go live"}
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
      {editing && (
        <BranchDialog
          branch={editing === "new" ? null : editing}
          currency={currency}
          canEditTax={canEditTax}
          deliveryAllowed={deliveryAllowed}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </>
  );
}

function BranchDialog({
  branch,
  currency,
  canEditTax,
  deliveryAllowed,
  onClose,
  onSaved,
}: {
  branch: Branch | null;
  currency: string;
  canEditTax: boolean;
  deliveryAllowed: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [v, setV] = useState({
    name: branch?.name ?? "",
    address: branch?.address ?? "",
    phone: branch?.phone ?? "",
    timezone: branch?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    tax: String((branch?.taxRateBps ?? 500) / 100),
    service: String((branch?.serviceChargeBps ?? 0) / 100),
    takeawayEnabled: branch?.takeawayEnabled ?? true,
    deliveryEnabled: branch?.deliveryEnabled ?? false,
    deliveryFee: toMajorString(branch?.deliveryFeeMinor ?? 0, currency),
    acceptingOrders: branch?.acceptingOrders ?? true,
  });
  const [hours, setHours] = useState(() =>
    DAYS.map((_, day) => {
      const h = branch?.openingHours.find((x) => x.day === day);
      return { day, open: h?.open ?? "11:00", close: h?.close ?? "23:00", closed: branch ? branch.openingHours.length > 0 && !h : false };
    }),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const save = async () => {
    const pctToBps = (s: string) => (/^\d{1,2}(\.\d{1,2})?$/.test(s.trim()) ? Math.round(Number(s) * 100) : -1);
    const body: BranchInput = {
      name: v.name,
      address: v.address,
      phone: v.phone.trim() || null,
      timezone: v.timezone,
      taxRateBps: pctToBps(v.tax),
      serviceChargeBps: pctToBps(v.service),
      takeawayEnabled: v.takeawayEnabled,
      deliveryEnabled: v.deliveryEnabled,
      deliveryFeeMinor: parseMajor(v.deliveryFee || "0", currency) ?? -1,
      acceptingOrders: v.acceptingOrders,
      openingHours: hours.filter((h) => !h.closed).map(({ day, open, close }) => ({ day, open, close })),
    };
    const parsed = branchSchema.safeParse(body);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues)
        next[String(i.path[0])] ??= i.path[0] === "taxRateBps" || i.path[0] === "serviceChargeBps" ? "Enter a percentage like 5 or 12.5" : i.message;
      return setErrors(next);
    }
    setBusy(true);
    try {
      await apiFetch(branch ? `/branches/${branch.id}` : "/branches", { method: branch ? "PATCH" : "POST", body: parsed.data });
      toast.success(branch ? "Branch saved" : "Branch created (not live yet)");
      onSaved();
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErrors({ ...e.fieldErrors(), _: e.message });
      else setErrors({ _: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={branch ? `Edit ${branch.name}` : "New branch"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {errors._ && <Notice tone="danger">{errors._}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={errors.name}>
            {(p) => <Input {...p} value={v.name} onChange={set("name")} />}
          </Field>
          <Field label="Phone" error={errors.phone}>
            {(p) => <Input {...p} type="tel" value={v.phone} onChange={set("phone")} />}
          </Field>
          <Field label="Address" required error={errors.address} className="sm:col-span-2">
            {(p) => <Input {...p} value={v.address} onChange={set("address")} />}
          </Field>
          <Field label="Timezone" required error={errors.timezone} hint="IANA name, e.g. Asia/Kolkata">
            {(p) => <Input {...p} value={v.timezone} onChange={set("timezone")} />}
          </Field>
          <Field label="Delivery fee" error={errors.deliveryFeeMinor} hint={currency}>
            {(p) => <Input {...p} inputMode="decimal" value={v.deliveryFee} onChange={set("deliveryFee")} disabled={!deliveryAllowed} />}
          </Field>
          <Field label="Tax (%)" error={errors.taxRateBps} hint={canEditTax ? "Prices are tax-exclusive (assumption A3)." : "Only the owner can change tax."}>
            {(p) => <Input {...p} inputMode="decimal" value={v.tax} onChange={set("tax")} disabled={!canEditTax} />}
          </Field>
          <Field label="Service charge (%)" error={errors.serviceChargeBps} hint="Dine-in orders only.">
            {(p) => <Input {...p} inputMode="decimal" value={v.service} onChange={set("service")} disabled={!canEditTax} />}
          </Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <Switch label="Accepting online orders" checked={v.acceptingOrders} onChange={set("acceptingOrders")} />
          <Switch label="Takeaway" checked={v.takeawayEnabled} onChange={set("takeawayEnabled")} />
          <Switch
            label={deliveryAllowed ? "Delivery" : "Delivery (not in your plan)"}
            checked={v.deliveryEnabled}
            onChange={set("deliveryEnabled")}
            disabled={!deliveryAllowed}
          />
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-bold">Opening hours</legend>
          <ul className="space-y-1.5">
            {hours.map((h, i) => (
              <li key={h.day} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-10 font-semibold">{DAYS[h.day]}</span>
                <input
                  type="time"
                  aria-label={`${DAYS[h.day]} opens`}
                  value={h.open}
                  disabled={h.closed}
                  onChange={(e) => setHours((hs) => hs.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)))}
                  className="h-8 rounded-lg border border-line-strong px-2 disabled:opacity-40"
                />
                <span aria-hidden>–</span>
                <input
                  type="time"
                  aria-label={`${DAYS[h.day]} closes`}
                  value={h.close}
                  disabled={h.closed}
                  onChange={(e) => setHours((hs) => hs.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)))}
                  className="h-8 rounded-lg border border-line-strong px-2 disabled:opacity-40"
                />
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={h.closed}
                    onChange={(e) => setHours((hs) => hs.map((x, j) => (j === i ? { ...x, closed: e.target.checked } : x)))}
                    className="accent-brand-600"
                  />{" "}
                  Closed
                </label>
              </li>
            ))}
          </ul>
          {errors.openingHours && <p className="mt-1 text-xs font-bold text-danger-700">{errors.openingHours}</p>}
          <p className="mt-1 text-xs text-muted">A closing time earlier than the opening time runs past midnight.</p>
        </fieldset>
      </div>
    </Dialog>
  );
}
