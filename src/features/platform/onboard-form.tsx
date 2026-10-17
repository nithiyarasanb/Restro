"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import type { z } from "zod";
import type { Tenant } from "@/types/domain";
import { onboardTenantSchema, type OnboardTenantInput } from "@/lib/validation";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { apiFetch, ApiError, errorMessage } from "@/lib/api-client";
import { Field, Input, Select } from "@/components/ui/field";
import { Button, buttonClasses } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";

export function OnboardForm() {
  const [done, setDone] = useState<{ tenant: Tenant; inviteUrl: string } | null>(null);
  const { register, handleSubmit, setError, setValue, formState } = useForm<z.input<typeof onboardTenantSchema>, unknown, OnboardTenantInput>({
    resolver: zodResolver(onboardTenantSchema),
    defaultValues: { name: "", slug: "", country: "IN", currency: "INR", timezone: "Asia/Kolkata", branchName: "", branchAddress: "", ownerEmail: "" },
  });

  if (done)
    return (
      <div className="space-y-4">
        <Notice tone="success" title={`${done.tenant.name} created`}>
          Share this single-use link with the owner. They set their password, configure the menu and tables, and the platform activates payments before the
          branch goes live.
        </Notice>
        <p className="rounded-lg bg-canvas p-3 font-mono text-xs break-all">{done.inviteUrl}</p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            icon={<Copy className="size-4" aria-hidden />}
            onClick={() => navigator.clipboard.writeText(done.inviteUrl).then(() => toast.success("Copied"))}
          >
            Copy owner link
          </Button>
          <Link href={`/platform/tenants/${done.tenant.id}`} className={buttonClasses("primary")}>
            Open tenant
          </Link>
        </div>
      </div>
    );

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={handleSubmit(async (v) => {
        try {
          setDone(await apiFetch("/platform/tenants", { method: "POST", body: v }));
        } catch (e) {
          const fields = e instanceof ApiError ? e.fieldErrors() : {};
          if (fields.slug) setError("slug", { message: fields.slug });
          else setError("root", { message: errorMessage(e) });
        }
      })}
    >
      {formState.errors.root && <Notice tone="danger">{formState.errors.root.message}</Notice>}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-base font-bold">Restaurant</legend>
        <Field label="Name" required error={formState.errors.name?.message}>
          {(p) => (
            <Input
              {...p}
              {...register("name", {
                onChange: (e) =>
                  setValue(
                    "slug",
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, "")
                      .slice(0, 40),
                  ),
              })}
            />
          )}
        </Field>
        <Field label="Web address (slug)" required error={formState.errors.slug?.message} hint="Guests order at /r/<slug>">
          {(p) => <Input {...p} {...register("slug")} />}
        </Field>
        <Field label="Country" required error={formState.errors.country?.message} hint="ISO code, e.g. IN, SG">
          {(p) => <Input {...p} maxLength={2} {...register("country")} />}
        </Field>
        <Field label="Currency" required error={formState.errors.currency?.message}>
          {(p) => (
            <Select {...p} {...register("currency")}>
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Timezone" required error={formState.errors.timezone?.message}>
          {(p) => <Input {...p} {...register("timezone")} />}
        </Field>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-base font-bold">First branch & owner</legend>
        <Field label="Branch name" required error={formState.errors.branchName?.message}>
          {(p) => <Input {...p} {...register("branchName")} />}
        </Field>
        <Field label="Owner email" required error={formState.errors.ownerEmail?.message}>
          {(p) => <Input {...p} type="email" {...register("ownerEmail")} />}
        </Field>
        <Field label="Branch address" required error={formState.errors.branchAddress?.message} className="sm:col-span-2">
          {(p) => <Input {...p} {...register("branchAddress")} />}
        </Field>
      </fieldset>
      <Button type="submit" size="lg" loading={formState.isSubmitting}>
        Create tenant & owner invitation
      </Button>
    </form>
  );
}
