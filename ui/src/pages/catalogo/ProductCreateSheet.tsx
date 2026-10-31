import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ApiError } from "@/lib/api";
import { createProduct, duplicateProduct } from "@/pages/catalogo/api";
import { emptyProductInput, type Format, type ProductInput, type Wine } from "@/pages/catalogo/model";
import { ProductForm } from "@/pages/catalogo/ProductForm";
import { validateProduct } from "@/pages/catalogo/validate";

export function ProductCreateSheet({
  open,
  wines,
  formats,
  onOpenChange,
}: {
  open: boolean;
  wines: Wine[];
  formats: Format[];
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [value, setValue] = useState<ProductInput>(emptyProductInput);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const idempotency = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    setValue(emptyProductInput());
    setErrors({});
    setDuplicate(null);
    idempotency.current = crypto.randomUUID();
  }, [open]);

  useEffect(() => {
    const field = Object.keys(errors)[0];
    if (field) document.getElementById(field)?.scrollIntoView({ block: "nearest" });
  }, [errors]);

  useEffect(() => {
    if (duplicate) document.getElementById("duplicate-product")?.scrollIntoView({ block: "nearest" });
  }, [duplicate]);

  async function onSubmit() {
    const found = validateProduct(value);
    setErrors(found);
    setDuplicate(null);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      const created = await createProduct(value, idempotency.current);
      toast("Producto creado");
      onOpenChange(false);
      navigate(`/catalogo/${created.id}`);
    } catch (error: unknown) {
      const existing = duplicateProduct(error);
      if (existing) {
        setDuplicate(existing);
        return;
      }
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      else toast(error instanceof ApiError ? error.message : "No se ha podido crear el producto.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Nuevo producto</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <form
            className="grid gap-4"
            data-screen="producto-alta"
            onSubmit={(event) => {
              event.preventDefault();
              void onSubmit();
            }}
          >
            <ProductForm
              section="create"
              value={value}
              onChange={setValue}
              errors={errors}
              wines={wines}
              formats={formats}
              duplicate={duplicate}
              disabled={saving}
            />
            <Button type="submit" disabled={saving}>
              {saving ? "Creando…" : "Crear producto"}
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
