import type { Metadata } from "next";
import { CheckoutScreen } from "@/features/customer/checkout-screen";

export const metadata: Metadata = { title: "Checkout" };

export default function CheckoutPage() {
  return <CheckoutScreen />;
}
