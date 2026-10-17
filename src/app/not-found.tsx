import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <p className="text-sm font-bold tracking-widest text-brand-600 uppercase">404</p>
      <h1 className="mt-2 text-2xl font-black">We couldn&apos;t find that page</h1>
      <p className="mt-2 max-w-md text-muted">It may have moved, or you may not have access to it.</p>
      <Link href="/" className={buttonClasses("secondary", "md", "mt-6")}>
        Go home
      </Link>
    </main>
  );
}
