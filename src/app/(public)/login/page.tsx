import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { getConfig } from "@/server/config";
import { DEMO, DEMO_PASSWORD } from "@/server/store/demo-constants";
import { LoginForm } from "@/features/auth/login-form";
import { Skeleton } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Staff sign in" };

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main id="main" className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 block text-center text-2xl font-black text-ink">
          Restaurant<span className="text-brand-600">OS</span>
        </Link>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)] sm:p-8">
          <h1 className="text-xl font-black">Staff sign in</h1>
          <p className="mt-1 text-sm text-muted">Owners, managers, kitchen, front of house, runners and platform admins.</p>
          <Suspense fallback={<Skeleton className="mt-6 h-56" />}>
            <LoginFormLoader searchParams={props.searchParams} />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-sm text-muted">Guests don&apos;t need an account — just scan the QR code on your table.</p>
      </div>
    </main>
  );
}

async function LoginFormLoader({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : null;
  const email = typeof sp.email === "string" ? sp.email : "";
  const demoAccounts = getConfig().isDemo
    ? [
        { label: "Owner", email: DEMO.users.owner },
        { label: "Manager", email: DEMO.users.manager },
        { label: "Kitchen", email: DEMO.users.kitchen },
        { label: "Cashier", email: DEMO.users.cashier },
        { label: "Runner", email: DEMO.users.runner },
        { label: "Platform", email: DEMO.users.platform },
      ]
    : [];
  return <LoginForm next={next} defaultEmail={email} demoAccounts={demoAccounts} demoPassword={demoAccounts.length ? DEMO_PASSWORD : undefined} />;
}
