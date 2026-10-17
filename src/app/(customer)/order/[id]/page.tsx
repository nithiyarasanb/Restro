import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderTracking } from "@/features/customer/order-tracking";
import { CustomerError } from "@/features/customer/customer-error";

export const metadata: Metadata = { title: "Your order", robots: { index: false } };

export default function OrderPage(props: PageProps<"/order/[id]">) {
  return (
    <Suspense fallback={null}>
      <Tracking params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Tracking({ params, searchParams }: Pick<PageProps<"/order/[id]">, "params" | "searchParams">) {
  const { id } = await params;
  const sp = await searchParams;
  const token = typeof sp.t === "string" ? sp.t : "";
  if (!token) return <CustomerError title="Tracking link incomplete" message="Open the link you received after ordering, or ask a member of staff for help." />;
  return <OrderTracking orderId={id} token={token} fromPayment={sp.from === "payment"} />;
}
