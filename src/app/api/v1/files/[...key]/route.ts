import { api } from "@/server/http/api";
import { readSignedFile } from "@/server/services/files";

/** Serves a private file only with a valid, unexpired signature. */
export const GET = api<{ key: string[] }>(
  async ({ store, params, req }) => {
    const { data, contentType } = await readSignedFile(store, params.key.join("/"), req.nextUrl.searchParams.get("exp"), req.nextUrl.searchParams.get("sig"));
    return new Response(new Uint8Array(data), {
      headers: { "content-type": contentType, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
    });
  },
  { rateLimitPerMinute: 600 },
);
