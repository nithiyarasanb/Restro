"use client";

import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import type { ModifierGroup } from "@/types/domain";
import { modifierGroupSchema } from "@/lib/validation";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { parseMajor, toMajorString } from "@/lib/money";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";

interface FormValues {
  name: string;
  minSelect: number;
  maxSelect: number;
  options: Array<{ id?: string; name: string; price: string; isAvailable: boolean }>;
}

export function ModifierGroupDialog({
  group,
  currency,
  onClose,
  onSaved,
}: {
  group: ModifierGroup | null;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, control, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: group
      ? {
          name: group.name,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          options: group.options.map((o) => ({ id: o.id, name: o.name, price: toMajorString(o.priceDeltaMinor, currency), isAvailable: o.isAvailable })),
        }
      : { name: "", minSelect: 0, maxSelect: 1, options: [{ name: "", price: "0", isAvailable: true }] },
  });
  const options = useFieldArray({ control, name: "options" });

  const submit = handleSubmit(async (v) => {
    setServerError(null);
    const body = {
      name: v.name,
      minSelect: Number(v.minSelect),
      maxSelect: Number(v.maxSelect),
      options: v.options.map((o) => ({
        ...(o.id && { id: o.id }),
        name: o.name,
        priceDeltaMinor: parseMajor(o.price || "0", currency) ?? -1,
        isAvailable: o.isAvailable,
      })),
    };
    const parsed = modifierGroupSchema.safeParse(body);
    if (!parsed.success) return setServerError(parsed.error.issues[0].message.replace("Too small: expected number to be >=0", "Prices must be valid amounts"));
    try {
      await apiFetch(group ? `/menu/modifier-groups/${group.id}` : "/menu/modifier-groups", { method: group ? "PUT" : "POST", body: parsed.data });
      toast.success(group ? "Modifier group saved" : "Modifier group created");
      onSaved();
      onClose();
    } catch (e) {
      setServerError(errorMessage(e));
    }
  });

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={group ? `Edit “${group.name}”` : "New modifier group"}
      description="Changes apply to new orders only; existing orders keep their snapshot."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={formState.isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {serverError && <Notice tone="danger">{serverError}</Notice>}
        <Field label="Name" required>
          {(p) => <Input {...p} {...register("name")} placeholder="e.g. Spice level" />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Minimum choices" hint="0 = optional">
            {(p) => <Input {...p} type="number" min={0} max={10} {...register("minSelect", { valueAsNumber: true })} />}
          </Field>
          <Field label="Maximum choices">{(p) => <Input {...p} type="number" min={1} max={10} {...register("maxSelect", { valueAsNumber: true })} />}</Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-bold">Options</legend>
          <ul className="space-y-2">
            {options.fields.map((f, i) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2">
                <input
                  aria-label={`Option ${i + 1} name`}
                  {...register(`options.${i}.name`)}
                  className="h-9 min-w-40 flex-1 rounded-lg border border-line-strong px-2 text-sm"
                  placeholder="Option name"
                />
                <input
                  aria-label={`Option ${i + 1} extra price`}
                  {...register(`options.${i}.price`)}
                  inputMode="decimal"
                  className="h-9 w-24 rounded-lg border border-line-strong px-2 text-sm tabular"
                  placeholder="+0"
                />
                <label className="flex items-center gap-1 text-sm">
                  <input type="checkbox" {...register(`options.${i}.isAvailable`)} className="accent-brand-600" /> Available
                </label>
                <button
                  type="button"
                  onClick={() => options.remove(i)}
                  disabled={options.fields.length === 1}
                  className="rounded-lg p-2 text-muted hover:text-danger-700 disabled:opacity-30"
                  aria-label={`Remove option ${i + 1}`}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => options.append({ name: "", price: "0", isAvailable: true })}
            icon={<Plus className="size-4" aria-hidden />}
          >
            Add option
          </Button>
        </fieldset>
      </form>
    </Dialog>
  );
}
