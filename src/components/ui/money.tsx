import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export function Money({ minor, currency, className, compact }: { minor: number; currency: string; className?: string; compact?: boolean }) {
  return <span className={cn("tabular", className)}>{formatMoney(minor, currency, { compact })}</span>;
}
