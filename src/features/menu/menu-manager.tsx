"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import type { AdminMenuView } from "@/types/api";
import type { ModifierGroup } from "@/types/domain";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { formatMoney, parseMajor, toMajorString } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Switch } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { ModifierGroupDialog } from "./modifier-group-dialog";

interface Props {
  menu: AdminMenuView;
  currency: string;
  canManage: boolean;
}

type Tab = "items" | "categories" | "modifiers";

export function MenuManager({ menu, currency, canManage }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("items");
  const [branchId, setBranchId] = useState(menu.branches[0]?.id ?? "");
  const [pending, setPending] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<ModifierGroup | "new" | null>(null);
  const [newCategory, setNewCategory] = useState("");

  const call = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setPending(key);
    try {
      await fn();
      toast.success(success);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  const override = (itemId: string) => menu.branchItems[branchId]?.[itemId];
  const tabs: Array<[Tab, string]> = [
    ["items", `Items (${menu.items.length})`],
    ["categories", `Categories (${menu.categories.length})`],
    ["modifiers", `Modifier groups (${menu.modifierGroups.length})`],
  ];

  return (
    <>
      <div role="tablist" aria-label="Menu sections" className="mb-4 flex gap-1 border-b border-line">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-bold",
              tab === key ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "items" && (
        <div role="tabpanel" id="panel-items" aria-labelledby="tab-items" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              Availability & price at
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="h-9 rounded-lg border border-line-strong bg-surface px-2">
                {menu.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            {canManage && (
              <ButtonLink href="/admin/menu/items/new" className="ml-auto" icon={<Plus className="size-4" aria-hidden />}>
                New item
              </ButtonLink>
            )}
          </div>
          {menu.categories.map((c) => {
            const items = menu.items.filter((i) => i.categoryId === c.id);
            return (
              <Card key={c.id}>
                <CardHeader as="h3" title={c.name} description={`${items.length} item(s)`} />
                {items.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-muted">No items yet.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {items.map((item) => {
                      const o = override(item.id);
                      const available = o?.isAvailable ?? true;
                      return (
                        <li key={item.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
                          <div className="flex min-w-48 flex-1 items-center gap-3">
                            {menu.imageUrls[item.id] ? (
                              // eslint-disable-next-line @next/next/no-img-element -- signed private image URL
                              <img src={menu.imageUrls[item.id]} alt="" className="size-10 rounded-lg object-cover" />
                            ) : (
                              <div className="size-10 rounded-lg bg-canvas" aria-hidden />
                            )}
                            <div>
                              <p className={cn("font-semibold", !available && "text-muted line-through")}>{item.name}</p>
                              <p className="text-xs text-muted">
                                {formatMoney(item.basePriceMinor, currency)}
                                {item.variants.length > 0 && ` · ${item.variants.length} sizes`}
                                {item.modifierGroupIds.length > 0 && ` · ${item.modifierGroupIds.length} modifier group(s)`}
                              </p>
                            </div>
                          </div>
                          <PriceOverride
                            key={`${branchId}-${item.id}-${o?.priceOverrideMinor ?? "none"}`}
                            currency={currency}
                            base={item.basePriceMinor}
                            value={o?.priceOverrideMinor ?? null}
                            busy={pending === `price-${item.id}`}
                            label={item.name}
                            onSave={(minor) =>
                              call(
                                `price-${item.id}`,
                                () => apiFetch(`/branches/${branchId}/menu-items/${item.id}`, { method: "PATCH", body: { priceOverrideMinor: minor } }),
                                minor === null ? "Branch price cleared" : "Branch price saved",
                              )
                            }
                          />
                          <AvailabilitySwitch
                            key={`${branchId}-${item.id}-${available}`}
                            name={item.name}
                            initial={available}
                            onChange={(next) => apiFetch(`/branches/${branchId}/menu-items/${item.id}`, { method: "PATCH", body: { isAvailable: next } })}
                            onSaved={() => router.refresh()}
                          />
                          {canManage && (
                            <div className="flex gap-1">
                              <Link
                                href={`/admin/menu/items/${item.id}`}
                                className="rounded-lg p-2 text-muted hover:bg-canvas hover:text-ink"
                                aria-label={`Edit ${item.name}`}
                              >
                                <Pencil className="size-4" aria-hidden />
                              </Link>
                              <button
                                type="button"
                                className="rounded-lg p-2 text-muted hover:bg-canvas hover:text-danger-700"
                                aria-label={`Retire ${item.name}`}
                                onClick={() => {
                                  if (confirm(`Retire “${item.name}”? It disappears from the menu; past orders keep their snapshot.`))
                                    void call(
                                      `retire-${item.id}`,
                                      () => apiFetch(`/menu/items/${item.id}/retire`, { method: "POST", body: { retired: true } }),
                                      `${item.name} retired`,
                                    );
                                }}
                              >
                                <Archive className="size-4" aria-hidden />
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {tab === "categories" && (
        <div role="tabpanel" id="panel-categories" aria-labelledby="tab-categories">
          <Card>
            <CardHeader title="Categories" description="Shown to guests in this order." />
            <ul className="divide-y divide-line">
              {menu.categories.map((c, idx) => (
                <li key={c.id} className="flex items-center justify-between gap-2 px-5 py-3">
                  <span className="font-semibold">
                    <span className="mr-2 text-muted tabular">{idx + 1}.</span>
                    {c.name}
                  </span>
                  {canManage && (
                    <span className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const name = prompt("Rename category", c.name);
                          if (name && name.trim() !== c.name)
                            void call(
                              `cat-${c.id}`,
                              () => apiFetch(`/menu/categories/${c.id}`, { method: "PATCH", body: { name: name.trim() } }),
                              "Category renamed",
                            );
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          call(`cat-${c.id}`, () => apiFetch(`/menu/categories/${c.id}`, { method: "PATCH", body: { retired: true } }), "Category retired")
                        }
                      >
                        Retire
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {canManage && (
              <form
                className="flex gap-2 border-t border-line px-5 py-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newCategory.trim()) return;
                  void call(
                    "cat-new",
                    () => apiFetch("/menu/categories", { method: "POST", body: { name: newCategory.trim(), sortOrder: (menu.categories.length + 1) * 10 } }),
                    "Category added",
                  ).then(() => setNewCategory(""));
                }}
              >
                <label htmlFor="new-cat" className="sr-only">
                  New category name
                </label>
                <input
                  id="new-cat"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  maxLength={60}
                  placeholder="New category name"
                  className="h-10 flex-1 rounded-lg border border-line-strong px-3 text-sm"
                />
                <Button type="submit" loading={pending === "cat-new"} icon={<Plus className="size-4" aria-hidden />}>
                  Add
                </Button>
              </form>
            )}
          </Card>
        </div>
      )}

      {tab === "modifiers" && (
        <div role="tabpanel" id="panel-modifiers" aria-labelledby="tab-modifiers" className="space-y-4">
          {canManage && (
            <div className="flex justify-end">
              <Button onClick={() => setEditingGroup("new")} icon={<Plus className="size-4" aria-hidden />}>
                New modifier group
              </Button>
            </div>
          )}
          {menu.modifierGroups.length === 0 && <EmptyState title="No modifier groups" description="Use them for spice level, add-ons, dips and so on." />}
          <div className="grid gap-4 md:grid-cols-2">
            {menu.modifierGroups.map((g) => {
              const usedBy = menu.items.filter((i) => i.modifierGroupIds.includes(g.id));
              return (
                <Card key={g.id}>
                  <CardHeader
                    as="h3"
                    title={g.name}
                    description={
                      g.minSelect > 0
                        ? `Required · choose ${g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}–${g.maxSelect}`}`
                        : `Optional · up to ${g.maxSelect}`
                    }
                    actions={
                      canManage && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setEditingGroup(g)}>
                            Edit
                          </Button>
                          {usedBy.length === 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                call(
                                  `grp-${g.id}`,
                                  () => apiFetch(`/menu/modifier-groups/${g.id}/retire`, { method: "POST", body: { retired: true } }),
                                  "Group retired",
                                )
                              }
                            >
                              <ArchiveRestore className="size-4" aria-hidden /> Retire
                            </Button>
                          )}
                        </>
                      )
                    }
                  />
                  <ul className="flex flex-wrap gap-2 px-5 py-3">
                    {g.options.map((o) => (
                      <li key={o.id}>
                        <Badge tone={o.isAvailable ? "neutral" : "danger"}>
                          {o.name}
                          {o.priceDeltaMinor > 0 && ` +${formatMoney(o.priceDeltaMinor, currency, { compact: true })}`}
                          {!o.isAvailable && " · unavailable"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                  <p className="border-t border-line px-5 py-2 text-xs text-muted">Used by: {usedBy.map((i) => i.name).join(", ") || "no items"}</p>
                </Card>
              );
            })}
          </div>
        </div>
      )}
      {editingGroup && (
        <ModifierGroupDialog
          group={editingGroup === "new" ? null : editingGroup}
          currency={currency}
          onClose={() => setEditingGroup(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </>
  );
}

function PriceOverride({
  currency,
  base,
  value,
  onSave,
  busy,
  label,
}: {
  currency: string;
  base: number;
  value: number | null;
  onSave: (minor: number | null) => void;
  busy: boolean;
  label: string;
}) {
  const [text, setText] = useState(value === null ? "" : toMajorString(value, currency));
  const [error, setError] = useState(false);
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return onSave(null);
        const minor = parseMajor(text, currency);
        if (minor === null) return setError(true);
        onSave(minor);
      }}
    >
      <label className="text-xs text-muted" htmlFor={`price-${label}`}>
        Branch price
      </label>
      <input
        id={`price-${label}`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(false);
        }}
        placeholder={toMajorString(base, currency)}
        inputMode="decimal"
        aria-invalid={error || undefined}
        aria-label={`Branch price for ${label} (blank uses base price)`}
        className="h-8 w-24 rounded-lg border border-line-strong px-2 text-sm tabular aria-[invalid=true]:border-danger-600"
      />
      <Button type="submit" size="sm" variant="secondary" loading={busy}>
        Save
      </Button>
    </form>
  );
}

/** Optimistic sold-out switch: flips immediately, rolls back if the server refuses. */
function AvailabilitySwitch({
  name,
  initial,
  onChange,
  onSaved,
}: {
  name: string;
  initial: boolean;
  onChange: (next: boolean) => Promise<unknown>;
  onSaved: () => void;
}) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Switch
      label={on ? "Available" : "Sold out"}
      checked={on}
      disabled={busy}
      onChange={async (e) => {
        const next = e.target.checked;
        setOn(next);
        setBusy(true);
        try {
          await onChange(next);
          toast.success(next ? `${name} is available` : `${name} marked sold out`);
          onSaved();
        } catch (err) {
          setOn(!next);
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
