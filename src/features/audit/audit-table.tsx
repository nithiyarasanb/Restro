import type { AuditLog } from "@/types/domain";
import { formatDateTime } from "@/lib/utils";
import { DataTable, Td, Th, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/feedback";

export function AuditTable({ items, timezone, tenantNames }: { items: AuditLog[]; timezone?: string; tenantNames?: Map<string, string> }) {
  if (items.length === 0) return <EmptyState title="No audit entries yet" />;
  return (
    <DataTable caption="Audit log">
      <thead>
        <tr>
          <Th>When</Th>
          {tenantNames && <Th>Restaurant</Th>}
          <Th>Who</Th>
          <Th>Action</Th>
          <Th>Details</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((a) => (
          <Tr key={a.id}>
            <Td className="whitespace-nowrap text-muted">{formatDateTime(a.createdAt, timezone)}</Td>
            {tenantNames && <Td>{a.tenantId ? (tenantNames.get(a.tenantId) ?? "—") : "Platform"}</Td>}
            <Td className="text-sm">{a.actorLabel}</Td>
            <Td>
              <code className="rounded bg-canvas px-1.5 py-0.5 text-xs">{a.action}</code>
            </Td>
            <Td className="max-w-md truncate font-mono text-xs text-muted" title={JSON.stringify(a.meta)}>
              {Object.entries(a.meta)
                .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                .join(" · ")}
            </Td>
          </Tr>
        ))}
      </tbody>
    </DataTable>
  );
}
