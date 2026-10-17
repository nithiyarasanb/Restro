// Money is always an integer in the currency's minor unit (BRD §13).
// The exponent comes from ISO 4217; unknown currencies are rejected rather
// than guessed.

const EXPONENTS: Record<string, number> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AED: 2,
  SGD: 2,
  AUD: 2,
  CAD: 2,
  LKR: 2,
  MYR: 2,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
};

export const SUPPORTED_CURRENCIES = Object.keys(EXPONENTS);

export function currencyExponent(currency: string): number {
  const exp = EXPONENTS[currency];
  if (exp === undefined) throw new Error(`Unsupported currency: ${currency}`);
  return exp;
}

export function assertMinor(amount: number): void {
  if (!Number.isSafeInteger(amount)) throw new Error(`Money must be an integer minor amount, got ${amount}`);
}

/** Percentage in basis points applied to a minor amount, rounded half-up. */
export function applyBps(amountMinor: number, bps: number): number {
  assertMinor(amountMinor);
  if (!Number.isInteger(bps) || bps < 0) throw new Error(`Invalid basis points: ${bps}`);
  // Integer arithmetic: (amount * bps + 5000) / 10000, floored → half-up for non-negative amounts.
  return Math.floor((amountMinor * bps + 5000) / 10000);
}

/** Convert a decimal string typed by a user ("12.5") into minor units. */
export function parseMajor(input: string, currency: string): number | null {
  const exp = currencyExponent(currency);
  const trimmed = input.trim();
  const re = exp === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${exp}})?$`);
  if (!re.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const minor = Number(whole) * 10 ** exp + Number(frac.padEnd(exp, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

export function toMajorString(amountMinor: number, currency: string): string {
  const exp = currencyExponent(currency);
  if (exp === 0) return String(amountMinor);
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(amountMinor);
  const whole = Math.floor(abs / 10 ** exp);
  const frac = String(abs % 10 ** exp).padStart(exp, "0");
  return `${sign}${whole}.${frac}`;
}

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amountMinor: number, currency: string, opts: { compact?: boolean } = {}): string {
  const exp = currencyExponent(currency);
  // Compact drops the fraction only when it is zero, so 3994.20 never renders as "3,994.2".
  const whole = amountMinor % 10 ** exp === 0;
  const digits = opts.compact && whole ? 0 : exp;
  const key = `${currency}:${digits}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formatters.set(key, fmt);
  }
  return fmt.format(amountMinor / 10 ** exp);
}
