import Link from "next/link";
import { Suspense } from "react";
import { requirePlatformPage } from "@/server/auth/current";
import { SignOutButton } from "@/features/staff/sign-out-button";

async function UserArea() {
  const actor = await requirePlatformPage("/platform");
  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm text-white/70 sm:inline">{actor.user.name}</span>
      <SignOutButton />
    </div>
  );
}

export default function PlatformLayout({ children }: LayoutProps<"/platform">) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <header className="no-print bg-navy-950 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/platform" className="font-black">
            Restaurant<span className="text-brand-300">OS</span>{" "}
            <span className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-xs font-bold tracking-wide uppercase">Platform</span>
          </Link>
          <nav aria-label="Platform" className="flex gap-1 text-sm font-semibold">
            <Link href="/platform" className="rounded-lg px-2.5 py-1.5 hover:bg-white/10">
              Tenants
            </Link>
            <Link href="/platform/tenants/new" className="rounded-lg px-2.5 py-1.5 hover:bg-white/10">
              Onboard
            </Link>
            <Link href="/platform/audit" className="rounded-lg px-2.5 py-1.5 hover:bg-white/10">
              Audit
            </Link>
          </nav>
          <div className="ml-auto">
            <Suspense fallback={null}>
              <UserArea />
            </Suspense>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
