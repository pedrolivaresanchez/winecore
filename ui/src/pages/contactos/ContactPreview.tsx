import { Link } from "react-router-dom";
import { Mail, Phone } from "lucide-react";
import { ErrorState } from "@/components/ErrorState";
import { SlideOver } from "@/components/SlideOver";
import { StatusPill } from "@/components/StatusPill";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useApi } from "@/hooks/use-api";
import { copy } from "@/i18n";
import { countryLabel, roleLabels, type Contact } from "@/lib/contacts";

export function ContactPreview({
  id,
  ids,
  index,
  onOpenChange,
  onSelect,
}: {
  id: string | null;
  ids: string[];
  index: number;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const contact = useApi<Contact>(id ? `/v1/contacts/${id}?include=addresses,persons` : null);
  const ready = Boolean(id && contact.data && contact.data.id === id);

  return (
    <SlideOver
      open={Boolean(id)}
      onOpenChange={onOpenChange}
      title={ready && contact.data ? contact.data.legal_name : "Contacto"}
      description={ready && contact.data ? contact.data.trade_name || countryLabel(contact.data.country_code) : undefined}
      onPrev={index > 0 ? () => onSelect(ids[index - 1] ?? "") : undefined}
      onNext={index >= 0 && index < ids.length - 1 ? () => onSelect(ids[index + 1] ?? "") : undefined}
      prevDisabled={index <= 0}
      nextDisabled={index < 0 || index >= ids.length - 1}
      screen="contacto-preview"
    >
      {!id ? null : contact.loading || contact.data?.id !== id ? (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : contact.error || !contact.data ? (
        <ErrorState title={`${copy.error.load} (${contact.error?.code ?? "WC_ERROR"})`} detail={contact.error?.message} onRetry={contact.reload} />
      ) : (
        <PreviewBody contact={contact.data} />
      )}
    </SlideOver>
  );
}

function PreviewBody({ contact }: { contact: Contact }) {
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-2">
        {contact.email ? (
          <Button asChild variant="secondary">
            <a href={`mailto:${contact.email}`}>
              <Mail aria-hidden className="size-4" />
              {copy.contacts.email}
            </a>
          </Button>
        ) : (
          <Button type="button" variant="secondary" disabled>
            <Mail aria-hidden className="size-4" />
            {copy.contacts.email}
          </Button>
        )}
        {contact.phone ? (
          <Button asChild variant="secondary">
            <a href={`tel:${contact.phone}`}>
              <Phone aria-hidden className="size-4" />
              {copy.contacts.call}
            </a>
          </Button>
        ) : (
          <Button type="button" variant="secondary" disabled>
            <Phone aria-hidden className="size-4" />
            {copy.contacts.call}
          </Button>
        )}
      </div>
      <Button asChild className="w-full">
        <Link to={`/contactos/${contact.id}`}>{copy.contacts.open}</Link>
      </Button>
      <dl className="grid gap-2 text-compact">
        <Row label="NIF" value={contact.tax_id || "—"} />
        <Row label="País" value={countryLabel(contact.country_code)} />
        <Row label="Población" value={[contact.city, contact.province].filter(Boolean).join(", ") || "—"} />
        <Row label="Correo" value={contact.email || "—"} />
      </dl>
      <div className="flex flex-wrap gap-1.5">
        {roleLabels(contact).map((role) => (
          <StatusPill key={role}>{role}</StatusPill>
        ))}
        {contact.archived_at ? <StatusPill tone="warning">Archivado</StatusPill> : null}
      </div>
      <section>
        <h3 className="text-body font-semibold">Personas</h3>
        {contact.persons.length === 0 ? (
          <p className="mt-1 text-compact text-muted-foreground">Sin personas de contacto.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {contact.persons.map((person) => (
              <li key={person.id} className="rounded-xl border p-3">
                <p className="text-body font-medium">{person.full_name}</p>
                <p className="text-meta text-muted-foreground">{[person.role, person.email].filter(Boolean).join(" · ") || "—"}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-words">{value}</dd>
    </div>
  );
}
