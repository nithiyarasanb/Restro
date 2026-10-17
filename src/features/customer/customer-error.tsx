import Link from "next/link";
import { QrCode } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

export function CustomerError({ title, message }: { title: string; message: string }) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="rounded-full bg-brand-50 p-4 text-brand-600" aria-hidden>
        <QrCode className="size-8" />
      </div>
      <h1 className="mt-4 text-xl font-black">{title}</h1>
      <p className="mt-2 text-muted">{message}</p>
      <Link href="/" className={buttonClasses("secondary", "md", "mt-6")}>
        Go to home page
      </Link>
    </main>
  );
}

export function MenuSkeleton() {
  return (
    <div role="status" className="mx-auto w-full max-w-2xl animate-pulse sm:my-6">
      <span className="sr-only">Loading menu…</span>
      <div className="h-32 bg-brand-600/70 sm:rounded-t-3xl" />
      <div className="flex gap-2 p-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-8 w-20 rounded-full bg-ink/10" />
        ))}
      </div>
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex gap-4 px-5 py-4">
          <div className="size-20 rounded-xl bg-ink/10" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/2 rounded bg-ink/10" />
            <div className="h-3 w-3/4 rounded bg-ink/10" />
            <div className="h-4 w-16 rounded bg-ink/10" />
          </div>
        </div>
      ))}
    </div>
  );
}
