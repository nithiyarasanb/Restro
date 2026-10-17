"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import { tenantSettingsSchema, type TenantSettingsInput } from "@/lib/validation";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function TenantSettingsForm({ defaults }: { defaults: TenantSettingsInput }) {
  const router = useRouter();
  const { register, handleSubmit, formState } = useForm<z.input<typeof tenantSettingsSchema>, unknown, TenantSettingsInput>({
    resolver: zodResolver(tenantSettingsSchema),
    defaultValues: defaults,
  });
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit(async (v) => {
        try {
          await apiFetch("/tenant", { method: "PATCH", body: v });
          toast.success("Settings saved");
          router.refresh();
        } catch (e) {
          toast.error(errorMessage(e));
        }
      })}
    >
      <Field label="Restaurant name" required error={formState.errors.name?.message}>
        {(p) => <Input {...p} {...register("name")} />}
      </Field>
      <Field label="Legal name" hint="Shown on receipts once receipt rules are confirmed." error={formState.errors.legalName?.message}>
        {(p) => <Input {...p} {...register("legalName")} />}
      </Field>
      <Field label="Default timezone" required error={formState.errors.timezone?.message}>
        {(p) => <Input {...p} {...register("timezone")} />}
      </Field>
      <Button type="submit" loading={formState.isSubmitting} disabled={!formState.isDirty}>
        Save changes
      </Button>
    </form>
  );
}
