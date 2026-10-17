"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Clock, MapPin, Minus, Plus, ShoppingBag, UtensilsCrossed } from "lucide-react";
import type { PublicMenu, PublicMenuItem } from "@/types/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { DemoTag } from "@/components/ui/badge";
import { cart, cartCount, cartEstimate, useCart, type CartContext } from "@/features/cart/cart-store";

const SWATCHES = ["#f2a65a", "#e7704f", "#8fb380", "#e8c66b", "#c58fc4", "#7fb3d5", "#d98f6e", "#a3b86c"];
function swatch(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SWATCHES[h % SWATCHES.length];
}

export function DietaryMark({ dietary }: { dietary: PublicMenuItem["dietary"] }) {
  if (!dietary) return null;
  const meta = {
    VEG: { color: "#22803f", label: "Vegetarian" },
    VEGAN: { color: "#22803f", label: "Vegan" },
    EGG: { color: "#b7791f", label: "Contains egg" },
    NON_VEG: { color: "#a12424", label: "Non-vegetarian" },
  }[dietary];
  return (
    <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] border-2" style={{ borderColor: meta.color }} title={meta.label}>
      <span className="size-1.5 rounded-full" style={{ background: meta.color }} aria-hidden />
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}

function ItemThumb({ item, className }: { item: PublicMenuItem; className?: string }) {
  if (item.imageUrl)
    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URLs from our file route
    return <img src={item.imageUrl} alt="" className={cn("rounded-xl object-cover", className)} loading="lazy" />;
  return (
    <div
      className={cn("flex items-center justify-center rounded-xl text-2xl font-black text-white", className)}
      style={{ background: swatch(item.name) }}
      aria-hidden
    >
      {item.name.charAt(0)}
    </div>
  );
}

interface Props {
  menu: PublicMenu;
  context: CartContext;
  isDemo: boolean;
}

export function MenuScreen({ menu, context, isDemo }: Props) {
  const state = useCart();
  const [active, setActive] = useState<PublicMenuItem | null>(null);
  const [activeCategory, setActiveCategory] = useState(menu.categories[0]?.id ?? "");
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const currency = menu.restaurant.currency;
  const ordering = menu.branch.isLive && menu.branch.acceptingOrders && menu.branch.isOpenNow;

  // Bind the cart to this table/branch; a different context starts a new cart.
  useEffect(() => {
    if (cart.setContext(context)) toast.info(`Started a new order for ${context.kind === "table" ? context.tableLabel : context.branchName}`);
  }, [context]);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveCategory(visible.target.id.replace("cat-", ""));
      },
      { rootMargin: "-120px 0px -60% 0px" },
    );
    sectionRefs.current.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const byCategory = useMemo(() => menu.categories.map((c) => ({ ...c, items: menu.items.filter((i) => i.categoryId === c.id) })), [menu]);
  const count = cartCount(state);
  const estimate = cartEstimate(state);

  const quickAdd = (item: PublicMenuItem) => {
    const needsChoice = item.variants.length > 0 || item.modifierGroupIds.length > 0;
    if (needsChoice) return setActive(item);
    cart.add({
      menuItemId: item.id,
      name: item.name,
      variantId: null,
      variantName: null,
      modifierOptionIds: [],
      modifierLabels: [],
      quantity: 1,
      notes: null,
      unitEstimateMinor: item.priceMinor,
    });
    toast.success(`${item.name} added`, { duration: 1500 });
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-surface pb-28 sm:my-6 sm:min-h-0 sm:rounded-3xl sm:border sm:border-line sm:shadow-[var(--shadow-card)]">
      <header className="bg-brand-600 px-5 pt-6 pb-5 text-white sm:rounded-t-3xl">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold tracking-wide text-white uppercase">
            {menu.branch.name}
            {menu.table ? ` · ${menu.table.label}` : context.kind === "branch" ? ` · ${context.fulfillmentType === "DELIVERY" ? "Delivery" : "Takeaway"}` : ""}
          </p>
          {isDemo && <DemoTag>DEMO</DemoTag>}
        </div>
        <h1 className="mt-1 text-2xl font-black">{menu.restaurant.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-4" aria-hidden />
            {menu.branch.isOpenNow ? "Open now" : "Closed now"}
          </span>
          <span className="inline-flex items-center gap-1">
            {menu.table ? <UtensilsCrossed className="size-4" aria-hidden /> : <MapPin className="size-4" aria-hidden />}
            {menu.table ? "Dine-in" : menu.branch.address}
          </span>
        </p>
      </header>

      {!ordering && (
        <Notice tone="warning" className="m-4" title={!menu.branch.isOpenNow ? "This branch is closed right now" : "Online ordering is paused"}>
          You can browse the menu, but new orders can&apos;t be placed at the moment.
        </Notice>
      )}

      <nav aria-label="Menu categories" className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <ul className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-3">
          {menu.categories.map((c) => (
            <li key={c.id}>
              <a
                href={`#cat-${c.id}`}
                aria-current={activeCategory === c.id ? "true" : undefined}
                className={cn(
                  "block rounded-full px-3.5 py-1.5 text-sm font-bold whitespace-nowrap transition-colors",
                  activeCategory === c.id ? "bg-navy-900 text-white" : "bg-canvas text-ink-soft hover:bg-line",
                )}
              >
                {c.name}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <main id="main" className="flex-1">
        {byCategory.map((c) => (
          <section
            key={c.id}
            id={`cat-${c.id}`}
            aria-labelledby={`cat-h-${c.id}`}
            className="scroll-mt-16"
            ref={(el) => {
              if (el) sectionRefs.current.set(c.id, el);
            }}
          >
            <h2 id={`cat-h-${c.id}`} className="px-5 pt-5 pb-1 text-lg font-black">
              {c.name}
            </h2>
            <ul>
              {c.items.map((item) => (
                <li key={item.id} className="flex gap-4 border-b border-line px-5 py-4 last:border-0">
                  <ItemThumb item={item} className={cn("size-20 shrink-0", !item.available && "opacity-40 grayscale")} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-start gap-2">
                      <DietaryMark dietary={item.dietary} />
                      <h3 className={cn("leading-tight font-bold", !item.available && "text-muted")}>{item.name}</h3>
                    </div>
                    {item.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{item.description}</p>}
                    <div className="mt-auto flex items-center justify-between pt-2">
                      <span className="font-bold tabular">
                        {formatMoney(item.priceMinor, currency, { compact: true })}
                        {item.variants.length > 0 && <span className="ml-1 text-xs font-semibold text-muted">onwards</span>}
                      </span>
                      {item.available ? (
                        <button
                          type="button"
                          onClick={() => quickAdd(item)}
                          disabled={!ordering}
                          className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-40"
                          aria-label={`Add ${item.name}`}
                        >
                          <Plus className="size-4" aria-hidden /> Add
                        </button>
                      ) : (
                        <span className="rounded-full bg-canvas px-3 py-1 text-xs font-bold text-muted">Sold out</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-2xl p-4 sm:bottom-4">
          <Link
            href="/checkout"
            className="flex items-center justify-between rounded-2xl bg-navy-900 px-5 py-4 font-bold text-white shadow-[var(--shadow-pop)] hover:bg-navy-800"
          >
            <span className="inline-flex items-center gap-2">
              <ShoppingBag className="size-5" aria-hidden /> View cart · {count} {count === 1 ? "item" : "items"}
            </span>
            <span className="tabular">{formatMoney(estimate, currency, { compact: true })}</span>
          </Link>
        </div>
      )}

      {active && <ItemDialog item={active} menu={menu} onClose={() => setActive(null)} />}
    </div>
  );
}

function ItemDialog({ item, menu, onClose }: { item: PublicMenuItem; menu: PublicMenu; onClose: () => void }) {
  const currency = menu.restaurant.currency;
  const [variantId, setVariantId] = useState(item.variants.find((v) => v.isDefault)?.id ?? null);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const groups = item.modifierGroupIds.map((id) => menu.modifierGroups[id]).filter(Boolean);

  const variant = item.variants.find((v) => v.id === variantId) ?? null;
  const chosen = groups.flatMap((g) => (selected[g.id] ?? []).map((oid) => g.options.find((o) => o.id === oid)!).filter(Boolean));
  const unit = item.priceMinor + (variant?.priceDeltaMinor ?? 0) + chosen.reduce((s, o) => s + o.priceDeltaMinor, 0);
  const groupError = (g: (typeof groups)[number]) => {
    const n = (selected[g.id] ?? []).length;
    if (n < g.minSelect) return g.minSelect === 1 ? "Choose one" : `Choose at least ${g.minSelect}`;
    if (n > g.maxSelect) return `Choose up to ${g.maxSelect}`;
    return null;
  };
  const invalid = groups.some(groupError);

  const toggle = (groupId: string, optionId: string, single: boolean) =>
    setSelected((s) => {
      const cur = s[groupId] ?? [];
      if (single) return { ...s, [groupId]: [optionId] };
      return { ...s, [groupId]: cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId] };
    });

  const add = () => {
    if (invalid) return setShowErrors(true);
    cart.add({
      menuItemId: item.id,
      name: item.name,
      variantId,
      variantName: variant?.name ?? null,
      modifierOptionIds: chosen.map((o) => o.id),
      modifierLabels: chosen.map((o) => o.name),
      quantity,
      notes: notes.trim() || null,
      unitEstimateMinor: unit,
    });
    toast.success(`${item.name} added`, { duration: 1500 });
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={item.name}
      description={item.description}
      footer={
        <div className="flex w-full items-center gap-3">
          <div className="flex items-center rounded-xl border border-line-strong" role="group" aria-label="Quantity">
            <button
              type="button"
              className="p-2.5 disabled:opacity-30"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              aria-label="Decrease quantity"
            >
              <Minus className="size-4" aria-hidden />
            </button>
            <span className="w-8 text-center font-bold tabular" aria-live="polite">
              {quantity}
            </span>
            <button
              type="button"
              className="p-2.5 disabled:opacity-30"
              onClick={() => setQuantity((q) => Math.min(50, q + 1))}
              disabled={quantity >= 50}
              aria-label="Increase quantity"
            >
              <Plus className="size-4" aria-hidden />
            </button>
          </div>
          <Button size="lg" className="flex-1" onClick={add}>
            Add · {formatMoney(unit * quantity, currency, { compact: true })}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {item.variants.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-sm font-bold">Size</legend>
            <div className="space-y-2">
              {item.variants.map((v) => (
                <label
                  key={v.id}
                  className="flex cursor-pointer items-center justify-between rounded-xl border border-line px-3 py-2.5 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"
                >
                  <span className="flex items-center gap-2">
                    <input type="radio" name="variant" className="accent-brand-600" checked={variantId === v.id} onChange={() => setVariantId(v.id)} />
                    {v.name}
                  </span>
                  <span className="text-sm text-muted tabular">
                    {v.priceDeltaMinor ? `+${formatMoney(v.priceDeltaMinor, currency, { compact: true })}` : ""}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {groups.map((g) => {
          const single = g.maxSelect === 1;
          const err = showErrors ? groupError(g) : null;
          return (
            <fieldset key={g.id} aria-describedby={err ? `err-${g.id}` : undefined}>
              <legend className="mb-2 flex w-full items-center justify-between text-sm font-bold">
                <span>{g.name}</span>
                <span className="text-xs font-semibold text-muted">
                  {g.minSelect > 0 ? (single ? "Required" : `Choose ${g.minSelect}–${g.maxSelect}`) : `Optional · up to ${g.maxSelect}`}
                </span>
              </legend>
              <div className="space-y-2">
                {g.options.map((o) => {
                  const checked = (selected[g.id] ?? []).includes(o.id);
                  return (
                    <label
                      key={o.id}
                      className={cn(
                        "flex items-center justify-between rounded-xl border border-line px-3 py-2.5",
                        o.isAvailable ? "cursor-pointer has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50" : "opacity-50",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type={single ? "radio" : "checkbox"}
                          name={`g-${g.id}`}
                          className="accent-brand-600"
                          checked={checked}
                          disabled={!o.isAvailable}
                          onChange={() => toggle(g.id, o.id, single)}
                        />
                        {o.name}
                        {!o.isAvailable && <span className="text-xs text-muted">(unavailable)</span>}
                      </span>
                      <span className="text-sm text-muted tabular">
                        {o.priceDeltaMinor ? `+${formatMoney(o.priceDeltaMinor, currency, { compact: true })}` : ""}
                      </span>
                    </label>
                  );
                })}
              </div>
              {err && (
                <p id={`err-${g.id}`} role="alert" className="mt-1 text-xs font-bold text-danger-700">
                  {err}
                </p>
              )}
            </fieldset>
          );
        })}
        <div>
          <label htmlFor="item-notes" className="mb-1 block text-sm font-bold">
            Note for the kitchen <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="item-notes"
            maxLength={140}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. less oil"
            className="h-10 w-full rounded-lg border border-line-strong px-3 text-sm"
          />
        </div>
      </div>
    </Dialog>
  );
}
