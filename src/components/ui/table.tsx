import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Horizontally scrollable, captioned data table. */
export function DataTable({ caption, className, children, ...props }: ComponentProps<"table"> & { caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-left text-sm", className)} {...props}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn("border-b border-line bg-canvas/60 px-4 py-2.5 text-xs font-bold tracking-wide whitespace-nowrap text-muted uppercase", className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("border-b border-line px-4 py-3 align-middle", className)} {...props} />;
}

export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("transition-colors hover:bg-canvas/50", className)} {...props} />;
}
