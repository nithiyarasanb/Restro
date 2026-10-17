import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowRight, ChefHat, ClipboardList, LayoutDashboard, QrCode, ShieldCheck, ShoppingBag, Truck, Building2 } from "lucide-react";
import { getConfig } from "@/server/config";
import { DEMO, DEMO_PASSWORD } from "@/server/store/demo-constants";
import { DemoTag } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";

export default function Home() {
  return (
    <main id="main" className="flex-1">
      <section className="bg-navy-900 text-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <p className="text-sm font-bold tracking-[0.2em] text-brand-300 uppercase">Restaurant platform</p>
          <h1 className="mt-3 text-4xl font-black sm:text-5xl">Scan. Order. Pay. Served.</h1>
          <p className="mt-4 max-w-2xl text-lg text-white/80">
            One platform from table QR code to paid order to the kitchen screen and back to the guest. Payments are verified by the server, every
            restaurant&apos;s data stays isolated, and the kitchen recovers on its own when a connection drops.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={`/q/${DEMO.table12QrRef}`} className={buttonClasses("primary", "lg")}>
              <QrCode className="size-5" aria-hidden /> Order as a guest (Table 12)
            </Link>
            <Link href="/login" className={buttonClasses("secondary", "lg", "border-white/30 bg-white/10 text-white hover:bg-white/20")}>
              Staff sign in <ArrowRight className="size-5" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6" aria-labelledby="journeys">
        <h2 id="journeys" className="text-2xl font-black">
          Explore every role
        </h2>
        <p className="mt-1 text-muted">Each screen below runs against the same API, business rules and authorization as production.</p>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              href: `/q/${DEMO.table12QrRef}`,
              icon: QrCode,
              title: "Guest — dine-in",
              text: "Scan the Table 12 QR, customise items, pay with the mock provider, track live.",
            },
            { href: "/r/spice-route", icon: ShoppingBag, title: "Guest — takeaway & delivery", text: "Pick a branch, order for pickup or delivery." },
            { href: "/kitchen", icon: ChefHat, title: "Kitchen display", text: "Live queue with timers: accept, reject with reason, mark ready." },
            { href: "/counter", icon: ClipboardList, title: "Front of house", text: "Ready alerts, handover, and payment exceptions." },
            { href: "/admin", icon: LayoutDashboard, title: "Restaurant admin", text: "Menu, tables & QR, staff, orders, payments, refunds and reports." },
            { href: "/delivery", icon: Truck, title: "Runner", text: "Only your assigned delivery jobs, with minimum customer data." },
            { href: "/platform", icon: Building2, title: "Platform admin", text: "Onboard restaurants, entitlements, suspensions and audit." },
            {
              href: `/order/${DEMO.liveOrderId}?t=${DEMO.liveOrderToken}`,
              icon: ShieldCheck,
              title: "Live order tracking",
              text: "Order #1042 at Table 12, as the guest sees it.",
            },
          ].map(({ href, icon: Icon, title, text }) => (
            <li key={title}>
              <Link
                href={href}
                className="group flex h-full flex-col rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] transition hover:border-brand-500/50 hover:shadow-md"
              >
                <Icon className="size-7 text-brand-600" aria-hidden />
                <span className="mt-3 font-bold text-ink group-hover:text-brand-700">{title}</span>
                <span className="mt-1 text-sm text-muted">{text}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Suspense fallback={null}>
          <DemoAccounts />
        </Suspense>
      </section>
    </main>
  );
}

async function DemoAccounts() {
  await connection();
  if (!getConfig().isDemo) return null;
  const rows: Array<[string, string, string]> = [
    ["Platform admin", DEMO.users.platform, "/platform"],
    ["Owner — Spice Route", DEMO.users.owner, "/admin"],
    ["Branch manager (Main Street)", DEMO.users.manager, "/admin"],
    ["Cashier / front of house", DEMO.users.cashier, "/counter"],
    ["Kitchen staff", DEMO.users.kitchen, "/kitchen"],
    ["Runner", DEMO.users.runner, "/delivery"],
    ["Owner — Harbour Noodle Bar (SGD)", DEMO.users.harbourOwner, "/admin"],
  ];
  return (
    <section className="mt-10 rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-labelledby="demo-accounts">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="demo-accounts" className="text-lg font-black">
          Demo accounts
        </h2>
        <DemoTag />
      </div>
      <p className="mt-1 text-sm text-muted">
        Every account uses the password <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-ink">{DEMO_PASSWORD}</code>. Shown only in demo mode.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Demo accounts</caption>
          <thead>
            <tr className="text-xs text-muted uppercase">
              <th scope="col" className="py-2 pr-4">
                Role
              </th>
              <th scope="col" className="py-2 pr-4">
                Email
              </th>
              <th scope="col" className="py-2">
                Lands on
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([role, email, home]) => (
              <tr key={email} className="border-t border-line">
                <td className="py-2 pr-4 font-semibold">{role}</td>
                <td className="py-2 pr-4 font-mono text-xs">{email}</td>
                <td className="py-2">
                  <Link
                    className="font-semibold text-brand-700 underline-offset-2 hover:underline"
                    href={`/login?next=${encodeURIComponent(home)}&email=${encodeURIComponent(email)}`}
                  >
                    {home}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
