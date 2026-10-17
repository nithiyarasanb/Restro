import { connection } from "next/server";
import { getConfig } from "@/server/config";

/** Persistent banner whenever the app runs on in-memory demo data (ADR-0004). */
export async function DemoBanner() {
  await connection();
  let demo = false;
  try {
    demo = getConfig().isDemo;
  } catch {
    return null;
  }
  if (!demo) return null;
  return (
    <div className="no-print bg-[#fde68a] px-4 py-1.5 text-center text-xs font-bold text-[#713f12]">
      DEMO MODE — sample data held in memory (resets on restart). Payments use a TEST-ONLY mock provider.
    </div>
  );
}
