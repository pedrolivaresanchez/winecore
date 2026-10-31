import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { AuditTrail } from "@/components/AuditTrail";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-field";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { copy } from "@/i18n";
import { ApiError } from "@/lib/api";
import {
  archiveContact,
  cleanInput,
  inputFromContact,
  isStale,
  roleLabels,
  unarchiveContact,
  updateContact,
  type Contact,
  type ContactInput,
} from "@/lib/contacts";
import { allows } from "@/lib/permissions";
import { normalizeTaxId } from "@/lib/tax-id";
import type { Me } from "@/lib/types";
import { NoPermission } from "@/components/NoPermission";
import { validateContact } from "@/lib/contact-validate";
import { ContactForm } from "@/pages/contactos/ContactForm";
import { AddressBook, PersonBook } from "@/pages/contactos/Related";

const TABS = [
  { id: "resumen", label: "Resumen" },
  { id: "direcciones", label: "Direcciones" },
  { id: "personas", label: "Personas" },
  { id: "historial", label: "Historial" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ContactPage({ me }: { me: Me }) {
  const { id = "" } = useParams();
  const contact = useApi<Contact>(id ? `/v1/contacts/${id}?include=addresses,persons` : null);
  const [tab, setTab] = useState<TabId>("resumen");
  const history = useApi<{ items: import("@/lib/contacts").AuditEvent[]; next_cursor: string | null }>(
    tab === "historial" && id ? `/v1/audit?table=party.contact&row_id=${id}` : null,
  );

  if (!allows(me, "contacts.read")) return <NoPermission />;
  if (contact.loading && !contact.data) {
    return (
      <div aria-busy="true" className="grid gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (contact.error || !contact.data) {
    return (
      <ErrorState
        title={`${copy.error.load} (${contact.error?.code ?? "WC_ERROR"})`}
        detail={contact.error?.message}
        onRetry={contact.reload}
      />
    );
  }

  return (
    <Loaded
      me={me}
      contact={contact.data}
      tab={tab}
      onTab={setTab}
      onReload={contact.reload}
      history={history}
    />
  );
}

function Loaded({
  me,
  contact,
  tab,
  onTab,
  onReload,
  history,
}: {
  me: Me;
  contact: Contact;
  tab: TabId;
  onTab: (tab: TabId) => void;
  onReload: () => void;
  history: ReturnType<typeof useApi<{ items: import("@/lib/contacts").AuditEvent[]; next_cursor: string | null }>>;
}) {
  const canWrite = allows(me, "contacts.write");
  const [value, setValue] = useState<ContactInput>(() => inputFromContact(contact));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const archived = Boolean(contact.archived_at);

  async function save() {
    const next = { ...value, tax_id: value.tax_id ? normalizeTaxId(value.tax_id) : "" };
    setValue(next);
    const found = validateContact(next);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    setStale(false);
    try {
      await updateContact(contact.id, cleanInput(next), contact.updated_at);
      toast("Cambios guardados");
      onReload();
    } catch (error: unknown) {
      if (isStale(error)) setStale(true);
      else if (error instanceof ApiError && error.fields) setErrors(error.fields);
      else toast(error instanceof ApiError ? error.message : "No se ha podido guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive() {
    setSaving(true);
    try {
      if (archived) await unarchiveContact(contact.id);
      else await archiveContact(contact.id);
      setConfirmArchive(false);
      onReload();
    } catch {
      toast("No se ha podido cambiar el archivo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-screen="ficha" data-tab={tab} className="flex flex-col gap-4">
      <Link to="/contactos" className="text-compact text-muted-foreground">
        ← Contactos
      </Link>
      <PageHeader
        title={contact.legal_name}
        description={contact.trade_name || roleLabels(contact).join(" · ") || "Contacto"}
        actions={
          canWrite ? (
            <Button type="button" variant={archived ? "secondary" : "danger"} onClick={() => setConfirmArchive(true)}>
              {archived ? copy.contacts.unarchive : copy.contacts.archive}
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-wrap gap-1.5">
        {roleLabels(contact).map((role) => (
          <StatusPill key={role}>{role}</StatusPill>
        ))}
        {archived ? <StatusPill tone="warning">Archivado</StatusPill> : null}
        {contact.tax_id_warning ? <StatusPill tone="warning">{contact.tax_id_warning}</StatusPill> : null}
      </div>
      {stale ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-card p-3">
          <p className="text-compact">{copy.contacts.stale}</p>
          <Button type="button" className="mt-3" onClick={onReload}>
            {copy.contacts.reload}
          </Button>
        </div>
      ) : null}
      <div className="md:hidden">
        <label className="sr-only" htmlFor="ficha-seccion">
          Sección
        </label>
        <NativeSelect id="ficha-seccion" value={tab} onChange={(event) => onTab(event.target.value as TabId)}>
          {TABS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="hidden flex-wrap gap-2 md:flex" role="tablist" aria-label="Secciones">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`h-11 rounded-full px-3 text-compact ${tab === item.id ? "bg-ink text-ink-foreground" : "bg-muted"}`}
            onClick={() => onTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="max-w-3xl">
      {tab === "resumen" ? (
        <form
          className="max-w-2xl"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <ContactForm value={value} onChange={setValue} errors={errors} disabled={!canWrite || saving} extra />
          {canWrite ? (
            <Button type="submit" className="mt-4" disabled={saving}>
              {saving ? "Guardando…" : copy.contacts.save}
            </Button>
          ) : null}
        </form>
      ) : null}
      {tab === "direcciones" ? (
        <AddressBook contactId={contact.id} addresses={contact.addresses} canWrite={canWrite} onChanged={onReload} />
      ) : null}
      {tab === "personas" ? (
        <PersonBook contactId={contact.id} persons={contact.persons} canWrite={canWrite} onChanged={onReload} />
      ) : null}
      {tab === "historial" ? (
        <AuditTrail
          items={history.data?.items ?? []}
          loading={history.loading}
          error={history.error ? `${copy.error.load} (${history.error.code})` : undefined}
          onRetry={history.reload}
        />
      ) : null}
      </div>
      <ConfirmDialog
        open={confirmArchive}
        title={archived ? "Recuperar contacto" : "Archivar contacto"}
        body={
          archived
            ? "Volverá a salir en las listas."
            : `Se archivará ${contact.legal_name}. Dejará de salir en las listas.`
        }
        confirmLabel={archived ? copy.contacts.unarchive : copy.contacts.archive}
        danger={!archived}
        busy={saving}
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => void toggleArchive()}
      />
    </div>
  );
}
