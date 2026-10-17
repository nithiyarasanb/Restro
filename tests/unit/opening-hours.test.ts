import { describe, expect, it } from "vitest";
import { isOpenNow } from "@/server/services/shared";

const ist = (isoLocal: string) => new Date(`${isoLocal}+05:30`);
const branch = (openingHours: Array<{ day: number; open: string; close: string }>) => ({ timezone: "Asia/Kolkata", openingHours });

describe("opening hours", () => {
  it("is always open with no hours configured", () => {
    expect(isOpenNow(branch([]), ist("2026-10-17T03:00:00"))).toBe(true);
  });
  it("respects the branch's own timezone", () => {
    const b = branch([{ day: 6, open: "11:00", close: "23:00" }]); // Saturday
    expect(isOpenNow(b, ist("2026-10-17T11:00:00"))).toBe(true);
    expect(isOpenNow(b, ist("2026-10-17T10:59:00"))).toBe(false);
    expect(isOpenNow(b, ist("2026-10-17T23:00:00"))).toBe(false);
  });
  it("handles hours that run past midnight", () => {
    const b = branch([{ day: 5, open: "18:00", close: "02:00" }]); // Friday night
    expect(isOpenNow(b, ist("2026-10-16T23:30:00"))).toBe(true);
    expect(isOpenNow(b, ist("2026-10-17T01:30:00"))).toBe(true); // Saturday early hours
    expect(isOpenNow(b, ist("2026-10-17T02:30:00"))).toBe(false);
  });
});
