"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { LogIn } from "lucide-react";
import { loginSchema, type LoginInput } from "@/lib/validation";
import { apiFetch, ApiError, errorMessage } from "@/lib/api-client";
import type { SessionView } from "@/types/api";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";

interface Props {
  next: string | null;
  defaultEmail: string;
  demoAccounts: Array<{ label: string; email: string }>;
  demoPassword?: string;
}

export function LoginForm({ next, defaultEmail, demoAccounts, demoPassword }: Props) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: defaultEmail, password: defaultEmail && demoPassword ? demoPassword : "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const session = await apiFetch<SessionView>("/auth/login", { method: "POST", body: values });
      toast.success(`Welcome, ${session.user.name}`);
      router.replace(next ?? session.home);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setError("root", { message: e.message });
      else setError("root", { message: errorMessage(e) });
    }
  });

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
      {errors.root && <Notice tone="danger">{errors.root.message}</Notice>}
      <Field label="Email" error={errors.email?.message} required>
        {(p) => <Input {...p} type="email" autoComplete="username" {...register("email")} />}
      </Field>
      <Field label="Password" error={errors.password?.message} required>
        {(p) => <Input {...p} type="password" autoComplete="current-password" {...register("password")} />}
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={isSubmitting} icon={<LogIn className="size-4" aria-hidden />}>
        Sign in
      </Button>
      {demoAccounts.length > 0 && demoPassword && (
        <fieldset className="rounded-xl border border-dashed border-line-strong p-3">
          <legend className="px-1 text-xs font-bold text-muted uppercase">Demo accounts (fill in)</legend>
          <div className="flex flex-wrap gap-2">
            {demoAccounts.map((a) => (
              <button
                key={a.email}
                type="button"
                className="rounded-full border border-line-strong bg-canvas px-3 py-1 text-xs font-semibold hover:border-brand-500 hover:text-brand-700"
                onClick={() => {
                  setValue("email", a.email, { shouldValidate: true });
                  setValue("password", demoPassword, { shouldValidate: true });
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </form>
  );
}
