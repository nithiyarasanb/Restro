"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  Building2,
  ChefHat,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  ListOrdered,
  Menu as MenuIcon,
  QrCode,
  ScrollText,
  Settings,
  UtensilsCrossed,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { SignOutButton } from "@/features/staff/sign-out-button";

const ICONS = {
  overview: LayoutDashboard,
  orders: ListOrdered,
  menu: UtensilsCrossed,
  tables: QrCode,
  branches: Building2,
  staff: Users,
  payments: CreditCard,
  reports: BarChart3,
  settings: Settings,
  audit: ScrollText,
  kitchen: ChefHat,
  counter: ClipboardList,
};
export type NavIcon = keyof typeof ICONS;

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
}

interface Props {
  items: NavItem[];
  shortcuts: NavItem[];
  tenantName: string;
  userName: string;
  roleLabel: string;
  otherTenants: Array<{ id: string; name: string }>;
}

function NavList({ items, shortcuts, onNavigate }: { items: NavItem[]; shortcuts: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));
  const link = (i: NavItem) => {
    const Icon = ICONS[i.icon];
    const active = isActive(i.href);
    return (
      <li key={i.href}>
        <Link
          href={i.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
            active ? "bg-white/12 text-white" : "text-white/70 hover:bg-white/8 hover:text-white",
          )}
        >
          <Icon className="size-4.5" aria-hidden /> {i.label}
        </Link>
      </li>
    );
  };
  return (
    <>
      <ul className="space-y-0.5">{items.map(link)}</ul>
      {shortcuts.length > 0 && (
        <>
          <p className="mt-6 mb-1 px-3 text-[11px] font-bold tracking-wider text-white/50 uppercase">Live screens</p>
          <ul className="space-y-0.5">{shortcuts.map(link)}</ul>
        </>
      )}
    </>
  );
}

function TenantSwitcher({ tenantName, otherTenants }: { tenantName: string; otherTenants: Props["otherTenants"] }) {
  const router = useRouter();
  if (otherTenants.length === 0) return <p className="truncate text-sm font-semibold text-white/85">{tenantName}</p>;
  return (
    <label className="block text-xs text-white/60">
      <span className="sr-only">Switch restaurant</span>
      <select
        className="mt-1 w-full rounded-lg border border-white/20 bg-navy-800 px-2 py-1.5 text-sm font-semibold text-white"
        value=""
        onChange={async (e) => {
          try {
            await apiFetch("/auth/switch-tenant", { method: "POST", body: { tenantId: e.target.value } });
            router.push("/admin");
            router.refresh();
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      >
        <option value="">{tenantName}</option>
        {otherTenants.map((t) => (
          <option key={t.id} value={t.id}>
            Switch to {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AdminSidebar(props: Props) {
  return (
    <div className="flex h-full flex-col px-3 py-5">
      <Link href="/admin" className="px-3 text-lg font-black text-white">
        Restaurant<span className="text-brand-300">OS</span>
      </Link>
      <div className="mt-3 mb-5 px-3">
        <TenantSwitcher tenantName={props.tenantName} otherTenants={props.otherTenants} />
      </div>
      <nav aria-label="Admin" className="flex-1">
        <NavList items={props.items} shortcuts={props.shortcuts} />
      </nav>
      <div className="mt-6 border-t border-white/10 px-3 pt-4 text-white">
        <p className="truncate text-sm font-semibold">{props.userName}</p>
        <p className="text-xs text-white/60">{props.roleLabel}</p>
        <SignOutButton className="-ml-2.5 mt-2 text-white/80" />
      </div>
    </div>
  );
}

export function AdminMobileNav(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <div className="flex items-center gap-3 bg-navy-900 px-4 py-3 text-white">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="mobile-admin-nav"
          className="rounded-lg p-1.5 hover:bg-white/10"
        >
          {open ? <X className="size-5" aria-hidden /> : <MenuIcon className="size-5" aria-hidden />}
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        </button>
        <span className="font-black">
          Restaurant<span className="text-brand-300">OS</span>
        </span>
        <span className="ml-auto truncate text-sm text-white/75">{props.tenantName}</span>
      </div>
      {open && (
        <nav id="mobile-admin-nav" aria-label="Admin" className="bg-navy-900 px-3 pb-4 text-white">
          <NavList items={props.items} shortcuts={props.shortcuts} onNavigate={() => setOpen(false)} />
          <div className="mt-4 border-t border-white/10 pt-3">
            <TenantSwitcher tenantName={props.tenantName} otherTenants={props.otherTenants} />
            <SignOutButton className="mt-2 text-white/80" />
          </div>
        </nav>
      )}
    </div>
  );
}
