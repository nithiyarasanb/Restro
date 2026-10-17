// Seeds DEMO data into PostgreSQL using the same seed as memory mode.
//   npm run db:seed            → seeds if the demo tenant is absent
//   npm run db:seed -- --reset → truncates every table first (local/dev only)
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { newPrismaClient, PrismaStore } from "../src/server/store/prisma/prisma-store";
import { seedDemoData } from "../src/server/store/seed";
import { DEMO } from "../src/server/store/demo-constants";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed DEMO data in production");
  const client = newPrismaClient(url);
  const store = new PrismaStore(client);
  try {
    if (process.argv.includes("--reset")) {
      const tables = await client.$queryRaw<
        Array<{ tablename: string }>
      >`SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
      await client.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
      console.log(`Truncated ${tables.length} tables.`);
    } else if (await store.getTenant(DEMO.tenantId)) {
      console.log("DEMO data already present — skipping (use --reset to reseed).");
      return;
    }
    const started = Date.now();
    await seedDemoData(store);
    console.log(`Seeded DEMO data in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  } finally {
    await client.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
