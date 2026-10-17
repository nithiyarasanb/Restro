import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Bike, Clock, MapPin, ShoppingBag } from "lucide-react";
import { getRequestStore } from "@/server/store/request";
import { isDomainError } from "@/server/errors";
import { getPublicRestaurant } from "@/server/services/catalog";
import { CustomerError, MenuSkeleton } from "@/features/customer/customer-error";
import { buttonClasses } from "@/components/ui/button";
import { DemoTag } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Order online" };

export default function RestaurantPage(props: PageProps<"/r/[slug]">) {
  return (
    <Suspense fallback={<MenuSkeleton />}>
      <Restaurant params={props.params} />
    </Suspense>
  );
}

async function Restaurant({ params }: { params: PageProps<"/r/[slug]">["params"] }) {
  const { slug } = await params;
  let restaurant;
  try {
    restaurant = await getPublicRestaurant(await getRequestStore(), slug);
  } catch (e) {
    if (isDomainError(e) && e.code === "NOT_FOUND") return <CustomerError title="Restaurant not found" message="Check the link and try again." />;
    throw e;
  }
  return (
    <main id="main" className="mx-auto w-full max-w-2xl flex-1 sm:my-6">
      <header className="bg-navy-900 px-6 py-8 text-white sm:rounded-t-3xl">
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold tracking-wider text-brand-300 uppercase">Order online</p>
          {restaurant.isDemo && <DemoTag>DEMO</DemoTag>}
        </div>
        <h1 className="mt-1 text-3xl font-black">{restaurant.name}</h1>
        <p className="mt-1 text-white/80">Choose a branch for takeaway or delivery. Dining in? Scan the QR code on your table instead.</p>
      </header>
      <ul className="space-y-4 bg-surface p-4 sm:rounded-b-3xl sm:border sm:border-t-0 sm:border-line">
        {restaurant.branches.length === 0 && <li className="p-6 text-center text-muted">No branches are taking online orders right now.</li>}
        {restaurant.branches.map((b) => {
          const open = b.isOpenNow && b.acceptingOrders;
          return (
            <li key={b.id} className="rounded-2xl border border-line p-5">
              <h2 className="text-lg font-black">{b.name}</h2>
              <p className="mt-1 flex items-start gap-1.5 text-sm text-muted">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> {b.address}
              </p>
              <p className={`mt-1 flex items-center gap-1.5 text-sm font-semibold ${open ? "text-ok-700" : "text-danger-700"}`}>
                <Clock className="size-4" aria-hidden /> {open ? "Open — taking orders" : b.isOpenNow ? "Not taking online orders right now" : "Closed now"}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {b.takeawayEnabled && (
                  <Link href={`/r/${restaurant.slug}/b/${b.id}?type=TAKEAWAY`} className={buttonClasses("primary", "md")}>
                    <ShoppingBag className="size-4" aria-hidden /> Takeaway
                  </Link>
                )}
                {b.deliveryEnabled && (
                  <Link href={`/r/${restaurant.slug}/b/${b.id}?type=DELIVERY`} className={buttonClasses("secondary", "md")}>
                    <Bike className="size-4" aria-hidden /> Delivery · {formatMoney(b.deliveryFeeMinor, restaurant.currency, { compact: true })} fee
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
