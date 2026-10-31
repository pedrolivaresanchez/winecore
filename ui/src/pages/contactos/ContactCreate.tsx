import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useMinWidth } from "@/hooks/use-media";
import { copy } from "@/i18n";
import { ApiError } from "@/lib/api";
import { cleanInput, createContact, duplicateContact, emptyInput, type ContactInput } from "@/lib/contacts";
import { allows } from "@/lib/permissions";
import { normalizeTaxId } from "@/lib/tax-id";
import type { Me } from "@/lib/types";
import { NoPermission } from "@/components/NoPermission";
import { validateContact } from "@/lib/contact-validate";
import { ContactForm } from "@/pages/contactos/ContactForm";

export function ContactCreate({ me }: { me: Me }) {
  const navigate = useNavigate();
  const desktop = useMinWidth(768);
  const [value, setValue] = useState<ContactInput>(emptyInput);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const idempotency = useRef(crypto.randomUUID());

  useEffect(() => {
    const field = Object.keys(errors)[0];
    if (field) document.getElementById(field)?.scrollIntoView({ block: "center" });
  }, [errors]);

  useEffect(() => {
    if (duplicate) document.getElementById("duplicate-tax")?.scrollIntoView({ block: "center" });
  }, [duplicate]);

  if (!allows(me, "contacts.read")) return <NoPermission />;

  async function onSubmit() {
    const next = { ...value, tax_id: value.tax_id ? normalizeTaxId(value.tax_id) : "" };
    setValue(next);
    const found = validateContact(next);
    setErrors(found);
    setDuplicate(null);
    if (Object.keys(found).length > 0 || !allows(me, "contacts.write")) return;
    setSaving(true);
    try {
      const created = await createContact(cleanInput(next), idempotency.current);
      toast("Contacto creado");
      navigate(`/contactos/${created.id}`);
    } catch (error: unknown) {
      const existing = duplicateContact(error);
      if (existing) {
        setDuplicate(existing);
        return;
      }
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      else toast(error instanceof ApiError ? error.message : "No se ha podido crear el contacto.");
    } finally {
      setSaving(false);
    }
  }

  const form = (
    <form
      className="grid gap-4"
      data-screen="contacto-nuevo"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      <ContactForm value={value} onChange={setValue} errors={errors} duplicate={duplicate} disabled={saving || !allows(me, "contacts.write")} />
      {allows(me, "contacts.write") ? (
        <Button type="submit" disabled={saving}>
          {saving ? "Creando…" : copy.contacts.create}
        </Button>
      ) : null}
    </form>
  );

  if (!desktop) {
    return (
      <Sheet open onOpenChange={(open) => { if (!open) navigate("/contactos"); }}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{copy.contacts.new}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">{form}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Link to="/contactos" className="text-compact text-muted-foreground">
        ← Contactos
      </Link>
      <PageHeader title={copy.contacts.new} description="Alta rápida. El correo crea la primera persona de contacto." />
      {form}
    </div>
  );
}
