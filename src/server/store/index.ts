import "server-only";
import { getConfig } from "@/server/config";
import { DomainError } from "@/server/errors";
import type { DataStore } from "./types";

// One store per process. The mode is explicit (DATA_SOURCE) and never falls
// back: if PostgreSQL is selected and unreachable, requests fail with 503.

const g = globalThis as unknown as { __rpStore?: Promise<DataStore> };

async function createStore(): Promise<DataStore> {
  const config = getConfig();
  if (config.DATA_SOURCE === "memory") {
    const { MemoryStore } = await import("./memory/memory-store");
    const { seedDemoData } = await import("./seed");
    const store = new MemoryStore();
    await seedDemoData(store);
    console.info("[store] DATA_SOURCE=memory — seeded DEMO data (resets on restart)");
    return store;
  }
  const { createPrismaStore } = await import("./prisma/prisma-store");
  return createPrismaStore(config.DATABASE_URL!);
}

export async function getStore(): Promise<DataStore> {
  if (!g.__rpStore) {
    g.__rpStore = createStore().catch((e) => {
      g.__rpStore = undefined;
      throw e;
    });
    void import("@/server/realtime/outbox").then((m) => m.startOutboxSweeper());
  }
  try {
    return await g.__rpStore;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Invalid environment")) throw e;
    console.error("[store] data source unavailable", e);
    throw new DomainError("DATA_SOURCE_UNAVAILABLE", "The data service is unavailable. Please try again shortly.");
  }
}

export function isDemoMode(): boolean {
  return getConfig().isDemo;
}
