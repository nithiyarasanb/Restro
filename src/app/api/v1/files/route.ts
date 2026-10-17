import { api, created } from "@/server/http/api";
import { DomainError } from "@/server/errors";
import { uploadImage } from "@/server/services/files";

/** Multipart upload of a menu image (field "file"). Content is sniffed; max 2 MB. */
export const POST = api(
  async ({ store, actor, req }) => {
    if (Number(req.headers.get("content-length") ?? 0) > 3 * 1024 * 1024) throw new DomainError("PAYLOAD_TOO_LARGE", "Images must be 2 MB or smaller");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new DomainError("VALIDATION_FAILED", "Attach an image in the “file” field");
    return created(await uploadImage(store, actor, file));
  },
  { maxBodyBytes: 3 * 1024 * 1024, rateLimitPerMinute: 30 },
);
