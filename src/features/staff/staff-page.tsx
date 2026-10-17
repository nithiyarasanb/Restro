import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/feedback";

/** Fallback shown while an operational screen authenticates and loads. */
export function StaffScreenSkeleton({ title }: { title: string }) {
  return (
    <div role="status" className="flex flex-1 flex-col">
      <span className="sr-only">Loading {title}…</span>
      <div className="h-14 bg-navy-900" />
      <div className="grid flex-1 gap-4 p-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-44 rounded-xl" />
            <Skeleton className="h-44 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function StaffMain({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="flex flex-1 flex-col">
      {children}
    </main>
  );
}
