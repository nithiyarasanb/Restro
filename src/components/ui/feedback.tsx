import type { ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-ink/[0.08]", className)} />;
}

/** Generic page-level loading placeholder; announces loading to screen readers. */
export function PageSkeleton({ rows = 6, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="mb-1 rounded-full bg-ink/5 p-3 text-muted" aria-hidden>
        {icon ?? <Inbox className="size-6" />}
      </div>
      <p className="font-bold text-ink">{title}</p>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", description, action }: { title?: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-danger-600/30 bg-danger-50 px-6 py-10 text-center">
      <AlertTriangle className="size-7 text-danger-600" aria-hidden />
      <p className="font-bold text-danger-700">{title}</p>
      {description && <p className="max-w-md text-sm text-ink-soft">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const styles = {
    info: "border-info-600/25 bg-info-50 text-info-700",
    warning: "border-warn-600/30 bg-warn-50 text-warn-700",
    danger: "border-danger-600/30 bg-danger-50 text-danger-700",
    success: "border-ok-600/30 bg-ok-50 text-ok-700",
  }[tone];
  return (
    <div className={cn("rounded-lg border px-4 py-3 text-sm", styles, className)} role={tone === "danger" || tone === "warning" ? "alert" : "status"}>
      {title && <p className="font-bold">{title}</p>}
      {children && <div className={cn(title ? "mt-0.5" : null, "text-ink-soft")}>{children}</div>}
    </div>
  );
}
