import "server-only";
import { connection } from "next/server";
import { getStore } from "./index";
import type { DataStore } from "./types";

/**
 * Store access for Server Components. `connection()` marks the render as
 * request-time so live data (orders, availability, opening hours) is never
 * baked into a prerendered shell — the memory store resolves without I/O,
 * which would otherwise look static to the prerenderer.
 */
export async function getRequestStore(): Promise<DataStore> {
  await connection();
  return getStore();
}
