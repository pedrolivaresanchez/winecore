import { useState } from 'react'
import { Field } from '@/components/Field'
import { copy, fill } from '@/i18n'
import { ApiError } from '@/lib/api'
import { DATE_LABELS, parseDiscount, type TariffDraft, type TariffInput } from '@/pages/intercompania/model'
import { Button, DatePicker, Dialog, DialogBody, DialogFooter, DialogHeader, InfoTip, Input, Select } from '@/ui'

export function TariffDialog({
  open,
  title,
  initial,
  baseLists,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean
  title: string
  initial: TariffDraft
  baseLists: string[]
  busy: boolean
  onClose: () => void
  onSubmit: (input: TariffInput) => Promise<void>
}) {
  const [draft, setDraft] = useState(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const lists = baseLists.includes(draft.baseListId) || draft.baseListId === '' ? baseLists : [draft.baseListId, ...baseLists]
  const showBase = lists.length !== 1

  async function submit() {
    const discount = parseDiscount(draft.discount)
    const next: Record<string, string> = {}
    if ('error' in discount) next.discount_pct = discount.error
    if (!draft.validFrom) next.valid_from = 'Indica el inicio'
    if (draft.validFrom && draft.validTo && draft.validTo <= draft.validFrom) {
      next.valid_to = 'El fin tiene que ser posterior al inicio'
    }
    if (draft.advisor.trim().length < 5) next.advisor_validation = 'Falta la referencia del asesor'
    const base = draft.baseListId.trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base)) {
      next.base_price_list_id = 'Indica la tarifa base'
    }
    setErrors(next)
    if (Object.keys(next).length > 0 || 'error' in discount) return
    try {
      await onSubmit({
        base_price_list_id: base,
        discount_pct: discount.value,
        valid_from: draft.validFrom ?? '',
        valid_to: draft.validTo,
        advisor_validation: draft.advisor.trim(),
      })
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields)
      else throw error
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="tarifa-dialogo" size="md">
      <DialogHeader titleId="tarifa-dialogo" title={title} onClose={onClose} />
      <DialogBody>
        <form
          id="tarifa-form"
          data-screen="intercompania-dialogo"
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Field id="descuento" label={copy.intercompany.discountLabel} error={errors.discount_pct}>
            <Input
              id="descuento"
              size="md"
              inputMode="decimal"
              value={draft.discount}
              invalid={Boolean(errors.discount_pct)}
              aria-describedby={errors.discount_pct ? 'descuento-error' : undefined}
              suffix={
                <InfoTip label={copy.intercompany.discount}>
                  {fill(copy.intercompany.formula, { discount: `${draft.discount || '0'} %` })}
                </InfoTip>
              }
              onChange={(event) => setDraft((current) => ({ ...current, discount: event.target.value }))}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="vigencia-desde" label={copy.intercompany.validFrom} error={errors.valid_from} hint={copy.intercompany.windowHint}>
              <DatePicker
                value={draft.validFrom}
                labels={DATE_LABELS}
                timeZone="Europe/Madrid"
                className="w-full"
                onChange={(validFrom) => setDraft((current) => ({ ...current, validFrom }))}
              />
            </Field>
            <Field id="vigencia-hasta" label={copy.intercompany.validTo} error={errors.valid_to} hint={copy.intercompany.untilHint}>
              <DatePicker
                value={draft.validTo}
                labels={DATE_LABELS}
                timeZone="Europe/Madrid"
                className="w-full"
                onChange={(validTo) => setDraft((current) => ({ ...current, validTo }))}
              />
            </Field>
          </div>
          <Field
            id="asesor"
            label={copy.intercompany.advisor}
            error={errors.advisor_validation}
            hint={copy.intercompany.advisorHint}
          >
            <Input
              id="asesor"
              size="md"
              value={draft.advisor}
              invalid={Boolean(errors.advisor_validation)}
              onChange={(event) => setDraft((current) => ({ ...current, advisor: event.target.value }))}
            />
          </Field>
          {showBase ? (
            <Field id="tarifa-base" label={copy.intercompany.baseList} error={errors.base_price_list_id} hint={copy.intercompany.baseHint}>
              {lists.length > 0 ? (
                <Select
                  id="tarifa-base"
                  className="w-full"
                  value={draft.baseListId}
                  aria-invalid={Boolean(errors.base_price_list_id)}
                  onChange={(event) => setDraft((current) => ({ ...current, baseListId: event.target.value }))}
                >
                  <option value="">{copy.intercompany.baseList}</option>
                  {lists.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id="tarifa-base"
                  size="md"
                  value={draft.baseListId}
                  invalid={Boolean(errors.base_price_list_id)}
                  spellCheck={false}
                  onChange={(event) => setDraft((current) => ({ ...current, baseListId: event.target.value }))}
                />
              )}
            </Field>
          ) : null}
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          {copy.intercompany.cancel}
        </Button>
        <Button type="submit" form="tarifa-form" variant="primary" size="sm" loading={busy}>
          {copy.intercompany.save}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
