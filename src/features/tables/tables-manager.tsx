"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Plus, QrCode, RefreshCw } from "lucide-react";
import type { TableView } from "@/types/api";
import { apiFetch, ApiError, errorMessage } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, buttonClasses } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { DataTable, Td, Th, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/feedback";

export function TablesManager({ tables, branches }: { tables: TableView[]; branches: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [qrFor, setQrFor] = useState<TableView | null>(null);
  const [addTo, setAddTo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {branches.map((b) => {
        const list = tables.filter((t) => t.branchId === b.id);
        return (
          <Card key={b.id}>
            <CardHeader
              title={b.name}
              description={`${list.filter((t) => t.status === "ACTIVE").length} active table(s)`}
              actions={
                <Button size="sm" onClick={() => setAddTo(b.id)} icon={<Plus className="size-4" aria-hidden />}>
                  Add table
                </Button>
              }
            />
            {list.length === 0 ? (
              <EmptyState title="No tables yet" description="Add tables to generate QR codes guests can scan." />
            ) : (
              <DataTable caption={`Tables at ${b.name}`}>
                <thead>
                  <tr>
                    <Th>Table</Th>
                    <Th>Area</Th>
                    <Th>Seats</Th>
                    <Th>Status</Th>
                    <Th>QR issued</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((t) => (
                    <Tr key={t.id}>
                      <Td className="font-semibold">{t.label}</Td>
                      <Td className="text-muted">{t.area ?? "—"}</Td>
                      <Td className="tabular">{t.seats}</Td>
                      <Td>
                        <Badge tone={t.status === "ACTIVE" ? "success" : "neutral"}>{t.status === "ACTIVE" ? "Active" : "Disabled"}</Badge>
                      </Td>
                      <Td className="text-muted">{formatDate(t.qrRotatedAt)}</Td>
                      <Td>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="secondary" onClick={() => setQrFor(t)} icon={<QrCode className="size-4" aria-hidden />}>
                            QR
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={busy === `rot-${t.id}`}
                            icon={<RefreshCw className="size-4" aria-hidden />}
                            onClick={() => {
                              if (confirm(`Rotate the QR code for ${t.label}? The printed code stops working immediately.`))
                                void act(`rot-${t.id}`, () => apiFetch(`/tables/${t.id}/qr/rotate`, { method: "POST" }), `New QR issued for ${t.label}`);
                            }}
                          >
                            Rotate
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={busy === `st-${t.id}`}
                            onClick={() =>
                              act(
                                `st-${t.id}`,
                                () => apiFetch(`/tables/${t.id}`, { method: "PATCH", body: { status: t.status === "ACTIVE" ? "DISABLED" : "ACTIVE" } }),
                                t.status === "ACTIVE" ? `${t.label} disabled` : `${t.label} enabled`,
                              )
                            }
                          >
                            {t.status === "ACTIVE" ? "Disable" : "Enable"}
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </Card>
        );
      })}
      {qrFor && (
        <Dialog
          open
          size="sm"
          onClose={() => setQrFor(null)}
          title={`QR code — ${qrFor.label}`}
          description={`${qrFor.branchName}. Guests scan this to order for this table.`}
        >
          <div className="space-y-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- server-generated SVG */}
            <img
              src={`/api/v1/tables/${qrFor.id}/qr?v=${encodeURIComponent(qrFor.qrRotatedAt)}`}
              alt={`QR code for ${qrFor.label}`}
              className="mx-auto size-60"
            />
            {qrFor.status !== "ACTIVE" && (
              <p className="text-sm font-semibold text-danger-700">This table is disabled — the code currently shows an error to guests.</p>
            )}
            <p className="font-mono text-xs break-all text-muted">{qrFor.orderUrl}</p>
            <div className="flex justify-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<Copy className="size-4" aria-hidden />}
                onClick={() => navigator.clipboard.writeText(qrFor.orderUrl).then(() => toast.success("Link copied"))}
              >
                Copy link
              </Button>
              <a href={`/api/v1/tables/${qrFor.id}/qr`} target="_blank" rel="noreferrer" className={buttonClasses("dark", "sm")}>
                Open printable SVG
              </a>
            </div>
          </div>
        </Dialog>
      )}
      {addTo && (
        <AddTableDialog
          branchId={addTo}
          branchName={branches.find((b) => b.id === addTo)?.name ?? ""}
          onClose={() => setAddTo(null)}
          onDone={() => router.refresh()}
        />
      )}
    </div>
  );
}

function AddTableDialog({ branchId, branchName, onClose, onDone }: { branchId: string; branchName: string; onClose: () => void; onDone: () => void }) {
  const [label, setLabel] = useState("");
  const [area, setArea] = useState("");
  const [seats, setSeats] = useState("4");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!label.trim()) return setError("Label is required");
    setBusy(true);
    try {
      await apiFetch(`/branches/${branchId}/tables`, { method: "POST", body: { label: label.trim(), area: area.trim() || null, seats: Number(seats) || 4 } });
      toast.success(`${label} added with a new QR code`);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title={`Add table — ${branchName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => submit()}>
            Add table
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Label" required error={error ?? undefined}>
          {(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={20} placeholder="Table 13" />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Area">{(p) => <Input {...p} value={area} onChange={(e) => setArea(e.target.value)} maxLength={40} placeholder="Terrace" />}</Field>
          <Field label="Seats">{(p) => <Input {...p} type="number" min={1} max={50} value={seats} onChange={(e) => setSeats(e.target.value)} />}</Field>
        </div>
      </form>
    </Dialog>
  );
}
