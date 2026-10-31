import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ArrowLeft, MoreVertical } from '@/ui/icons'
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  GlassMenu,
  Input,
  MenuItem,
  Skeleton,
  StatusChip,
  Textarea,
  useMenuOpen,
  useToast,
} from '@/ui'
import { Field } from '@/components/Field'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { useMinWidth } from '@/hooks/use-media'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { createContact, duplicateContact, listContacts } from '@/lib/contacts'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { allows } from '@/lib/permissions'
import { formatDate } from '@/lib/format'
import type { Me } from '@/lib/types'
import { approveExpense, patchExpense, rejectExpense, validateExpense } from '@/pages/gastos/api'
import { categoryLabel, statusLabel, statusTone } from '@/pages/gastos/catalog'
import { DocumentView } from '@/pages/gastos/DocumentView'
import { ExpenseForm } from '@/pages/gastos/ExpenseForm'
import { draftFrom, totalsDrift, type Expense, type ExpenseDraft, type SupplierOption } from '@/pages/gastos/types'

type TabId = 'datos' | 'documento'

export function ExpenseReview({ me, id }: { me: Me; id: string }) {
  const expense = useApi<Expense>(id ? `/v1/supplier-invoices/${id}` : null)
  useChromeTitle(expense.data?.supplier_name || copy.gastos.title)
  if (!allows(me, 'purchasing.read')) return <NoPermission />
  if (expense.loading && !expense.data) {
    return (
      <div aria-busy="true" className="grid gap-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (expense.error || !expense.data) {
    return (
      <div className="p-6">
        <ErrorState
          title={`${copy.error.load} (${expense.error?.code ?? 'WC_ERROR'})`}
          detail={expense.error?.message}
          onRetry={expense.reload}
        />
      </div>
    )
  }
  return <Loaded me={me} expense={expense.data} onReload={expense.reload} />
}

function Loaded({ me, expense, onReload }: { me: Me; expense: Expense; onReload: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const more = useMenuOpen()
  const desktop = useMinWidth(1024)
  const wideActions = useMinWidth(640)
  const canWrite = allows(me, 'purchasing.write')
  const canApprove = allows(me, 'purchasing.approve')
  const canCreateSupplier = allows(me, 'contacts.write')
  const [tab, setTab] = useState<TabId>('datos')
  const [draft, setDraft] = useState<ExpenseDraft>(() => draftFrom(expense))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)
  const [acting, setActing] = useState<'validate' | 'approve' | 'reject' | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [supplierOpen, setSupplierOpen] = useState(false)
  const [supplierName, setSupplierName] = useState(expense.supplier_name ?? '')
  const [supplierTax, setSupplierTax] = useState(expense.supplier_tax_id ?? '')
  const [creating, setCreating] = useState(false)
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])

  useEffect(() => {
    setDraft(draftFrom(expense))
    setStale(false)
  }, [expense])

  useEffect(() => {
    const controller = new AbortController()
    listContacts({ role: 'supplier', limit: 100 }, controller.signal)
      .then((page) =>
        setSuppliers(page.items.map((item) => ({ id: item.id, legal_name: item.legal_name, tax_id: item.tax_id }))),
      )
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  const options = useMemo(() => {
    if (!draft.supplier_id || suppliers.some((item) => item.id === draft.supplier_id)) return suppliers
    return [{ id: draft.supplier_id, legal_name: draft.supplier_name, tax_id: draft.supplier_tax_id || null }, ...suppliers]
  }, [draft.supplier_id, draft.supplier_name, draft.supplier_tax_id, suppliers])

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFrom(expense))
  const editable = canWrite && (expense.status === 'captured' || expense.status === 'validated')
  const duplicate = expense.status === 'duplicate' || Boolean(expense.duplicate_of_id)
  const screen = duplicate ? 'gastos-duplicado' : 'gastos-revision'
  const showDocument = tab === 'documento' || (desktop && tab === 'datos')
  const showForm = tab === 'datos'

  async function persist(): Promise<Expense> {
    return patchExpense(expense.id, draft, expense.updated_at)
  }

  async function save() {
    setSaving(true)
    setErrors({})
    setStale(false)
    try {
      await persist()
      toast(copy.gastos.saved)
      onReload()
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === 'WC_STALE_VERSION') setStale(true)
      else if (error instanceof ApiError && error.fields) setErrors(error.fields)
      else toast(error instanceof ApiError ? error.message : copy.gastos.failed)
    } finally {
      setSaving(false)
    }
  }

  async function validate() {
    setActing('validate')
    setErrors({})
    setStale(false)
    try {
      const current = dirty ? await persist() : expense
      const next = await validateExpense(current.id, current.updated_at)
      toast(next.status === 'duplicate' ? copy.gastos.duplicate : copy.gastos.validated)
      onReload()
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === 'WC_STALE_VERSION') setStale(true)
      else if (error instanceof ApiError && error.fields) setErrors(error.fields)
      else toast(error instanceof ApiError ? error.message : copy.gastos.failed)
    } finally {
      setActing(null)
    }
  }

  async function approve() {
    setActing('approve')
    setStale(false)
    try {
      const next = await approveExpense(expense.id, expense.updated_at)
      toast(next.status === 'duplicate' ? copy.gastos.duplicate : copy.gastos.approved)
      onReload()
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === 'WC_STALE_VERSION') setStale(true)
      else toast(error instanceof ApiError ? error.message : copy.gastos.failed)
    } finally {
      setActing(null)
    }
  }

  async function reject() {
    setActing('reject')
    setStale(false)
    try {
      await rejectExpense(expense.id, expense.updated_at, reason.trim())
      setRejectOpen(false)
      setReason('')
      toast(copy.gastos.rejected)
      onReload()
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === 'WC_STALE_VERSION') {
        setRejectOpen(false)
        setStale(true)
      } else if (error instanceof ApiError && error.fields?.reason) setErrors({ reason: error.fields.reason })
      else toast(error instanceof ApiError ? error.message : copy.gastos.failed)
    } finally {
      setActing(null)
    }
  }

  async function createSupplier() {
    setCreating(true)
    try {
      const created = await createContact(
        {
          kind: 'company',
          legal_name: supplierName.trim(),
          tax_id: supplierTax.trim(),
          country_code: 'ES',
          language: 'es',
          is_customer: false,
          is_supplier: true,
          is_carrier: false,
          is_logistics_operator: false,
          vat_regime: 'general',
          payment_terms_days: 30,
        },
        `prov-${crypto.randomUUID()}`,
      )
      const option = { id: created.id, legal_name: created.legal_name, tax_id: created.tax_id }
      setSuppliers((current) => [option, ...current])
      setDraft((current) => ({
        ...current,
        supplier_id: created.id,
        supplier_name: created.legal_name,
        supplier_tax_id: created.tax_id ?? supplierTax.trim(),
      }))
      setSupplierOpen(false)
    } catch (error: unknown) {
      const existing = duplicateContact(error)
      if (existing) {
        setDraft((current) => ({ ...current, supplier_id: existing.id, supplier_name: existing.name }))
        setSupplierOpen(false)
        return
      }
      toast(error instanceof ApiError ? error.message : copy.gastos.failed)
    } finally {
      setCreating(false)
    }
  }

  const canReject = canWrite && (expense.status === 'captured' || expense.status === 'validated')
  const showValidate = canWrite && expense.status === 'captured' && !dirty
  const showApprove = canApprove && expense.status === 'validated' && !dirty
  const showSave = editable && dirty

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 sm:px-4">
        <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.gastos.title} onClick={() => navigate('/gastos')}>
          <ArrowLeft strokeWidth={iconStroke} />
        </Button>
        <span className="min-w-0 truncate text-label text-text-tertiary">{copy.gastos.title}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {wideActions && canReject ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => setRejectOpen(true)}>
              {copy.gastos.reject}
            </Button>
          ) : null}
          {showSave ? (
            <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void save()}>
              {copy.gastos.save}
            </Button>
          ) : null}
          {showValidate ? (
            <Button type="button" variant="primary" size="sm" loading={acting === 'validate'} onClick={() => void validate()}>
              {copy.gastos.validate}
            </Button>
          ) : null}
          {showApprove ? (
            <Button type="button" variant="primary" size="sm" loading={acting === 'approve'} onClick={() => void approve()}>
              {copy.gastos.approve}
            </Button>
          ) : null}
          {!wideActions && canReject ? (
            <GlassMenu
              open={more.open}
              onOpenChange={more.setOpen}
              placement="bottom-end"
              trigger={
                <Button type="button" variant="secondary" size="sm" iconOnly aria-label={copy.gastos.more} onClick={more.toggle}>
                  <MoreVertical strokeWidth={iconStroke} />
                </Button>
              }
            >
              <MenuItem
                onClick={() => {
                  more.close()
                  setRejectOpen(true)
                }}
              >
                {copy.gastos.reject}
              </MenuItem>
            </GlassMenu>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:px-8">
          <header>
            <h1 className="text-body font-medium break-words text-ink-900">
              {expense.supplier_name || expense.supplier_invoice_number || copy.gastos.title}
            </h1>
            <p className="mt-0.5 text-label text-text-secondary">
              {[expense.supplier_invoice_number, expense.legal_entity_code, expense.issue_date ? formatDate(expense.issue_date) : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </header>
          <div className="flex flex-wrap items-center gap-1.5">
            {expense.status === 'rejected' && expense.rejection_reason ? (
              <StatusChip tone="danger" detail={expense.rejection_reason}>
                {statusLabel(expense.status)}
              </StatusChip>
            ) : expense.status === 'validated' && !canApprove ? (
              <StatusChip tone="warning" detail={copy.gastos.pendingDetail}>
                {copy.gastos.pending}
              </StatusChip>
            ) : (
              <Badge tone={statusTone(expense.status)}>{statusLabel(expense.status)}</Badge>
            )}
            {expense.category_code ? <Badge tone="neutral">{categoryLabel(expense.category_code)}</Badge> : null}
            {expense.organic_relevant ? <Badge tone="success">{copy.gastos.organic}</Badge> : null}
            {expense.warnings.includes('entity_mismatch') ? <Badge tone="warning">{copy.gastos.entityMismatch}</Badge> : null}
            {expense.warnings.includes('supplier_unmatched') && !draft.supplier_id ? (
              <Badge tone="warning">{copy.gastos.unmatched}</Badge>
            ) : null}
          </div>
          {duplicate ? (
            <Alert tone="warning">
              <span className="text-label">{copy.gastos.duplicate}</span>
              {expense.duplicate_of_id ? (
                <a className="mt-1 block text-label font-medium text-ink-900 underline" href={`/gastos/${expense.duplicate_of_id}`}>
                  {copy.gastos.seeOriginal}
                </a>
              ) : null}
            </Alert>
          ) : null}
          {totalsDrift(draft) ? <Alert tone="warning">{copy.gastos.totals}</Alert> : null}
          {stale ? (
            <Alert tone="danger">
              <span className="text-label">{copy.gastos.stale}</span>
              <Button type="button" variant="primary" size="sm" className="mt-3" onClick={onReload}>
                {copy.gastos.reload}
              </Button>
            </Alert>
          ) : null}
          <div role="tablist" aria-label={copy.gastos.data} className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto border-b border-border-subtle px-4">
            {(['datos', 'documento'] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={tab === item}
                className={cn(
                  'h-8 shrink-0 border-b-2 px-2 text-label',
                  tab === item ? 'border-ink-900 font-medium text-ink-900' : 'border-transparent text-text-tertiary',
                )}
                onClick={() => setTab(item)}
              >
                {item === 'datos' ? copy.gastos.data : copy.gastos.document}
              </button>
            ))}
          </div>
          <div className="grid items-start gap-6 lg:grid-cols-2">
            {showDocument ? (
              <div className={showForm && desktop ? undefined : 'lg:col-span-2'}>
                <DocumentView attachmentId={expense.attachment_id} />
              </div>
            ) : null}
            {showForm ? (
              <ExpenseForm
                expense={expense}
                draft={draft}
                suppliers={options}
                errors={errors}
                disabled={!editable}
                onChange={setDraft}
                onCreateSupplier={() => {
                  if (!canCreateSupplier) {
                    toast(copy.gastos.failed)
                    return
                  }
                  setSupplierName(draft.supplier_name)
                  setSupplierTax(draft.supplier_tax_id)
                  setSupplierOpen(true)
                }}
              />
            ) : null}
          </div>
        </div>
      </div>

      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} labelledBy="rechazar-gasto" size="sm">
        <DialogHeader titleId="rechazar-gasto" title={copy.gastos.rejectTitle} onClose={() => setRejectOpen(false)} />
        <DialogBody>
          <Field id="motivo-rechazo" label={copy.gastos.rejectReason} error={errors.reason}>
            <Textarea
              id="motivo-rechazo"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRejectOpen(false)}>
            {copy.gastos.cancel}
          </Button>
          <Button type="button" variant="danger" size="sm" loading={acting === 'reject'} onClick={() => void reject()}>
            {copy.gastos.rejectConfirm}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={supplierOpen} onClose={() => setSupplierOpen(false)} labelledBy="alta-proveedor" size="sm">
        <DialogHeader titleId="alta-proveedor" title={copy.gastos.createSupplier} onClose={() => setSupplierOpen(false)} />
        <DialogBody>
          <div className="grid gap-3">
            <Field id="alta-nombre" label={copy.gastos.supplier}>
              <Input id="alta-nombre" value={supplierName} onChange={(event) => setSupplierName(event.target.value)} />
            </Field>
            <Field id="alta-nif" label={copy.gastos.taxId}>
              <Input id="alta-nif" value={supplierTax} className="font-mono" onChange={(event) => setSupplierTax(event.target.value)} />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSupplierOpen(false)}>
            {copy.gastos.cancel}
          </Button>
          <Button type="button" variant="primary" size="sm" loading={creating} onClick={() => void createSupplier()}>
            {copy.gastos.create}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
