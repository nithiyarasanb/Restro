"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import type { AdminMenuView } from "@/types/api";
import type { MenuItem } from "@/types/domain";
import { menuItemSchema } from "@/lib/validation";
import { ApiError, apiFetch, errorMessage } from "@/lib/api-client";
import { parseMajor, toMajorString } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";

interface FormValues {
  name: string;
  description: string;
  categoryId: string;
  price: string;
  dietary: string;
  stationId: string;
  imageUrl: string | null;
  variants: Array<{ id?: string; name: string; delta: string; isDefault: boolean }>;
  modifierGroupIds: string[];
}

export function ItemEditor({
  item,
  menu,
  currency,
  imagePreview,
}: {
  item: MenuItem | null;
  menu: AdminMenuView;
  currency: string;
  imagePreview: string | null;
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(imagePreview);
  const [uploading, setUploading] = useState(false);
  const { register, control, handleSubmit, setValue, formState } = useForm<FormValues>({
    defaultValues: item
      ? {
          name: item.name,
          description: item.description,
          categoryId: item.categoryId,
          price: toMajorString(item.basePriceMinor, currency),
          dietary: item.dietary ?? "",
          stationId: item.stationId ?? "",
          imageUrl: item.imageUrl,
          variants: item.variants.map((v) => ({ id: v.id, name: v.name, delta: toMajorString(v.priceDeltaMinor, currency), isDefault: v.isDefault })),
          modifierGroupIds: item.modifierGroupIds,
        }
      : {
          name: "",
          description: "",
          categoryId: menu.categories[0]?.id ?? "",
          price: "",
          dietary: "",
          stationId: "",
          imageUrl: null,
          variants: [],
          modifierGroupIds: [],
        },
  });
  const variants = useFieldArray({ control, name: "variants" });
  const variantValues = useWatch({ control, name: "variants" });

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/v1/files", { method: "POST", body: form, credentials: "same-origin" });
      const json = await res.json();
      if (!res.ok) throw new ApiError(res.status, json.code, json.message, json.requestId);
      setValue("imageUrl", json.ref, { shouldDirty: true });
      setPreview(json.url);
      toast.success("Image uploaded");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const submit = handleSubmit(async (v) => {
    const base = parseMajor(v.price, currency);
    const body = {
      categoryId: v.categoryId,
      name: v.name,
      description: v.description,
      basePriceMinor: base ?? -1,
      dietary: v.dietary || null,
      stationId: v.stationId || null,
      imageUrl: v.imageUrl,
      sortOrder: item?.sortOrder ?? 1000,
      variants: v.variants.map((x) => {
        const neg = x.delta.trim().startsWith("-");
        const abs = parseMajor(x.delta.replace(/^[-+]/, "") || "0", currency);
        return { ...(x.id && { id: x.id }), name: x.name, priceDeltaMinor: abs === null ? Number.NaN : neg ? -abs : abs, isDefault: x.isDefault };
      }),
      modifierGroupIds: v.modifierGroupIds,
    };
    const parsed = menuItemSchema.safeParse(body);
    if (!parsed.success || base === null) {
      const next: Record<string, string> = {};
      if (base === null) next.basePriceMinor = "Enter a valid price, e.g. 260 or 260.50";
      for (const i of parsed.error?.issues ?? []) next[i.path.join(".")] ??= i.message;
      setErrors(next);
      return;
    }
    setErrors({});
    try {
      await apiFetch(item ? `/menu/items/${item.id}` : "/menu/items", { method: item ? "PUT" : "POST", body: parsed.data });
      toast.success(item ? "Item saved" : "Item created");
      router.push("/admin/menu");
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      toast.error(errorMessage(e));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 xl:grid-cols-[2fr_1fr]">
      {Object.keys(errors).length > 0 && (
        <Notice tone="danger" title="Please fix the highlighted fields" className="xl:col-span-2">
          {Object.values(errors)[0]}
        </Notice>
      )}
      <div className="space-y-4">
        <Card>
          <CardHeader title="Details" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required error={errors.name} className="sm:col-span-2">
              {(p) => <Input {...p} {...register("name")} />}
            </Field>
            <Field label="Description" error={errors.description} className="sm:col-span-2">
              {(p) => <Textarea {...p} {...register("description")} maxLength={300} />}
            </Field>
            <Field label="Category" required error={errors.categoryId}>
              {(p) => (
                <Select {...p} {...register("categoryId")}>
                  {menu.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={`Base price (${currency})`} required error={errors.basePriceMinor} hint="Branches can override this price.">
              {(p) => <Input {...p} inputMode="decimal" {...register("price")} placeholder="260" />}
            </Field>
            <Field label="Dietary">
              {(p) => (
                <Select {...p} {...register("dietary")}>
                  <option value="">Not specified</option>
                  <option value="VEG">Vegetarian</option>
                  <option value="VEGAN">Vegan</option>
                  <option value="EGG">Contains egg</option>
                  <option value="NON_VEG">Non-vegetarian</option>
                </Select>
              )}
            </Field>
            <Field label="Kitchen station" hint="Used to filter the kitchen display.">
              {(p) => (
                <Select {...p} {...register("stationId")}>
                  <option value="">Any station</option>
                  {menu.stations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {menu.branches.find((b) => b.id === s.branchId)?.name ?? "branch"}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Sizes / variants" description="Optional. Each variant adds (or subtracts) from the base price; exactly one is the default." />
          <CardBody>
            {variants.fields.length === 0 && <p className="text-sm text-muted">No variants — the item has a single size.</p>}
            <ul className="space-y-2">
              {variants.fields.map((f, i) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label={`Variant ${i + 1} name`}
                    {...register(`variants.${i}.name`)}
                    placeholder="e.g. Large"
                    className="h-9 min-w-40 flex-1 rounded-lg border border-line-strong px-2 text-sm"
                  />
                  <input
                    aria-label={`Variant ${i + 1} price difference`}
                    {...register(`variants.${i}.delta`)}
                    placeholder="+60"
                    inputMode="decimal"
                    className="h-9 w-24 rounded-lg border border-line-strong px-2 text-sm tabular"
                  />
                  <label className="flex items-center gap-1 text-sm">
                    <input
                      type="radio"
                      name="default-variant"
                      checked={!!variantValues[i]?.isDefault}
                      onChange={() => variantValues.forEach((_, j) => setValue(`variants.${j}.isDefault`, j === i, { shouldDirty: true }))}
                      className="accent-brand-600"
                    />
                    Default
                  </label>
                  <button
                    type="button"
                    onClick={() => variants.remove(i)}
                    className="rounded-lg p-2 text-muted hover:text-danger-700"
                    aria-label={`Remove variant ${i + 1}`}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            {errors.variants && <p className="mt-1 text-xs font-bold text-danger-700">{errors.variants}</p>}
            <Button
              size="sm"
              variant="ghost"
              className="mt-2"
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => variants.append({ name: "", delta: "0", isDefault: variants.fields.length === 0 })}
            >
              Add variant
            </Button>
          </CardBody>
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Photo" />
          <CardBody className="space-y-3">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed private image URL
              <img src={preview} alt="Item preview" className="aspect-square w-full rounded-xl object-cover" />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-canvas text-muted">No photo</div>
            )}
            <label className={buttonClasses("secondary", "md", "w-full cursor-pointer")}>
              <ImagePlus className="size-4" aria-hidden /> {uploading ? "Uploading…" : "Upload image"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={uploading}
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
            </label>
            <p className="text-xs text-muted">PNG, JPEG or WebP, up to 2 MB. Stored privately and served through signed links.</p>
            {preview && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setValue("imageUrl", null, { shouldDirty: true });
                  setPreview(null);
                }}
              >
                Remove photo
              </Button>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Modifier groups" />
          <CardBody className="space-y-2">
            {menu.modifierGroups.length === 0 && <p className="text-sm text-muted">None yet — create them on the Menu page.</p>}
            {menu.modifierGroups.map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" value={g.id} {...register("modifierGroupIds")} className="accent-brand-600" />
                {g.name} <span className="text-xs text-muted">({g.options.length} options)</span>
              </label>
            ))}
          </CardBody>
        </Card>
        <div className="flex gap-2">
          <Button type="submit" size="lg" className="flex-1" loading={formState.isSubmitting}>
            {item ? "Save item" : "Create item"}
          </Button>
          <Link href="/admin/menu" className={buttonClasses("secondary", "lg")}>
            Cancel
          </Link>
        </div>
      </div>
    </form>
  );
}
