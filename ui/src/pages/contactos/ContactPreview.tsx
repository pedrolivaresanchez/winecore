import { Link, useNavigate } from 'react-router-dom'
import { Building, ChevronLeft, ChevronRight, Expand, Mail, Phone, User, X } from '@/ui/icons'
import { ObjectGlyph } from '@/ui/object-glyph'
import { Badge, Button, Drawer, Skeleton, SkeletonRows } from '@/ui'
import { StatTile } from '@/ui/charts'
import { ErrorState } from '@/components/ErrorState'
import { useApi } from '@/hooks/use-api'
import { copy, fill } from '@/i18n'
import { countryLabel, roleLabels, type Contact } from '@/lib/contacts'
import { formatMoney } from '@/lib/format'
import { iconStroke } from '@/lib/motion'
import { amount, overviewPath, type ContactOverview } from '@/pages/contactos/overview'
import { BarButton, Fact, Facts, InvoiceRow, RowList } from '@/pages/contactos/record-ui'

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
  const contact = useApi<Contact>(id ? `/v1/contacts/${id}` : null)
  const overview = useApi<ContactOverview>(id ? overviewPath(id) : null)
  const ready = Boolean(id && contact.data && contact.data.id === id && !contact.loading)
  const close = () => onOpenChange(false)

  return (
    <Drawer open={Boolean(id)} onClose={close} labelledBy="preview-title" size="md">
      <header className="scrollbar-none flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border-subtle px-2">
        <BarButton label={copy.contactRecord.close} onClick={close}>
          <X className="size-3.5" strokeWidth={2} />
        </BarButton>
        <BarButton label={copy.contactRecord.previous} disabled={index <= 0} onClick={() => onSelect(ids[index - 1] ?? '')}>
          <ChevronLeft className="size-3.5" strokeWidth={2} />
        </BarButton>
        <BarButton
          label={copy.contactRecord.next}
          disabled={index < 0 || index >= ids.length - 1}
          onClick={() => onSelect(ids[index + 1] ?? '')}
        >
          <ChevronRight className="size-3.5" strokeWidth={2} />
        </BarButton>
        {index >= 0 && ids.length > 1 ? (
          <span className="shrink-0 px-1.5 text-caption tabular-nums text-text-tertiary">
            {fill(copy.contactRecord.position, { index: String(index + 1), total: String(ids.length) })}
          </span>
        ) : null}
      </header>
      <div data-screen="contacto-preview" className="min-h-0 flex-1 overflow-y-auto">
        {!id ? null : !ready && !contact.error ? (
          <PreviewSkeleton />
        ) : contact.error || !contact.data ? (
          <div className="p-4">
            <ErrorState
              title={`${copy.error.load} (${contact.error?.code ?? 'WC_ERROR'})`}
              detail={contact.error?.message}
              onRetry={contact.reload}
            />
          </div>
        ) : (
          <PreviewBody contact={contact.data} overview={overview.data?.contact_id === id ? overview.data : null} loadingOverview={overview.loading} />
        )}
      </div>
    </Drawer>
  )
}

function PreviewBody({
  contact,
  overview,
  loadingOverview,
}: {
  contact: Contact
  overview: ContactOverview | null
  loadingOverview: boolean
}) {
  const navigate = useNavigate()
  const place = [contact.city, contact.province].filter(Boolean).join(', ')
  const address = contact.addresses.find((item) => item.is_default) ?? contact.addresses[0] ?? null
  const invoices = overview?.invoices ?? null
  const receivables = overview?.receivables ?? null
  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div className="flex flex-col gap-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <ObjectGlyph icon={contact.kind === 'person' ? User : Building} tint={contact.kind === 'person' ? 'violet' : 'info'} size="md" className="mt-px" />
          <div className="min-w-0">
            <h2 id="preview-title" className="line-clamp-2 text-body font-medium break-words text-ink-900">
              <Link to={`/contactos/${contact.id}`} className="rounded-sm outline-none hover:underline focus-visible:shadow-(--shadow-focus)">
                {contact.legal_name}
              </Link>
            </h2>
            {contact.trade_name ? <p className="truncate text-label text-text-secondary">{contact.trade_name}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {roleLabels(contact).map((role) => (
            <Badge key={role} size="sm" tone="neutral">
              {role}
            </Badge>
          ))}
          {contact.archived_at ? (
            <Badge size="sm" tone="warning">
              {copy.contactRecord.archived}
            </Badge>
          ) : null}
          {contact.tax_id_warning ? (
            <Badge size="sm" tone="warning">
              {contact.tax_id_warning}
            </Badge>
          ) : null}
        </div>
        <p className="text-label text-text-secondary">
          {[contact.tax_id || copy.contacts.noTax, place || null, countryLabel(contact.country_code)].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" size="sm" onClick={() => navigate(`/contactos/${contact.id}`)}>
          <Expand strokeWidth={iconStroke} />
          {copy.contacts.open}
        </Button>
        {contact.email ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              window.location.href = `mailto:${contact.email}`
            }}
          >
            <Mail strokeWidth={iconStroke} />
            {copy.contacts.email}
          </Button>
        ) : null}
        {contact.phone ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              window.location.href = `tel:${contact.phone}`
            }}
          >
            <Phone strokeWidth={iconStroke} />
            {copy.contacts.call}
          </Button>
        ) : null}
      </div>

      <Facts className="border-t border-border-subtle pt-3">
        <Fact label={copy.contactRecord.email}>
          <span className="block truncate" title={contact.email ?? undefined}>
            {contact.email || '—'}
          </span>
        </Fact>
        <Fact label={copy.contactRecord.phone}>{contact.phone || '—'}</Fact>
        {address ? (
          <Fact label={copy.contactRecord.address}>
            {[address.line1, [address.postal_code, address.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
          </Fact>
        ) : null}
      </Facts>

      {loadingOverview && !overview ? (
        <div className="grid gap-2 border-t border-border-subtle pt-3" aria-busy="true">
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-16 rounded-[10px]" />
            <Skeleton className="h-16 rounded-[10px]" />
          </div>
          <SkeletonRows rows={3} />
        </div>
      ) : invoices || receivables ? (
        <div className="flex flex-col gap-3 border-t border-border-subtle pt-3">
          <div className="grid grid-cols-2 gap-2">
            {invoices && overview ? (
              <StatTile
                label={fill(copy.contactRecord.invoicedYear, { year: String(overview.year) })}
                value={amount(invoices.kpis.invoiced_ytd)}
                type="currency"
                formatted={formatMoney(amount(invoices.kpis.invoiced_ytd))}
              />
            ) : null}
            {receivables ? (
              <StatTile
                label={copy.contactRecord.pending}
                value={amount(receivables.total)}
                type="currency"
                formatted={formatMoney(amount(receivables.total))}
                hint={
                  amount(receivables.overdue) > 0 ? (
                    <span className="text-danger-600">{fill(copy.contactRecord.overdue, { amount: formatMoney(amount(receivables.overdue)) })}</span>
                  ) : undefined
                }
              />
            ) : null}
          </div>
          {invoices && invoices.items.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-caption font-medium text-text-secondary">{copy.contactRecord.recentInvoices}</h3>
              <RowList>
                {invoices.items.slice(0, 3).map((invoice) => (
                  <InvoiceRow key={`${invoice.source}-${invoice.id}`} invoice={invoice} />
                ))}
              </RowList>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function PreviewSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 py-4" aria-busy="true">
      <div className="flex items-center gap-2">
        <Skeleton className="size-5 rounded-xs" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <Skeleton className="h-5 w-1/2" />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-20" />
      </div>
      <SkeletonRows rows={4} meta={false} />
    </div>
  )
}
