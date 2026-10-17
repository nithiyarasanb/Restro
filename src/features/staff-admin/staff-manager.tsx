"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Copy, UserPlus } from "lucide-react";
import type { InvitationView, StaffMemberView } from "@/types/api";
import type { StaffRole } from "@/types/domain";
import { inviteSchema, type InviteInput } from "@/lib/validation";
import { ROLE_LABELS } from "@/lib/permissions";
import { apiFetch, ApiError, errorMessage } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { DataTable, Td, Th, Tr } from "@/components/ui/table";
import { EmptyState, Notice } from "@/components/ui/feedback";

interface Props {
  members: StaffMemberView[];
  invitations: InvitationView[];
  branches: Array<{ id: string; name: string }>;
  invitable: StaffRole[];
  currentUserId: string;
}

export function StaffManager({ members, invitations, branches, invitable, currentUserId }: Props) {
  const router = useRouter();
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<StaffMemberView | null>(null);
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "Other branch";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`Team (${members.length})`}
          description="Access is enforced by the server on every request, scoped to the branches listed."
          actions={
            invitable.length > 0 && (
              <Button onClick={() => setInviting(true)} icon={<UserPlus className="size-4" aria-hidden />}>
                Invite
              </Button>
            )
          }
        />
        <DataTable caption="Team members">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Branches</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <Tr key={m.membershipId}>
                <Td>
                  <p className="font-semibold">{m.name}</p>
                  <p className="text-xs text-muted">{m.email}</p>
                </Td>
                <Td>{ROLE_LABELS[m.role]}</Td>
                <Td className="text-sm">{m.role === "OWNER" ? "All branches" : m.branchIds.map(branchName).join(", ")}</Td>
                <Td>
                  <Badge tone={m.status === "ACTIVE" ? "success" : "neutral"}>{m.status === "ACTIVE" ? "Active" : "Disabled"}</Badge>
                </Td>
                <Td className="text-right">
                  {m.userId !== currentUserId && invitable.includes(m.role) && (
                    <Button size="sm" variant="secondary" onClick={() => setEditing(m)}>
                      Edit access
                    </Button>
                  )}
                  {m.userId === currentUserId && <span className="text-xs text-muted">You</span>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      </Card>
      <Card>
        <CardHeader title="Invitations" description="Links are single-use and expire after 7 days." />
        {invitations.length === 0 ? (
          <EmptyState title="No invitations" />
        ) : (
          <DataTable caption="Invitations">
            <thead>
              <tr>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Expires</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((i) => (
                <Tr key={i.id}>
                  <Td>{i.email}</Td>
                  <Td>{ROLE_LABELS[i.role]}</Td>
                  <Td>
                    <Badge tone={i.status === "PENDING" ? "warning" : i.status === "ACCEPTED" ? "success" : "neutral"}>{i.status.toLowerCase()}</Badge>
                  </Td>
                  <Td className="text-muted">{formatDate(i.expiresAt)}</Td>
                  <Td className="text-right">
                    {i.status === "PENDING" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            await apiFetch(`/staff/invitations/${i.id}`, { method: "DELETE" });
                            toast.success("Invitation revoked");
                            router.refresh();
                          } catch (e) {
                            toast.error(errorMessage(e));
                          }
                        }}
                      >
                        Revoke
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
      {inviting && <InviteDialog branches={branches} invitable={invitable} onClose={() => setInviting(false)} onDone={() => router.refresh()} />}
      {editing && (
        <EditMemberDialog member={editing} branches={branches} invitable={invitable} onClose={() => setEditing(null)} onDone={() => router.refresh()} />
      )}
    </div>
  );
}

function BranchChecks({ branches, value, onChange }: { branches: Props["branches"]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold">Branches</legend>
      <div className="flex flex-wrap gap-3">
        {branches.map((b) => (
          <label key={b.id} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              className="accent-brand-600"
              checked={value.includes(b.id)}
              onChange={(e) => onChange(e.target.checked ? [...value, b.id] : value.filter((x) => x !== b.id))}
            />
            {b.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function InviteDialog({
  branches,
  invitable,
  onClose,
  onDone,
}: {
  branches: Props["branches"];
  invitable: StaffRole[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [link, setLink] = useState<string | null>(null);
  const { register, handleSubmit, control, setValue, setError, formState } = useForm<z.input<typeof inviteSchema>, unknown, InviteInput>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: invitable.includes("KITCHEN") ? "KITCHEN" : invitable[0], branchIds: branches.length === 1 ? [branches[0].id] : [] },
  });
  const role = useWatch({ control, name: "role" });
  const branchIds = useWatch({ control, name: "branchIds" }) ?? [];
  const submit = handleSubmit(async (v) => {
    try {
      const r = await apiFetch<{ inviteUrl: string }>("/staff/invitations", { method: "POST", body: v });
      setLink(r.inviteUrl);
      onDone();
    } catch (e) {
      const fields = e instanceof ApiError ? e.fieldErrors() : {};
      if (fields.email) setError("email", { message: fields.email });
      else if (fields.branchIds) setError("branchIds", { message: fields.branchIds });
      else setError("root", { message: errorMessage(e) });
    }
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Invite a team member"
      description="They set their own password from the link. Email delivery is not connected yet, so share the link yourself."
      footer={
        link ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} loading={formState.isSubmitting}>
              Create invitation
            </Button>
          </>
        )
      }
    >
      {link ? (
        <div className="space-y-3">
          <Notice tone="success" title="Invitation created">
            Send this single-use link to the person. It expires in 7 days.
          </Notice>
          <p className="rounded-lg bg-canvas p-3 font-mono text-xs break-all">{link}</p>
          <Button
            variant="secondary"
            icon={<Copy className="size-4" aria-hidden />}
            onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Link copied"))}
          >
            Copy link
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {formState.errors.root && <Notice tone="danger">{formState.errors.root.message}</Notice>}
          <Field label="Email" required error={formState.errors.email?.message}>
            {(p) => <Input {...p} type="email" {...register("email")} />}
          </Field>
          <Field label="Role" required>
            {(p) => (
              <Select {...p} {...register("role")}>
                {invitable.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {role !== "OWNER" && <BranchChecks branches={branches} value={branchIds} onChange={(v) => setValue("branchIds", v, { shouldValidate: true })} />}
          {formState.errors.branchIds && <p className="text-xs font-bold text-danger-700">{formState.errors.branchIds.message}</p>}
        </form>
      )}
    </Dialog>
  );
}

function EditMemberDialog({
  member,
  branches,
  invitable,
  onClose,
  onDone,
}: {
  member: StaffMemberView;
  branches: Props["branches"];
  invitable: StaffRole[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [role, setRole] = useState<StaffRole>(member.role);
  const [branchIds, setBranchIds] = useState(member.branchIds);
  const [busy, setBusy] = useState(false);
  const save = async (patch: Record<string, unknown>, msg: string) => {
    setBusy(true);
    try {
      await apiFetch(`/staff/memberships/${member.membershipId}`, { method: "PATCH", body: patch });
      toast.success(msg);
      onDone();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Access for ${member.name}`}
      description={member.email}
      footer={
        <>
          <Button
            variant={member.status === "ACTIVE" ? "danger" : "success"}
            className="mr-auto"
            disabled={busy}
            onClick={() =>
              save(
                { status: member.status === "ACTIVE" ? "DISABLED" : "ACTIVE" },
                member.status === "ACTIVE" ? "Access disabled and sessions ended" : "Access restored",
              )
            }
          >
            {member.status === "ACTIVE" ? "Disable access" : "Restore access"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={role !== "OWNER" && branchIds.length === 0}
            onClick={() => save({ role, branchIds: role === "OWNER" ? [] : branchIds }, "Access updated")}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Role">
          {(p) => (
            <Select {...p} value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
              {invitable.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {role !== "OWNER" && <BranchChecks branches={branches} value={branchIds} onChange={setBranchIds} />}
      </div>
    </Dialog>
  );
}
