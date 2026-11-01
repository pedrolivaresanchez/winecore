import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Building,
  ChartColumn,
  CreditCard,
  FileText,
  History,
  MoreVertical,
  Pencil,
  Plus,
  Receipt,
  User,
  Users,
} from '@/ui/icons'
import { ObjectGlyph } from '@/ui/object-glyph'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { Badge, Button, GlassMenu, MenuItem, Skeleton, SkeletonRows, useMenuOpen, useToast } from '@/ui'
import { useApi } from '@/hooks/use-api'
import { useMinWidth } from '@/hooks/use-media'
import { copy, fill } from '@/i18n'
import { ApiError } from '@/lib/api'
import {
  archiveContact,
  cleanInput,
  countryLabel,
  inputFromContact,
  isStale,
  paymentLabel,
  roleLabels,
  unarchiveContact,
  updateContact,
  vatLabel,
  type AuditPage,
  type Contact,
  type ContactInput,
} from '@/lib/contacts'
import { allows } from '@/lib/permissions'
import { normalizeTaxId } from '@/lib/tax-id'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import type { Me } from '@/lib/types'
import { validateContact } from '@/lib/contact-validate'
import { ContactForm } from '@/pages/contactos/ContactForm'
import { ActivityTab, CollectionsTab, InvoicesTab, SalesTab, SummaryTab, type OverviewState } from '@/pages/contactos/ContactTabs'
import { overviewPath, type ContactOverview } from '@/pages/contactos/overview'
import { parseDocKey } from '@/pages/documents/doc-key'
import { DocumentModal } from '@/pages/documents/DocumentModal'
import { useDocParam } from '@/pages/documents/use-doc-param'
import { BarButton, Fact, Facts, FoldCard, RECORD_CARD, TabStrip, type RecordTab } from '@/pages/contactos/record-ui'
import { AddressBook, PersonBook } from '@/pages/contactos/Related'

type Draft = { value: ContactInput; base: string; saved: boolean }

const TAB_IDS = ['resumen', 'facturas', 'cobros', 'ventas', 'actividad', 'datos'] as const

type TabId = (typeof TAB_IDS)[number]

function isTab(value: string | null): value is TabId {
  return (TAB_IDS as readonly (string | null)[]).includes(value)
}

export function ContactPage({ me }: { me: Me }) {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab: TabId = isTab(requested) ? requested : 'resumen'
  const readable = allows(me, 'contacts.read')
  const contact = useApi<Contact>(id && readable ? `/v1/contacts/${id}` : null)
  const overview = useApi<ContactOverview>(id && readable ? overviewPath(id) : null)
  const canAudit = allows(me, 'audit.read')
  const audit = useApi<AuditPage>(tab === 'actividad' && canAudit && id ? `/v1/audit?table=party.contact&row_id=${id}` : null)
  useChromeTitle(contact.data?.legal_name || 'Contacto')

  function setTab(next: TabId) {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        if (next === 'resumen') updated.delete('tab')
        else updated.set('tab', next)
        return updated
      },
      { replace: true },
    )
  }

  if (!readable) return <NoPermission />
  const current = contact.data && contact.data.id.toLowerCase() === id.toLowerCase() ? contact.data : null
  if (!current) {
    if (contact.error) {
      return (
        <div className="p-6">
          <ErrorState
            title={`${copy.error.load} (${contact.error.code})`}
            detail={contact.error.message}
            onRetry={contact.reload}
          />
        </div>
      )
    }
    return <ContactSkeleton />
  }

  return (
    <Loaded
      key={current.id}
      me={me}
      contact={current}
      tab={tab}
      onTab={setTab}
      onReload={() => {
        contact.reload()
        overview.reload()
      }}
      overview={overview}
      audit={canAudit ? { items: audit.data?.items ?? [], loading: audit.loading, error: audit.error, reload: audit.reload } : null}
    />
  )
}

function Loaded({
  me,
  contact,
  tab,
  onTab,
  onReload,
  overview,
  audit,
}: {
  me: Me
  contact: Contact
  tab: TabId
  onTab: (tab: TabId) => void
  onReload: () => void
  overview: OverviewState
  audit: Parameters<typeof ActivityTab>[0]['audit']
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const more = useMenuOpen()
  const wide = useMinWidth(768)
  const canWrite = allows(me, 'contacts.write')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const pendingFocus = useRef<string | null>(null)
  const docs = useDocParam()
  const opened = parseDocKey(docs.id)
  const active = draft && !(draft.saved && draft.base !== contact.updated_at) ? draft : null
  const value = active?.value ?? inputFromContact(contact)
  const editing = Boolean(active && !active.saved)

  useEffect(() => {
    if (tab !== 'datos' || !pendingFocus.current) return
    document.getElementById(pendingFocus.current)?.focus()
    pendingFocus.current = null
  }, [tab])
  const archived = Boolean(contact.archived_at)
  const customer = contact.is_customer && !archived
  const forCustomer = `?${new URLSearchParams({ cliente: contact.id })}`
  const newInvoice = customer && allows(me, 'billing.write') ? () => navigate(`/facturas/nueva${forCustomer}`) : null
  const newQuote = customer && allows(me, 'sales.write') ? () => navigate(`/ventas/presupuestos/nuevo${forCustomer}`) : null
  const data = overview.data

  const tabs: RecordTab<TabId>[] = [
    { id: 'resumen', label: copy.contactRecord.summary, icon: ChartColumn },
    { id: 'facturas', label: copy.contactRecord.invoices, icon: Receipt, count: data?.invoices?.total_count },
    { id: 'cobros', label: copy.contactRecord.collections, icon: CreditCard, count: data?.receivables?.count },
    {
      id: 'ventas',
      label: copy.contactRecord.sales,
      icon: FileText,
      count: data?.sales ? data.sales.quotes.length + data.sales.orders.length + data.sales.delivery_notes.length : null,
    },
    { id: 'actividad', label: copy.contactRecord.activity, icon: History },
    { id: 'datos', label: copy.contactRecord.details, icon: Users },
  ]

  function focusField(id: string) {
    if (tab === 'datos') {
      document.getElementById(id)?.focus()
      return
    }
    pendingFocus.current = id
    onTab('datos')
  }

  function change(next: ContactInput) {
    setDraft({ value: next, base: contact.updated_at, saved: false })
  }

  function cancelEdit() {
    setDraft(null)
    setErrors({})
    setStale(false)
  }

  async function save() {
    const next = { ...value, tax_id: value.tax_id ? normalizeTaxId(value.tax_id) : '' }
    change(next)
    const found = validateContact(next)
    setErrors(found)
    const firstField = Object.keys(found)[0]
    if (firstField) {
      focusField(firstField)
      return
    }
    setSaving(true)
    setStale(false)
    try {
      await updateContact(contact.id, cleanInput(next), contact.updated_at)
      toast(copy.contactRecord.saved)
      setDraft({ value: next, base: contact.updated_at, saved: true })
      onReload()
    } catch (error: unknown) {
      if (isStale(error)) setStale(true)
      else if (error instanceof ApiError && error.fields) setErrors(error.fields)
      else toast(error instanceof ApiError ? error.message : copy.contactRecord.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  async function toggleArchive() {
    setSaving(true)
    try {
      if (archived) await unarchiveContact(contact.id)
      else await archiveContact(contact.id)
      setConfirmArchive(false)
      onReload()
    } catch {
      toast(copy.contactRecord.archiveFailed)
    } finally {
      setSaving(false)
    }
  }

  const menuItems = [
    newInvoice && !wide ? (
      <MenuItem
        key="invoice"
        onClick={() => {
          more.close()
          newInvoice()
        }}
      >
        {copy.contactRecord.newInvoice}
      </MenuItem>
    ) : null,
    newQuote && !wide ? (
      <MenuItem
        key="quote"
        onClick={() => {
          more.close()
          newQuote()
        }}
      >
        {copy.contactRecord.newQuote}
      </MenuItem>
    ) : null,
    canWrite ? (
      <MenuItem
        key="archive"
        tone={archived ? 'default' : 'danger'}
        onClick={() => {
          more.close()
          setConfirmArchive(true)
        }}
      >
        {archived ? copy.contacts.unarchive : copy.contacts.archive}
      </MenuItem>
    ) : null,
  ].filter(Boolean)

  return (
    <div data-screen="ficha" data-tab={tab} className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-canvas">
      <header className="scrollbar-none flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border-subtle px-2">
        <BarButton label={copy.contactRecord.back} onClick={() => navigate('/contactos')}>
          <ArrowLeft className="size-3.5" strokeWidth={2} />
        </BarButton>
        <Link
          to="/contactos"
          className="ml-0.5 shrink-0 rounded-md px-1.5 py-1 text-caption text-text-tertiary outline-none transition-colors hover:bg-fill-hover hover:text-ink-900 focus-visible:shadow-(--shadow-focus)"
        >
          {copy.contactRecord.back}
        </Link>
        <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border-subtle max-sm:hidden" />
        <span className="min-w-0 flex-1 truncate px-1.5 text-label font-medium text-ink-900 max-sm:invisible">{contact.legal_name}</span>
        <div className="ml-2 flex shrink-0 items-center gap-1.5">
          {editing ? (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={cancelEdit} disabled={saving}>
                {copy.contactRecord.cancel}
              </Button>
              <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void save()}>
                {saving ? copy.contactRecord.saving : copy.contacts.save}
              </Button>
            </>
          ) : (
            <>
              {newInvoice && wide ? (
                <Button type="button" variant="primary" size="sm" onClick={newInvoice}>
                  <Plus strokeWidth={iconStroke} />
                  {copy.contactRecord.newInvoice}
                </Button>
              ) : null}
              {newQuote && wide ? (
                <Button type="button" variant="secondary" size="sm" onClick={newQuote}>
                  {copy.contactRecord.newQuote}
                </Button>
              ) : null}
              {canWrite ? (
                <Button type="button" variant={newInvoice && wide ? 'secondary' : 'primary'} size="sm" onClick={() => focusField('legal_name')}>
                  <Pencil strokeWidth={iconStroke} />
                  {copy.contactRecord.edit}
                </Button>
              ) : null}
            </>
          )}
          {menuItems.length > 0 ? (
            <GlassMenu
              open={more.open}
              onOpenChange={more.setOpen}
              placement="bottom-end"
              trigger={
                <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.contactRecord.more} aria-expanded={more.open} onClick={more.toggle}>
                  <MoreVertical strokeWidth={iconStroke} />
                </Button>
              }
            >
              {menuItems}
            </GlassMenu>
          ) : null}
        </div>
      </header>

      {stale ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-danger-50 px-4 py-2.5 text-label text-danger-700">
          <p className="min-w-0 flex-1">{copy.contacts.stale}</p>
          <Button type="button" variant="secondary" size="sm" onClick={onReload}>
            {copy.contacts.reload}
          </Button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 @[52rem]:flex-row @[52rem]:overflow-hidden">
        <aside className="flex shrink-0 flex-col gap-3 @[52rem]:w-72 @[52rem]:overflow-y-auto">
          <IdentityCard contact={contact} />
          <FoldCard title={copy.contactRecord.terms} defaultOpen={wide}>
            <Facts>
              <Fact label={copy.contactRecord.language}>{contact.language === 'en' ? 'Inglés' : 'Español'}</Fact>
              <Fact label={copy.contactRecord.vat}>{vatLabel(contact.vat_regime)}</Fact>
              <Fact label={copy.contactRecord.payment}>{paymentLabel(contact.payment_method)}</Fact>
              <Fact label={copy.contactRecord.termsDays}>{fill(copy.contactRecord.daysValue, { days: String(contact.payment_terms_days) })}</Fact>
              {contact.excise_number ? <Fact label={copy.contactRecord.excise}>{contact.excise_number}</Fact> : null}
              {contact.eori ? <Fact label={copy.contactRecord.eori}>{contact.eori}</Fact> : null}
              {contact.notes ? <Fact label={copy.contactRecord.notes}>{contact.notes}</Fact> : null}
            </Facts>
          </FoldCard>
          <FoldCard title={copy.contactRecord.people} count={contact.persons.length} defaultOpen={wide && contact.persons.length > 0}>
            {contact.persons.length === 0 ? (
              <button
                type="button"
                onClick={() => onTab('datos')}
                className="rounded-md px-1 text-left text-label text-text-tertiary outline-none hover:text-ink-900 focus-visible:shadow-(--shadow-focus)"
              >
                {copy.contactRecord.details} →
              </button>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {contact.persons.map((person) => (
                  <li key={person.id} className="min-w-0">
                    <p className="truncate text-label text-ink-900">{person.full_name}</p>
                    <p className="truncate text-caption text-text-tertiary">{[person.role, person.email, person.phone].filter(Boolean).join(' · ') || '—'}</p>
                  </li>
                ))}
              </ul>
            )}
          </FoldCard>
        </aside>

        <section className={cn(RECORD_CARD, 'flex min-w-0 flex-1 flex-col @[52rem]:min-h-0 @[52rem]:overflow-hidden')}>
          <TabStrip tabs={tabs} active={tab} onChange={onTab} label={copy.contactRecord.summary} idPrefix="ficha" />
          <div
            id="ficha-panel"
            role="tabpanel"
            aria-labelledby={`ficha-tab-${tab}`}
            className="min-w-0 p-3 sm:p-4 @[52rem]:min-h-0 @[52rem]:flex-1 @[52rem]:overflow-y-auto"
          >
            {tab === 'resumen' ? <SummaryTab overview={overview} onTab={onTab} /> : null}
            {tab === 'facturas' ? <InvoicesTab overview={overview} contactId={contact.id} newInvoice={newInvoice} /> : null}
            {tab === 'cobros' ? <CollectionsTab overview={overview} /> : null}
            {tab === 'ventas' ? <SalesTab overview={overview} newQuote={newQuote} /> : null}
            {tab === 'actividad' ? <ActivityTab overview={overview} audit={audit} /> : null}
            {tab === 'datos' ? (
              <div className="flex flex-col gap-6">
                {canWrite ? (
                  <form
                    id="contacto-editar"
                    noValidate
                    onSubmit={(event) => {
                      event.preventDefault()
                      void save()
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape' && editing && !saving) {
                        event.stopPropagation()
                        cancelEdit()
                      }
                    }}
                  >
                    <ContactForm value={value} onChange={change} errors={errors} disabled={saving} extra split />
                  </form>
                ) : null}
                <div className="grid items-start gap-6 lg:grid-cols-2">
                  <section className="flex min-w-0 flex-col gap-2">
                    <h3 className="text-label font-medium text-ink-900">{copy.contactRecord.addresses}</h3>
                    <AddressBook contactId={contact.id} addresses={contact.addresses} canWrite={canWrite} onChanged={onReload} />
                  </section>
                  <section className="flex min-w-0 flex-col gap-2">
                    <h3 className="text-label font-medium text-ink-900">{copy.contactRecord.people}</h3>
                    <PersonBook contactId={contact.id} persons={contact.persons} canWrite={canWrite} onChanged={onReload} />
                  </section>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirmArchive}
        title={archived ? copy.contactRecord.unarchiveTitle : copy.contactRecord.archiveTitle}
        body={archived ? copy.contactRecord.unarchiveBody : fill(copy.contactRecord.archiveBody, { name: contact.legal_name })}
        confirmLabel={archived ? copy.contacts.unarchive : copy.contacts.archive}
        danger={!archived}
        busy={saving}
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => void toggleArchive()}
      />
      {opened ? <DocumentModal me={me} source={opened.source} id={opened.id} onClose={docs.close} onChanged={overview.reload} /> : null}
    </div>
  )
}

function IdentityCard({ contact }: { contact: Contact }) {
  const person = contact.kind === 'person'
  const place = [contact.city, contact.province].filter(Boolean).join(', ')
  const address = contact.addresses.find((item) => item.is_default) ?? contact.addresses[0] ?? null
  const link = 'text-info-600 underline underline-offset-2 outline-none focus-visible:shadow-(--shadow-focus) rounded-sm'
  return (
    <section className={cn(RECORD_CARD, 'flex flex-col gap-2.5 px-3 py-2.5')}>
      <div className="flex min-w-0 items-start gap-2">
        <ObjectGlyph icon={person ? User : Building} tint={person ? 'violet' : 'info'} size="md" className="mt-px" />
        <div className="min-w-0">
          <h1 className="line-clamp-2 text-body font-medium break-words text-ink-900">{contact.legal_name}</h1>
          <p className="truncate text-label text-text-secondary">
            {contact.trade_name || (person ? copy.contactRecord.person : copy.contactRecord.company)}
          </p>
        </div>
      </div>
      {roleLabels(contact).length > 0 || contact.archived_at || contact.tax_id_warning ? (
        <div className="flex flex-wrap gap-1.5">
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
      ) : null}
      <Facts>
        <Fact label={copy.contactRecord.taxId}>{contact.tax_id || copy.contacts.noTax}</Fact>
        <Fact label={copy.contactRecord.country}>{countryLabel(contact.country_code)}</Fact>
        <Fact label={copy.contactRecord.city}>{place || '—'}</Fact>
        {address ? (
          <Fact label={copy.contactRecord.address}>
            {[address.line1, [address.postal_code, address.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
          </Fact>
        ) : null}
        <Fact label={copy.contactRecord.email}>
          {contact.email ? (
            <a href={`mailto:${contact.email}`} title={contact.email} className={cn(link, 'block truncate')}>
              {contact.email}
            </a>
          ) : (
            '—'
          )}
        </Fact>
        <Fact label={copy.contactRecord.phone}>
          {contact.phone ? (
            <a href={`tel:${contact.phone}`} className={cn(link, 'tabular-nums')}>
              {contact.phone}
            </a>
          ) : (
            '—'
          )}
        </Fact>
      </Facts>
    </section>
  )
}

function ContactSkeleton() {
  return (
    <div aria-busy="true" className="flex min-h-0 flex-1 flex-col bg-canvas">
      <p className="sr-only">{copy.loading}</p>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-2">
        <Skeleton className="size-7 rounded-md" />
        <Skeleton className="h-3.5 w-40" />
      </div>
      <div className="flex flex-col gap-3 p-3 md:flex-row">
        <div className="flex flex-col gap-3 md:w-72">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
        <div className={cn(RECORD_CARD, 'flex min-w-0 flex-1 flex-col gap-4 p-4')}>
          <Skeleton className="h-6 w-80 max-w-full" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 @[84rem]:grid-cols-6">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className={cn('h-20 rounded-[10px]', index === 0 && 'col-span-2')} />
            ))}
          </div>
          <SkeletonRows rows={4} />
        </div>
      </div>
    </div>
  )
}
