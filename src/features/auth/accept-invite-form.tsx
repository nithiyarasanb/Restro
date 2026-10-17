"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { acceptInviteSchema, type AcceptInviteInput } from "@/lib/validation";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";

export function AcceptInviteForm({ token, existingAccount, email }: { token: string; existingAccount: boolean; email: string }) {
  const router = useRouter();
  const { register, handleSubmit, setError, formState } = useForm<AcceptInviteInput>({
    resolver: existingAccount ? undefined : zodResolver(acceptInviteSchema),
    defaultValues: { name: "", password: "" },
  });
  const onSubmit = handleSubmit(async (v) => {
    try {
      const r = await apiFetch<{ home: string }>(`/invitations/${token}/accept`, { method: "POST", body: existingAccount ? {} : v });
      toast.success("Welcome to the team!");
      router.replace(r.home);
      router.refresh();
    } catch (e) {
      setError("root", { message: errorMessage(e) });
    }
  });
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
      {formState.errors.root && <Notice tone="danger">{formState.errors.root.message}</Notice>}
      <Field label="Email">{(p) => <Input {...p} value={email} readOnly disabled />}</Field>
      {existingAccount ? (
        <Notice tone="info">You already have an account with this email. Accepting adds this restaurant to it — your password stays the same.</Notice>
      ) : (
        <>
          <Field label="Your name" required error={formState.errors.name?.message}>
            {(p) => <Input {...p} autoComplete="name" {...register("name")} />}
          </Field>
          <Field label="Choose a password" required error={formState.errors.password?.message} hint="At least 10 characters with a letter and a number.">
            {(p) => <Input {...p} type="password" autoComplete="new-password" {...register("password")} />}
          </Field>
        </>
      )}
      <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
        Accept invitation
      </Button>
    </form>
  );
}
