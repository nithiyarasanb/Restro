import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const link = "inline-flex h-9 items-center gap-1 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold hover:bg-canvas";
  const disabled = "pointer-events-none opacity-40";
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-muted">
      <p>
        Showing <span className="font-semibold text-ink tabular">{from}</span>–<span className="font-semibold text-ink tabular">{to}</span> of{" "}
        <span className="font-semibold text-ink tabular">{total}</span>
      </p>
      <div className="flex gap-2">
        <Link href={hrefFor(page - 1)} className={cn(link, page <= 1 && disabled)} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined}>
          <ChevronLeft className="size-4" aria-hidden /> Previous
        </Link>
        <span className="inline-flex h-9 items-center px-2 tabular" aria-current="page">
          Page {page} of {pages}
        </span>
        <Link href={hrefFor(page + 1)} className={cn(link, page >= pages && disabled)} aria-disabled={page >= pages} tabIndex={page >= pages ? -1 : undefined}>
          Next <ChevronRight className="size-4" aria-hidden />
        </Link>
      </div>
    </nav>
  );
}
