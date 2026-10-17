import { connection, NextResponse } from "next/server";

/** Liveness: the process is up. Deliberately does not touch the data source. */
export async function GET() {
  await connection();
  return NextResponse.json({ status: "ok", time: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
