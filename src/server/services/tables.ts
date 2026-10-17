import QRCode from "qrcode";
import type { TableView } from "@/types/api";
import type { TableInput } from "@/lib/validation";
import type { DataStore } from "@/server/store/types";
import { UniqueViolationError } from "@/server/store/types";
import { DomainError, notFound } from "@/server/errors";
import { getConfig } from "@/server/config";
import { newQrRef } from "@/server/crypto";
import { branchFilter, requirePermission, type Actor } from "@/server/auth/actor";
import { audit, branchNames } from "./shared";

// Tables & QR module (FR-03, BR-02). A QR reference is an opaque, revocable
// token that only establishes ordering context — never a login.

export function tableOrderUrl(qrRef: string): string {
  return new URL(`/q/${qrRef}`, getConfig().APP_BASE_URL).toString();
}

export async function listTables(store: DataStore, actor: Actor | null, branchId?: string): Promise<TableView[]> {
  const staff = requirePermission(actor, "tables.manage");
  const allowed = branchFilter(staff, branchId);
  const [tables, names] = await Promise.all([store.listTables(staff.tenant.id), branchNames(store, staff.tenant.id)]);
  return tables
    .filter((t) => !allowed || allowed.includes(t.branchId))
    .map((t) => ({ ...t, branchName: names.get(t.branchId) ?? "", orderUrl: tableOrderUrl(t.qrRef) }));
}

export async function createTable(store: DataStore, actor: Actor | null, branchId: string, input: TableInput) {
  const staff = requirePermission(actor, "tables.manage", branchId);
  if (!(await store.getBranch(staff.tenant.id, branchId))) throw notFound("Branch");
  const now = new Date().toISOString();
  try {
    const t = await store.createTable({
      tenantId: staff.tenant.id,
      branchId,
      label: input.label,
      area: input.area,
      seats: input.seats,
      qrRef: newQrRef(),
      status: "ACTIVE",
      qrRotatedAt: now,
      createdAt: now,
    });
    await audit(store, staff, { tenantId: staff.tenant.id, action: "table.created", entityType: "table", entityId: t.id, meta: { label: t.label } });
    return t;
  } catch (e) {
    if (e instanceof UniqueViolationError)
      throw new DomainError("CONFLICT", `A table called “${input.label}” already exists in this branch`, { field: "label" });
    throw e;
  }
}

async function loadTable(store: DataStore, actor: Actor | null, id: string) {
  const staff = requirePermission(actor, "tables.manage");
  const table = await store.getTable(staff.tenant.id, id);
  if (!table || (staff.branchScope !== "ALL" && !staff.branchScope.includes(table.branchId))) throw notFound("Table");
  return { staff, table };
}

export async function updateTable(store: DataStore, actor: Actor | null, id: string, patch: Partial<TableInput> & { status?: "ACTIVE" | "DISABLED" }) {
  const { staff, table } = await loadTable(store, actor, id);
  try {
    const t = await store.updateTable(staff.tenant.id, table.id, patch);
    await audit(store, staff, {
      tenantId: staff.tenant.id,
      action: patch.status ? `table.${patch.status === "ACTIVE" ? "enabled" : "disabled"}` : "table.updated",
      entityType: "table",
      entityId: id,
      meta: { label: t!.label, ...patch },
    });
    return t!;
  } catch (e) {
    if (e instanceof UniqueViolationError) throw new DomainError("CONFLICT", "Another table in this branch already uses that label", { field: "label" });
    throw e;
  }
}

/** Issue a new QR reference; the old printed code stops working immediately. */
export async function rotateTableQr(store: DataStore, actor: Actor | null, id: string) {
  const { staff, table } = await loadTable(store, actor, id);
  const t = await store.updateTable(staff.tenant.id, table.id, { qrRef: newQrRef(), qrRotatedAt: new Date().toISOString() });
  await audit(store, staff, { tenantId: staff.tenant.id, action: "table.qr_rotated", entityType: "table", entityId: id, meta: { label: table.label } });
  return t!;
}

export async function tableQrSvg(store: DataStore, actor: Actor | null, id: string): Promise<{ svg: string; label: string; url: string }> {
  const { table } = await loadTable(store, actor, id);
  const url = tableOrderUrl(table.qrRef);
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#111827", light: "#ffffff" } });
  return { svg, label: table.label, url };
}
