import type { DataStore } from "@/server/store/types";
import { seededMemoryStore } from "./fixtures";

// Every integration suite runs against each available store so the memory
// demo store and PostgreSQL are proven to behave identically (ADR-0004).
// PostgreSQL runs only when TEST_DATABASE_URL is set (seeded once by globalSetup).

export interface StoreCase {
  name: "memory" | "postgres";
  make: () => Promise<DataStore>;
}

export const storeCases: StoreCase[] = [{ name: "memory", make: async () => (await seededMemoryStore()).store }];

if (process.env.TEST_DATABASE_URL) {
  storeCases.push({
    name: "postgres",
    make: async () => {
      const { PrismaStore, newPrismaClient } = await import("@/server/store/prisma/prisma-store");
      return new PrismaStore(newPrismaClient(process.env.TEST_DATABASE_URL!));
    },
  });
}
