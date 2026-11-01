import { useState } from 'react'
import { Field } from '@/components/Field'
import { copy } from '@/i18n'
import { COUNTRIES } from '@/lib/contacts'
import { hasShipTo, type ShipToDraft } from '@/lib/shipping'
import { Input, Reveal, Select, Textarea } from '@/ui'

/**
 * Where the document is sent and the customer's own references (their order number, cost
 * centre…), both printed on the PDF. Folded away unless there is something in them: most
 * documents carry neither.
 */
export function ShippingFields({
  idPrefix,
  shipTo,
  onShipTo,
  references,
  onReferences,
  hideCountry,
  hint,
}: {
  idPrefix: string
  shipTo: ShipToDraft
  onShipTo: (next: ShipToDraft) => void
  references: string
  onReferences: (next: string) => void
  /** An order already asks for the delivery country on its own, because the rules read it. */
  hideCountry?: boolean
  hint?: string
}) {
  const filled = hasShipTo(shipTo) || references.trim() !== ''
  const [initiallyOpen] = useState(filled)

  function set(key: keyof ShipToDraft, value: string) {
    onShipTo({ ...shipTo, [key]: value })
  }
  const known = COUNTRIES.some((country) => country.code === shipTo.country_code)

  return (
    <Reveal summary={copy.shipping.summary} defaultOpen={initiallyOpen} bodyClassName="pt-3">
      <div className="grid gap-4" data-screen="envio-referencias">
        {hint ? <p className="text-caption text-text-tertiary">{hint}</p> : null}
        <fieldset className="grid gap-3">
          <legend className="mb-1 text-label font-medium text-ink-900">{copy.shipping.address}</legend>
          <Field id={`${idPrefix}-envio-nombre`} label={copy.shipping.name}>
            <Input
              id={`${idPrefix}-envio-nombre`}
              size="sm"
              autoComplete="off"
              maxLength={160}
              value={shipTo.name}
              onChange={(event) => set('name', event.target.value)}
            />
          </Field>
          <Field id={`${idPrefix}-envio-direccion`} label={copy.shipping.line1}>
            <Input
              id={`${idPrefix}-envio-direccion`}
              size="sm"
              autoComplete="off"
              maxLength={160}
              value={shipTo.line1}
              onChange={(event) => set('line1', event.target.value)}
            />
          </Field>
          <Field id={`${idPrefix}-envio-direccion2`} label={copy.shipping.line2}>
            <Input
              id={`${idPrefix}-envio-direccion2`}
              size="sm"
              autoComplete="off"
              maxLength={160}
              value={shipTo.line2}
              onChange={(event) => set('line2', event.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <Field id={`${idPrefix}-envio-cp`} label={copy.shipping.postal}>
              <Input
                id={`${idPrefix}-envio-cp`}
                size="sm"
                inputMode="numeric"
                autoComplete="off"
                maxLength={20}
                value={shipTo.postal_code}
                onChange={(event) => set('postal_code', event.target.value)}
              />
            </Field>
            <Field id={`${idPrefix}-envio-localidad`} label={copy.shipping.city}>
              <Input
                id={`${idPrefix}-envio-localidad`}
                size="sm"
                autoComplete="off"
                maxLength={160}
                value={shipTo.city}
                onChange={(event) => set('city', event.target.value)}
              />
            </Field>
          </div>
          <div className={hideCountry ? 'grid gap-3' : 'grid gap-3 sm:grid-cols-2'}>
            <Field id={`${idPrefix}-envio-provincia`} label={copy.shipping.province}>
              <Input
                id={`${idPrefix}-envio-provincia`}
                size="sm"
                autoComplete="off"
                maxLength={160}
                value={shipTo.province}
                onChange={(event) => set('province', event.target.value)}
              />
            </Field>
            {hideCountry ? null : (
              <Field id={`${idPrefix}-envio-pais`} label={copy.shipping.country}>
                <Select
                  id={`${idPrefix}-envio-pais`}
                  size="sm"
                  className="w-full"
                  value={shipTo.country_code}
                  onChange={(event) => set('country_code', event.target.value)}
                >
                  <option value="">{copy.sales.none}</option>
                  {shipTo.country_code !== '' && !known ? <option value={shipTo.country_code}>{shipTo.country_code}</option> : null}
                  {COUNTRIES.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </fieldset>
        <Field id={`${idPrefix}-referencias`} label={copy.shipping.references} hint={copy.shipping.referencesHint}>
          <Textarea
            id={`${idPrefix}-referencias`}
            rows={3}
            autoCapitalize="none"
            maxLength={1000}
            placeholder={copy.shipping.referencesPlaceholder}
            value={references}
            onChange={(event) => onReferences(event.target.value)}
          />
        </Field>
      </div>
    </Reveal>
  )
}
