"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Branch picker that writes ?branch= into the URL (server pages read it). */
export function BranchFilter({
  branches,
  value,
  allLabel = "All branches",
}: {
  branches: Array<{ id: string; name: string }>;
  value: string;
  allLabel?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (branches.length <= 1 && allLabel) return null;
  return (
    <label className="flex items-center gap-2 text-sm font-semibold">
      <span>Branch</span>
      <select
        className="h-9 rounded-lg border border-line-strong bg-surface px-2"
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          if (e.target.value) next.set("branch", e.target.value);
          else next.delete("branch");
          next.delete("page");
          router.push(`${pathname}?${next.toString()}`);
        }}
      >
        {allLabel && <option value="">{allLabel}</option>}
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
