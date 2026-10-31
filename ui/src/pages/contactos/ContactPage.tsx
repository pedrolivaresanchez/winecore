import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, MoreVertical } from '@/ui/icons'
import { useChromeTitle } from '@/app/shell/shell-context'
import { AuditTrail } from '@/components/AuditTrail'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { Badge, Button, GlassMenu, MenuItem, useMenuOpen, useToast } from '@/ui'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
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
import { AddressBook, PersonBook } from '@/pages/contactos/Related'
import { RecordSkeleton } from '@/components/RecordSkeleton'

const TABS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'direcciones', label: 'Direcciones' },
  { id: 'personas', label: 'Personas' },
  { id: 'historial', label: 'Historial' },
] as const

type TabId = (typeof TABS)[number]['id']

export function ContactPage({ me }: { me: Me }) {
  const { id = '' } = useParams()
  const contact = useApi<Contact>(id ? `/v1/contacts/${id}?include=addresses,persons` : null)
  const [tab, setTab] = useState<TabId>('resumen')
  const history = useApi<{ items: import('@/lib/contacts').AuditEvent[]; next_cursor: string | null }>(
    tab === 'historial' && id ? `/v1/audit?table=party.contact&row_id=${id}` : null,
  )
  useChromeTitle(contact.data?.legal_name || 'Contacto')

  if (!allows(me, 'contacts.read')) return <NoPermission />
  if (contact.loading && !contact.data) {
    return <RecordSkeleton />
  }
  if (contact.error || !contact.data) {
    return (
      <div className="p-6">
        <ErrorState
          title={`${copy.error.load} (${contact.error?.code ?? 'WC_ERROR'})`}
          detail={contact.error?.message}
          onRetry={contact.reload}
        />
      </div>
    )
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
  )
}

function Loaded({
  me,
  contact,
  tab,
  onTab,
  onReload,
  history,
}: {
  me: Me
  contact: Contact
  tab: TabId
  onTab: (tab: TabId) => void
  onReload: () => void
  history: ReturnType<typeof useApi<{ items: import('@/lib/contacts').AuditEvent[]; next_cursor: string | null }>>
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const more = useMenuOpen()
  const canWrite = allows(me, 'contacts.write')
  const [value, setValue] = useState<ContactInput>(() => inputFromContact(contact))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [editing, setEditing] = useState(false)
  const archived = Boolean(contact.archived_at)

  function cancelEdit() {
    setValue(inputFromContact(contact))
    setErrors({})
    setStale(false)
    setEditing(false)
  }

  async function save() {
    const next = { ...value, tax_id: value.tax_id ? normalizeTaxId(value.tax_id) : '' }
    setValue(next)
    const found = validateContact(next)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSaving(true)
    setStale(false)
    try {
      await updateContact(contact.id, cleanInput(next), contact.updated_at)
      toast('Cambios guardados')
      setEditing(false)
      onReload()
    } catch (error: unknown) {
      if (isStale(error)) setStale(true)
      else if (error instanceof ApiError && error.fields) setErrors(error.fields)
      else toast(error instanceof ApiError ? error.message : 'No se ha podido guardar.')
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
      toast('No se ha podido cambiar el archivo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-screen="ficha" data-tab={tab} className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 sm:px-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Contactos"
          onClick={() => navigate('/contactos')}
        >
          <ArrowLeft strokeWidth={iconStroke} />
        </Button>
        <span className="min-w-0 truncate text-label text-text-tertiary">Contactos</span>
        {canWrite ? (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {editing ? (
              <>
                <Button type="submit" form="contacto-editar" variant="primary" size="sm" loading={saving} disabled={tab !== 'resumen'}>
                  {saving ? 'Guardando…' : copy.contacts.save}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={cancelEdit} disabled={saving}>
                  Cancelar
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => {
                  setEditing(true)
                  onTab('resumen')
                }}
              >
                Editar
              </Button>
            )}
            <GlassMenu
              open={more.open}
              onOpenChange={more.setOpen}
              placement="bottom-end"
              trigger={
                <Button type="button" variant="secondary" size="sm" iconOnly aria-label="Más acciones" onClick={more.toggle}>
                  <MoreVertical strokeWidth={iconStroke} />
                </Button>
              }
            >
              <MenuItem
                tone={archived ? 'default' : 'danger'}
                onClick={() => {
                  more.close()
                  setConfirmArchive(true)
                }}
              >
                {archived ? copy.contacts.unarchive : copy.contacts.archive}
              </MenuItem>
            </GlassMenu>
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-8">
          <header>
            <h1 className="text-body font-medium break-words text-ink-900">{contact.legal_name}</h1>
            <p className="mt-0.5 text-label text-text-secondary">
              {contact.trade_name || roleLabels(contact).join(' · ') || 'Contacto'}
            </p>
          </header>
          <div className="flex flex-wrap gap-1.5">
            {roleLabels(contact).map((role) => (
              <Badge key={role} tone="neutral">
                {role}
              </Badge>
            ))}
            {archived ? <Badge tone="warning">Archivado</Badge> : null}
            {contact.tax_id_warning ? <Badge tone="warning">{contact.tax_id_warning}</Badge> : null}
          </div>
          {stale ? (
            <div role="alert" className="rounded-2xl bg-danger-50 px-4 py-3 text-label text-danger-700">
              <p>{copy.contacts.stale}</p>
              <Button type="button" variant="primary" size="sm" className="mt-3" onClick={onReload}>
                {copy.contacts.reload}
              </Button>
            </div>
          ) : null}
          <div role="tablist" aria-label="Secciones" className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto border-b border-border-subtle px-4">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={cn(
                  'h-8 shrink-0 border-b-2 px-2 text-label',
                  tab === item.id ? 'border-ink-900 font-medium text-ink-900' : 'border-transparent text-text-tertiary',
                )}
                onClick={() => onTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {tab === 'resumen' && !editing ? <ContactOverview contact={contact} /> : null}
          {editing ? (
            <form
              id="contacto-editar"
              className={tab === 'resumen' ? 'block' : 'hidden'}
              onSubmit={(event) => {
                event.preventDefault()
                void save()
              }}
            >
              <ContactForm value={value} onChange={setValue} errors={errors} disabled={saving} extra split />
            </form>
          ) : null}
          {tab === 'direcciones' ? (
            <AddressBook contactId={contact.id} addresses={contact.addresses} canWrite={canWrite} onChanged={onReload} />
          ) : null}
          {tab === 'personas' ? (
            <PersonBook contactId={contact.id} persons={contact.persons} canWrite={canWrite} onChanged={onReload} />
          ) : null}
          {tab === 'historial' ? (
            <AuditTrail
              items={history.data?.items ?? []}
              loading={history.loading}
              error={history.error ? `${copy.error.load} (${history.error.code})` : undefined}
              onRetry={history.reload}
            />
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={confirmArchive}
        title={archived ? 'Reactivar contacto' : 'Archivar contacto'}
        body={
          archived ? 'Volverá a salir en las listas.' : `Se archivará ${contact.legal_name}. Dejará de salir en las listas.`
        }
        confirmLabel={archived ? copy.contacts.unarchive : copy.contacts.archive}
        danger={!archived}
        busy={saving}
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => void toggleArchive()}
      />
    </div>
  )
}

function ContactOverview({ contact }: { contact: Contact }) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
        <h2 className="border-b border-border-subtle px-4 py-2 text-caption text-text-tertiary">Datos fiscales</h2>
        <Fact label="Tipo" value={contact.kind === 'person' ? 'Persona' : 'Empresa'} />
        <Fact label="Nombre fiscal" value={contact.legal_name} />
        <Fact label="Nombre comercial" value={contact.trade_name || '—'} />
        <Fact label="NIF" value={contact.tax_id || '—'} />
        <Fact label="País" value={countryLabel(contact.country_code)} />
        <Fact label="Correo" value={contact.email || '—'} />
        <Fact label="Teléfono" value={contact.phone || '—'} />
        <Fact label="Papel" value={roleLabels(contact).join(', ') || '—'} />
      </section>
      <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
        <h2 className="border-b border-border-subtle px-4 py-2 text-caption text-text-tertiary">Condiciones y notas</h2>
        <Fact label="Idioma" value={contact.language === 'en' ? 'Inglés' : 'Español'} />
        <Fact label="Régimen de IVA" value={vatLabel(contact.vat_regime)} />
        <Fact label="Forma de pago" value={paymentLabel(contact.payment_method)} />
        <Fact label="Días de pago" value={String(contact.payment_terms_days)} />
        <Fact label="CAE" value={contact.excise_number || '—'} />
        <Fact label="EORI" value={contact.eori || '—'} />
        <Fact label="Notas" value={contact.notes || '—'} />
      </section>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 border-b border-border-subtle px-4 py-2 last:border-b-0">
      <dt className="text-caption text-text-tertiary">{label}</dt>
      <dd className="text-label break-words text-ink-900">{value}</dd>
    </div>
  )
}
