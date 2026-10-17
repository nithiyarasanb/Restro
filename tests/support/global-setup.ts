import { execSync } from "node:child_process";

/** When TEST_DATABASE_URL is set: migrate and reseed it once before the suite. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx prisma migrate deploy", { env, stdio: "inherit" });
  execSync("npx tsx prisma/seed.ts --reset", { env, stdio: "inherit" });
}
