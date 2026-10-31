import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Mail, Phone } from '@/ui/icons'
import { Badge, Button, Drawer, DrawerBody, DrawerHeader, Skeleton } from '@/ui'
import { ErrorState } from '@/components/ErrorState'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { countryLabel, roleLabels, type Contact } from '@/lib/contacts'
import { iconStroke } from '@/lib/motion'

export function ContactPreview({
  id,
  ids,
  index,
  onOpenChange,
  onSelect,
}: {
  id: string | null
  ids: string[]
  index: number
  onOpenChange: (open: boolean) => void
  onSelect: (id: string) => void
}) {
  const contact = useApi<Contact>(id ? `/v1/contacts/${id}?include=addresses,persons` : null)
  const ready = Boolean(id && contact.data && contact.data.id === id)
  const title = ready && contact.data ? contact.data.legal_name : 'Contacto'

  return (
    <Drawer open={Boolean(id)} onClose={() => onOpenChange(false)} labelledBy="preview-title" size="md">
      <DrawerHeader
        titleId="preview-title"
        title={title}
        description={ready && contact.data ? contact.data.trade_name || countryLabel(contact.data.country_code) : undefined}
        onClose={() => onOpenChange(false)}
      />
      <div className="flex items-center gap-1 px-4 pb-2 sm:px-6">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Anterior"
          disabled={index <= 0}
          onClick={() => onSelect(ids[index - 1] ?? '')}
        >
          <ChevronLeft strokeWidth={iconStroke} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Siguiente"
          disabled={index < 0 || index >= ids.length - 1}
          onClick={() => onSelect(ids[index + 1] ?? '')}
        >
          <ChevronRight strokeWidth={iconStroke} />
        </Button>
      </div>
      <DrawerBody>
        <div data-screen="contacto-preview">
          {!id ? null : contact.loading || contact.data?.id !== id ? (
            <div className="grid gap-3" aria-busy="true">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : contact.error || !contact.data ? (
            <ErrorState
              title={`${copy.error.load} (${contact.error?.code ?? 'WC_ERROR'})`}
              detail={contact.error?.message}
              onRetry={contact.reload}
            />
          ) : (
            <PreviewBody contact={contact.data} />
          )}
        </div>
      </DrawerBody>
    </Drawer>
  )
}

function PreviewBody({ contact }: { contact: Contact }) {
  const navigate = useNavigate()
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!contact.email}
          onClick={() => {
            if (contact.email) window.location.href = `mailto:${contact.email}`
          }}
        >
          <Mail strokeWidth={iconStroke} />
          {copy.contacts.email}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!contact.phone}
          onClick={() => {
            if (contact.phone) window.location.href = `tel:${contact.phone}`
          }}
        >
          <Phone strokeWidth={iconStroke} />
          {copy.contacts.call}
        </Button>
      </div>
      <Button type="button" variant="primary" size="sm" className="w-full" onClick={() => navigate(`/contactos/${contact.id}`)}>
        {copy.contacts.open}
      </Button>
      <dl className="overflow-hidden rounded-2xl border border-border-subtle">
        <Row label="NIF" value={contact.tax_id || '—'} />
        <Row label="País" value={countryLabel(contact.country_code)} />
        <Row label="Población" value={[contact.city, contact.province].filter(Boolean).join(', ') || '—'} />
        <Row label="Correo" value={contact.email || '—'} />
      </dl>
      <div className="flex flex-wrap gap-1.5">
        {roleLabels(contact).map((role) => (
          <Badge key={role} tone="neutral">
            {role}
          </Badge>
        ))}
        {contact.archived_at ? <Badge tone="warning">Archivado</Badge> : null}
      </div>
      <section>
        <h2 className="text-label font-medium text-ink-900">Personas</h2>
        {contact.persons.length === 0 ? (
          <p className="mt-1 text-label text-text-tertiary">Sin personas de contacto.</p>
        ) : (
          <ul className="mt-2 overflow-hidden rounded-2xl border border-border-subtle">
            {contact.persons.map((person) => (
              <li key={person.id} className="border-b border-border-subtle px-3 py-2 last:border-b-0">
                <p className="text-label font-medium text-ink-900">{person.full_name}</p>
                <p className="text-caption text-text-tertiary">{[person.role, person.email].filter(Boolean).join(' · ') || '—'}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-subtle px-3 py-2 last:border-b-0">
      <dt className="text-caption text-text-tertiary">{label}</dt>
      <dd className="min-w-0 text-right text-label break-words text-ink-900">{value}</dd>
    </div>
  )
}
