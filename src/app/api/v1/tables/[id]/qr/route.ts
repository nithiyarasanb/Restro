import { api } from "@/server/http/api";
import { tableQrSvg } from "@/server/services/tables";

/** QR code as SVG (?format=json for label + url as well). */
export const GET = api<{ id: string }>(async ({ store, actor, params, req }) => {
  const qr = await tableQrSvg(store, actor, params.id);
  if (req.nextUrl.searchParams.get("format") === "json") return qr;
  return new Response(qr.svg, {
    headers: { "content-type": "image/svg+xml", "content-disposition": `inline; filename="qr-${qr.label.replace(/[^\w-]+/g, "-")}.svg"` },
  });
});
