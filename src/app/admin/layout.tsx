import { Suspense } from "react";
import { requireStaffPage } from "@/server/auth/current";
import { can } from "@/server/auth/actor";
import { ROLE_LABELS, type Permission } from "@/lib/permissions";
import { AdminMobileNav, AdminSidebar, type NavItem } from "@/features/admin/admin-nav";
import { Skeleton } from "@/components/ui/feedback";
import { ADMIN_PERMS } from "@/features/admin/perms";

const NAV: Array<NavItem & { perm: Permission }> = [
  { href: "/admin", label: "Overview", icon: "overview", perm: "reports.view" },
  { href: "/admin/orders", label: "Orders", icon: "orders", perm: "orders.view" },
  { href: "/admin/menu", label: "Menu", icon: "menu", perm: "menu.availability" },
  { href: "/admin/tables", label: "Tables & QR", icon: "tables", perm: "tables.manage" },
  { href: "/admin/branches", label: "Branches", icon: "branches", perm: "branch.settings" },
  { href: "/admin/staff", label: "Staff", icon: "staff", perm: "staff.manage" },
  { href: "/admin/payments", label: "Payments", icon: "payments", perm: "payments.refund" },
  { href: "/admin/reports", label: "Reports", icon: "reports", perm: "reports.view" },
  { href: "/admin/audit", label: "Audit log", icon: "audit", perm: "audit.view" },
  { href: "/admin/settings", label: "Settings", icon: "settings", perm: "tenant.settings" },
];

async function Nav({ mobile }: { mobile?: boolean }) {
  const actor = await requireStaffPage(ADMIN_PERMS, "/admin");
  const props = {
    items: NAV.filter((n) => can(actor, n.perm)).map(({ href, label, icon }) => ({ href, label, icon })),
    shortcuts: [
      ...(can(actor, "kitchen.operate") ? [{ href: "/kitchen", label: "Kitchen display", icon: "kitchen" as const }] : []),
      ...(can(actor, "orders.handover") ? [{ href: "/counter", label: "Front of house", icon: "counter" as const }] : []),
    ],
    tenantName: actor.tenant.name,
    userName: actor.user.name,
    roleLabel: ROLE_LABELS[actor.role],
    otherTenants: actor.otherTenants.filter((t) => t.role === "OWNER" || t.role === "BRANCH_MANAGER"),
  };
  return mobile ? <AdminMobileNav {...props} /> : <AdminSidebar {...props} />;
}

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col lg:flex-row">
      <aside className="no-print hidden w-64 shrink-0 bg-navy-900 lg:block">
        <div className="sticky top-0 h-dvh overflow-y-auto">
          <Suspense
            fallback={
              <div className="space-y-2 p-5">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Skeleton key={i} className="h-8 bg-white/10" />
                ))}
              </div>
            }
          >
            <Nav />
          </Suspense>
        </div>
      </aside>
      <Suspense fallback={<div className="h-14 bg-navy-900 lg:hidden" />}>
        <div className="no-print">
          <Nav mobile />
        </div>
      </Suspense>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
