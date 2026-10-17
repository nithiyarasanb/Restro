import Link from "next/link";
import type { ReactNode } from "react";
import { DemoTag } from "@/components/ui/badge";
import { SignOutButton } from "./sign-out-button";

/** Dark top bar for the operational screens (kitchen, counter, runner). */
export function StaffTopBar({
  title,
  subtitle,
  userName,
  isDemo,
  children,
  links,
}: {
  title: string;
  subtitle?: ReactNode;
  userName: string;
  isDemo: boolean;
  children?: ReactNode;
  links?: Array<{ href: string; label: string }>;
}) {
  return (
    <header className="no-print flex flex-wrap items-center gap-x-4 gap-y-2 bg-navy-900 px-4 py-3 text-white">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="text-lg font-black whitespace-nowrap">{title}</h1>
        {subtitle && <p className="truncate text-sm text-white/70">{subtitle}</p>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {children}
        {isDemo && <DemoTag />}
        {links?.map((l) => (
          <Link key={l.href} href={l.href} className="rounded-lg px-2.5 py-1.5 text-sm font-semibold hover:bg-white/10">
            {l.label}
          </Link>
        ))}
        <span className="hidden text-sm text-white/70 md:inline">{userName}</span>
        <SignOutButton />
      </div>
    </header>
  );
}
