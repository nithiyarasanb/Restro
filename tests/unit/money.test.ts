import { describe, expect, it } from "vitest";
import { applyBps, currencyExponent, formatMoney, parseMajor, toMajorString } from "@/lib/money";

describe("money (BR-04)", () => {
  it("uses the real ISO 4217 exponent", () => {
    expect(currencyExponent("INR")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
    expect(() => currencyExponent("XYZ")).toThrow(/Unsupported currency/);
  });

  it("parses user input into integer minor units per currency", () => {
    expect(parseMajor("260", "INR")).toBe(26000);
    expect(parseMajor("12.5", "INR")).toBe(1250);
    expect(parseMajor("1.234", "KWD")).toBe(1234);
    expect(parseMajor("500", "JPY")).toBe(500);
    expect(parseMajor("5.5", "JPY")).toBeNull();
    expect(parseMajor("1.999", "INR")).toBeNull();
    expect(parseMajor("-1", "INR")).toBeNull();
    expect(parseMajor("abc", "INR")).toBeNull();
  });

  it("round-trips to a major-unit string", () => {
    expect(toMajorString(26050, "INR")).toBe("260.50");
    expect(toMajorString(5, "INR")).toBe("0.05");
    expect(toMajorString(1234, "KWD")).toBe("1.234");
    expect(toMajorString(500, "JPY")).toBe("500");
  });

  it("applies basis points with half-up rounding on integers", () => {
    expect(applyBps(84000, 500)).toBe(4200); // ₹840 × 5 % = ₹42 (BRD Figure 1)
    expect(applyBps(1050, 500)).toBe(53); // 52.5 → 53
    expect(applyBps(1049, 500)).toBe(52); // 52.45 → 52
    expect(applyBps(0, 500)).toBe(0);
    expect(() => applyBps(10.5, 500)).toThrow();
    expect(() => applyBps(100, -1)).toThrow();
  });

  it("formats with the currency symbol, never dropping a single decimal", () => {
    expect(formatMoney(88200, "INR")).toBe("₹882.00");
    expect(formatMoney(88200, "INR", { compact: true })).toBe("₹882");
    expect(formatMoney(399420, "INR", { compact: true })).toBe("₹3,994.20");
    expect(formatMoney(1290, "SGD")).toMatch(/12\.90/);
  });
});
