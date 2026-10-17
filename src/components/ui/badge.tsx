import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ORDER_STATUS_META, PAYMENT_STATUS_META } from "@/lib/order-states";
import type { OrderStatus, PaymentStatus } from "@/types/domain";

export type Tone = "neutral" | "info" | "warning" | "success" | "danger" | "accent" | "brand";

const tones: Record<Tone, string> = {
  neutral: "bg-ink/[0.07] text-ink-soft",
  info: "bg-info-50 text-info-700 ring-info-600/20",
  warning: "bg-warn-50 text-warn-700 ring-warn-600/20",
  success: "bg-ok-50 text-ok-700 ring-ok-600/20",
  danger: "bg-danger-50 text-danger-700 ring-danger-600/20",
  accent: "bg-accent-50 text-accent-600 ring-accent-600/20",
  brand: "bg-brand-50 text-brand-700 ring-brand-600/20",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap ring-1 ring-transparent ring-inset",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const meta = ORDER_STATUS_META[status];
  return (
    <Badge tone={meta.tone} className={className}>
      {meta.label}
    </Badge>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const meta = PAYMENT_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/** Persistent marker for sample data and test-only features. */
export function DemoTag({ children = "DEMO DATA" }: { children?: ReactNode }) {
  return <span className="inline-flex items-center rounded-full bg-[#fde68a] px-2 py-0.5 text-[11px] font-black tracking-wide text-[#713f12]">{children}</span>;
}
