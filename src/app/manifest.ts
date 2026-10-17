import type { MetadataRoute } from "next";

// Installable PWA manifest (BRD §5 "Responsive web/PWA"). Offline ordering is
// intentionally unsupported in the MVP (BRD §21), so there is no offline cache.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RestaurantOS",
    short_name: "RestaurantOS",
    description: "Scan, order, pay — and run the kitchen live.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f2ed",
    theme_color: "#1c2940",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
