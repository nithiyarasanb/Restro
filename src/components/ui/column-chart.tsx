"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";

// Single-series column chart (dataviz method): one validated hue (#e2581c,
// brand-500), ≤24px columns with 4px rounded data-ends on a hairline baseline,
// per-column hover/focus tooltip, the maximum labelled directly, and a table
// view so nothing depends on seeing the bars.

export interface ColumnDatum {
  key: string;
  label: string; // axis label
  value: number;
  display: string; // formatted value for tooltip / table
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export function ColumnChart({
  data,
  title,
  valueLabel,
  height = 180,
  tickCurrency,
}: {
  data: ColumnDatum[];
  title: string;
  valueLabel: string;
  height?: number;
  /** Format axis ticks as money (values are minor units). */ tickCurrency?: string;
}) {
  const formatTick = (n: number) => (tickCurrency ? formatMoney(Math.round(n), tickCurrency, { compact: true }) : String(Math.round(n * 10) / 10));
  const [active, setActive] = useState<string | null>(null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const peak = data.reduce<ColumnDatum | null>((best, d) => (!best || d.value > best.value ? d : best), null);
  const labelEvery = data.length > 16 ? Math.ceil(data.length / 8) : 1;

  return (
    <figure className="w-full">
      <figcaption className="sr-only">{title}</figcaption>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between pb-6 text-right text-[11px] text-muted tabular" style={{ height }} aria-hidden>
          <span>{formatTick(max)}</span>
          <span>{formatTick(max / 2)}</span>
          <span>0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-line" style={{ height: height - 24 }} aria-hidden>
            <div className="absolute inset-x-0 top-1/2 border-t border-line" />
          </div>
          <div
            className="relative flex items-end gap-[2px] border-b border-line-strong"
            style={{ height: height - 24 }}
            role="group"
            aria-label={`${title}. Peak ${peak?.label ?? ""}: ${peak?.display ?? ""}. A table view follows.`}
          >
            {data.map((d) => {
              const h = (d.value / max) * 100;
              const isActive = active === d.key;
              return (
                <div
                  key={d.key}
                  className="group relative flex h-full flex-1 items-end justify-center outline-none"
                  tabIndex={0}
                  role="img"
                  onMouseEnter={() => setActive(d.key)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(d.key)}
                  onBlur={() => setActive(null)}
                  aria-label={`${d.label}: ${d.display}`}
                >
                  {d === peak && d.value > 0 && !isActive && (
                    <span
                      className="absolute text-[11px] font-bold whitespace-nowrap text-ink-soft tabular"
                      style={{ bottom: `calc(${h}% + 4px)` }}
                      aria-hidden
                    >
                      {d.display}
                    </span>
                  )}
                  <div
                    className="w-full max-w-6 rounded-t-[4px] bg-brand-500 transition-opacity group-hover:opacity-85 group-focus-visible:outline-2 group-focus-visible:outline-info-600"
                    style={{ height: `${Math.max(h, d.value > 0 ? 1.5 : 0)}%` }}
                  />
                  {isActive && (
                    <div
                      className="absolute z-10 -translate-y-2 rounded-lg bg-navy-900 px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-[var(--shadow-pop)]"
                      style={{ bottom: `${h}%` }}
                      role="tooltip"
                    >
                      <span className="font-bold">{d.label}</span> · {d.display}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-[2px] pt-1.5" aria-hidden>
            {data.map((d, i) => (
              <span key={d.key} className="flex-1 truncate text-center text-[11px] text-muted">
                {i % labelEvery === 0 ? d.label : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-muted">Show as table</summary>
        <table className="mt-2 w-full text-left text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="py-1">
                Period
              </th>
              <th scope="col" className="py-1 text-right">
                {valueLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key} className="border-t border-line">
                <td className="py-1">{d.label}</td>
                <td className="py-1 text-right tabular">{d.display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
