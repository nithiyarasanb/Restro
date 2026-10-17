import type { Metadata } from "next";
import { Suspense } from "react";
import { MockPayScreen } from "@/features/customer/mock-pay-screen";

export const metadata: Metadata = { title: "MockPay (test only)", robots: { index: false } };

export default function MockPayPage(props: PageProps<"/pay/mock/[paymentId]">) {
  return (
    <Suspense fallback={null}>
      <MockPay params={props.params} />
    </Suspense>
  );
}

async function MockPay({ params }: { params: PageProps<"/pay/mock/[paymentId]">["params"] }) {
  const { paymentId } = await params;
  return <MockPayScreen paymentId={paymentId} />;
}
