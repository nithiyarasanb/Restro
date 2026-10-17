import { config } from "dotenv";

// Same precedence as Next.js: .env.local overrides .env.
config({ path: [".env.local", ".env"], quiet: true });
import { defineConfig } from "prisma/config";

// Prisma 7 reads the connection string here (not from schema.prisma).
// `prisma generate` does not need a database, so a placeholder is fine there.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
