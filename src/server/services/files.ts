import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DataStore } from "@/server/store/types";
import { DomainError, notFound } from "@/server/errors";
import { getConfig } from "@/server/config";
import { hmacSha256Hex, safeEqualHex } from "@/server/crypto";
import { requirePermission, type Actor } from "@/server/auth/actor";
import { audit } from "./shared";

// Menu image storage (BRD §10 "private bucket with signed URLs").
// Local-disk adapter for development; S3 adapter is a production TODO
// (docs/05-operations.md). Files are private: they are served only through
// short-lived HMAC-signed URLs issued by tenant-scoped APIs.

const MAX_BYTES = 2 * 1024 * 1024;
const SIGNED_URL_TTL_S = 24 * 3600;
export const FILE_REF_PREFIX = "file:";

const SIGNATURES: Array<{ type: string; ext: string; test: (b: Buffer) => boolean }> = [
  { type: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/webp", ext: "webp", test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
];

function baseDir() {
  return path.resolve(process.cwd(), getConfig().UPLOAD_DIR);
}

function sign(key: string, exp: number) {
  return hmacSha256Hex(getConfig().APP_SECRET, `file:${key}:${exp}`);
}

/** Turn a stored image reference into a URL a browser can load. */
export function resolveImageUrl(ref: string | null): string | null {
  if (!ref) return null;
  if (!ref.startsWith(FILE_REF_PREFIX)) return ref;
  const key = ref.slice(FILE_REF_PREFIX.length);
  // Round expiry to the hour so URLs are cacheable for a while.
  const exp = Math.ceil(Date.now() / 1000 / 3600) * 3600 + SIGNED_URL_TTL_S;
  return `/api/v1/files/${key}?exp=${exp}&sig=${sign(key, exp)}`;
}

export async function uploadImage(store: DataStore, actor: Actor | null, file: File) {
  const staff = requirePermission(actor, "menu.manage");
  if (file.size > MAX_BYTES) throw new DomainError("PAYLOAD_TOO_LARGE", "Images must be 2 MB or smaller");
  const bytes = Buffer.from(await file.arrayBuffer());
  // Trust the bytes, not the browser-supplied name or MIME type.
  const kind = SIGNATURES.find((s) => s.test(bytes));
  if (!kind) throw new DomainError("VALIDATION_FAILED", "Upload a PNG, JPEG or WebP image");
  const key = `${staff.tenant.id}/${crypto.randomUUID()}.${kind.ext}`;
  const target = path.join(baseDir(), key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
  await store.createFile({ tenantId: staff.tenant.id, key, contentType: kind.type, sizeBytes: bytes.length, createdAt: new Date().toISOString() });
  await audit(store, staff, { tenantId: staff.tenant.id, action: "file.uploaded", entityType: "file", entityId: key, meta: { sizeBytes: bytes.length } });
  return { ref: `${FILE_REF_PREFIX}${key}`, url: resolveImageUrl(`${FILE_REF_PREFIX}${key}`)! };
}

export async function readSignedFile(store: DataStore, key: string, exp: string | null, sig: string | null) {
  const expNum = Number(exp);
  if (!sig || !Number.isFinite(expNum) || expNum < Date.now() / 1000 || !safeEqualHex(sign(key, expNum), sig)) throw notFound("File");
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(key)) throw notFound("File");
  const meta = await store.getFileByKey(key);
  if (!meta) throw notFound("File");
  const target = path.join(baseDir(), key);
  if (!target.startsWith(baseDir() + path.sep)) throw notFound("File");
  const data = await readFile(target).catch(() => null);
  if (!data) throw notFound("File");
  return { data, contentType: meta.contentType };
}
