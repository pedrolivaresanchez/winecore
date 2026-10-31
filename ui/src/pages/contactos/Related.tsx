import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-field";
import { Field } from "@/components/Field";
import {
  archiveAddress,
  archivePerson,
  COUNTRIES,
  createAddress,
  createPerson,
  updateAddress,
  updatePerson,
  type Address,
  type AddressKind,
  type ContactPerson,
} from "@/lib/contacts";

const EMPTY_ADDRESS: Omit<Address, "id"> = {
  kind: "billing",
  label: "",
  line1: "",
  line2: "",
  postal_code: "",
  city: "",
  province: "",
  country_code: "ES",
  is_default: false,
};

const EMPTY_PERSON: Omit<ContactPerson, "id"> = {
  full_name: "",
  role: "",
  email: "",
  phone: "",
  receives_invoices: false,
  receives_dunning: false,
};

export function AddressBook({
  contactId,
  addresses,
  canWrite,
  onChanged,
}: {
  contactId: string;
  addresses: Address[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState(EMPTY_ADDRESS);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!draft.line1.trim() || !draft.city.trim()) {
      toast("La dirección necesita calle y población.");
      return;
    }
    setBusy(true);
    try {
      const body = {
        ...draft,
        label: draft.label || null,
        line2: draft.line2 || null,
        postal_code: draft.postal_code || null,
        province: draft.province || null,
      };
      if (editing) await updateAddress(contactId, editing, body);
      else await createAddress(contactId, body);
      setDraft(EMPTY_ADDRESS);
      setEditing(null);
      setOpen(false);
      onChanged();
    } catch {
      toast("No se ha podido guardar la dirección.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      {addresses.length === 0 ? <p className="text-compact text-muted-foreground">Sin direcciones.</p> : null}
      <ul className="grid gap-2">
        {addresses.map((address) => (
          <li key={address.id} className="rounded-xl border p-3">
            <p className="text-body font-medium">{address.label || kindLabel(address.kind)}</p>
            <p className="text-compact">{address.line1}</p>
            <p className="text-meta text-muted-foreground">
              {[address.postal_code, address.city, address.province, address.country_code].filter(Boolean).join(" · ")}
            </p>
            {canWrite ? (
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => {
                    setDraft({
                      kind: address.kind,
                      label: address.label ?? "",
                      line1: address.line1,
                      line2: address.line2 ?? "",
                      postal_code: address.postal_code ?? "",
                      city: address.city,
                      province: address.province ?? "",
                      country_code: address.country_code,
                      is_default: address.is_default,
                    });
                    setEditing(address.id);
                    setOpen(true);
                  }}
                >
                  Editar
                </Button>
                <Button type="button" variant="ghost" size="md" onClick={() => setArchiveId(address.id)}>
                  Archivar
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {canWrite ? (
        open ? (
          <div className="grid gap-3 rounded-xl border p-3">
            <NativeSelect value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as AddressKind })}>
              <option value="billing">Facturación</option>
              <option value="shipping">Envío</option>
              <option value="both">Facturación y envío</option>
            </NativeSelect>
            <Field id="addr-line1" label="Calle">
              <Input id="addr-line1" value={draft.line1 ?? ""} onChange={(event) => setDraft({ ...draft, line1: event.target.value })} />
            </Field>
            <Field id="addr-city" label="Población">
              <Input id="addr-city" value={draft.city} onChange={(event) => setDraft({ ...draft, city: event.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="addr-cp" label="Código postal">
                <Input id="addr-cp" value={draft.postal_code ?? ""} onChange={(event) => setDraft({ ...draft, postal_code: event.target.value })} />
              </Field>
              <Field id="addr-province" label="Provincia">
                <Input id="addr-province" value={draft.province ?? ""} onChange={(event) => setDraft({ ...draft, province: event.target.value })} />
              </Field>
            </div>
            <NativeSelect value={draft.country_code} onChange={(event) => setDraft({ ...draft, country_code: event.target.value })}>
              {COUNTRIES.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.label}
                </option>
              ))}
            </NativeSelect>
            <label className="flex min-h-11 items-center gap-2 text-compact">
              <input type="checkbox" checked={draft.is_default} onChange={(event) => setDraft({ ...draft, is_default: event.target.checked })} />
              Dirección habitual
            </label>
            <div className="flex gap-2">
              <Button type="button" onClick={() => void save()} disabled={busy}>
                Guardar
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setOpen(false);
                  setEditing(null);
                  setDraft(EMPTY_ADDRESS);
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setEditing(null);
              setDraft(EMPTY_ADDRESS);
              setOpen(true);
            }}
          >
            Nueva dirección
          </Button>
        )
      ) : null}
      <ConfirmDialog
        open={archiveId !== null}
        title="Archivar dirección"
        body="Dejará de usarse en documentos nuevos."
        confirmLabel="Archivar"
        danger
        busy={busy}
        onClose={() => setArchiveId(null)}
        onConfirm={() => {
          if (!archiveId) return;
          setBusy(true);
          void archiveAddress(contactId, archiveId)
            .then(() => {
              setArchiveId(null);
              onChanged();
            })
            .catch(() => toast("No se ha podido archivar la dirección."))
            .finally(() => setBusy(false));
        }}
      />
    </div>
  );
}

function kindLabel(kind: AddressKind) {
  if (kind === "shipping") return "Envío";
  if (kind === "both") return "Facturación y envío";
  return "Facturación";
}

export function PersonBook({
  contactId,
  persons,
  canWrite,
  onChanged,
}: {
  contactId: string;
  persons: ContactPerson[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState(EMPTY_PERSON);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (draft.full_name.trim().length < 2) {
      toast("Escribe el nombre de la persona.");
      return;
    }
    setBusy(true);
    try {
      const body = {
        ...draft,
        role: draft.role || null,
        email: draft.email || null,
        phone: draft.phone || null,
      };
      if (editing) await updatePerson(contactId, editing, body);
      else await createPerson(contactId, body);
      setDraft(EMPTY_PERSON);
      setEditing(null);
      setOpen(false);
      onChanged();
    } catch {
      toast("No se ha podido guardar la persona.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      {persons.length === 0 ? <p className="text-compact text-muted-foreground">Sin personas de contacto.</p> : null}
      <ul className="grid gap-2">
        {persons.map((person) => (
          <li key={person.id} className="rounded-xl border p-3">
            <p className="text-body font-medium">{person.full_name}</p>
            <p className="text-meta text-muted-foreground">{[person.role, person.email].filter(Boolean).join(" · ") || "—"}</p>
            <p className="text-meta text-muted-foreground">
              {[person.receives_invoices ? "Recibe facturas" : "", person.receives_dunning ? "Recibe avisos de cobro" : ""].filter(Boolean).join(" · ")}
            </p>
            {canWrite ? (
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => {
                    setDraft({
                      full_name: person.full_name,
                      role: person.role ?? "",
                      email: person.email ?? "",
                      phone: person.phone ?? "",
                      receives_invoices: person.receives_invoices,
                      receives_dunning: person.receives_dunning,
                    });
                    setEditing(person.id);
                    setOpen(true);
                  }}
                >
                  Editar
                </Button>
                <Button type="button" variant="ghost" size="md" onClick={() => setArchiveId(person.id)}>
                  Archivar
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {canWrite && open ? (
        <div className="grid gap-3 rounded-xl border p-3">
          <Field id="person-name" label="Nombre">
            <Input id="person-name" value={draft.full_name} onChange={(event) => setDraft({ ...draft, full_name: event.target.value })} />
          </Field>
          <Field id="person-role" label="Cargo">
            <Input id="person-role" value={draft.role ?? ""} onChange={(event) => setDraft({ ...draft, role: event.target.value })} />
          </Field>
          <Field id="person-email" label="Correo">
            <Input id="person-email" type="email" value={draft.email ?? ""} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
          </Field>
          <label className="flex min-h-11 items-center gap-2 text-compact">
            <input type="checkbox" checked={draft.receives_invoices} onChange={(event) => setDraft({ ...draft, receives_invoices: event.target.checked })} />
            Recibe facturas
          </label>
          <label className="flex min-h-11 items-center gap-2 text-compact">
            <input type="checkbox" checked={draft.receives_dunning} onChange={(event) => setDraft({ ...draft, receives_dunning: event.target.checked })} />
            Recibe avisos de cobro
          </label>
          <div className="flex gap-2">
            <Button type="button" onClick={() => void save()} disabled={busy}>
              Guardar
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setEditing(null);
                setDraft(EMPTY_PERSON);
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
      {canWrite && !open ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setEditing(null);
            setDraft(EMPTY_PERSON);
            setOpen(true);
          }}
        >
          Nueva persona
        </Button>
      ) : null}
      <ConfirmDialog
        open={archiveId !== null}
        title="Archivar persona"
        body="Dejará de recibir avisos."
        confirmLabel="Archivar"
        danger
        busy={busy}
        onClose={() => setArchiveId(null)}
        onConfirm={() => {
          if (!archiveId) return;
          setBusy(true);
          void archivePerson(contactId, archiveId)
            .then(() => {
              setArchiveId(null);
              onChanged();
            })
            .catch(() => toast("No se ha podido archivar la persona."))
            .finally(() => setBusy(false));
        }}
      />
    </div>
  );
}
