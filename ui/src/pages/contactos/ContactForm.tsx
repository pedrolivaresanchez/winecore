import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Field } from '@/components/Field'
import { fieldAria } from '@/lib/field'
import { ChevronDown } from '@/ui/icons'
import { Checkbox, InfoTip, Input, SegmentedControl, Select, Textarea } from '@/ui'
import { copy, fill } from '@/i18n'
import {
  COUNTRIES,
  PAYMENT_METHODS,
  VAT_REGIMES,
  paymentLabel,
  vatLabel,
  type ContactInput,
  type ContactKind,
} from '@/lib/contacts'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'

/**
 * `split` is the record's edit form: two columns, every field open. Without it the form is
 * the quick-create one: one column, and the conditions that already have a sensible default
 * fold under a single line that says what they are.
 */
export function ContactForm({
  value,
  onChange,
  onBlurField,
  errors,
  duplicate,
  disabled,
  extra = false,
  split = false,
}: {
  value: ContactInput
  onChange: (next: ContactInput) => void
  onBlurField?: (field: keyof ContactInput) => void
  errors: Record<string, string>
  duplicate?: { id: string; name: string } | null
  disabled?: boolean
  extra?: boolean
  split?: boolean
}) {
  const [conditionsOpen, setConditionsOpen] = useState(false)
  const conditionsId = useId()
  const person = value.kind === 'person'

  function set<K extends keyof ContactInput>(key: K, next: ContactInput[K]) {
    onChange({ ...value, [key]: next })
  }

  function described(id: string, hasHint: boolean) {
    return { ...fieldAria(id, errors[id]), 'aria-describedby': errors[id] ? `${id}-error` : hasHint ? `${id}-hint` : undefined }
  }

  const conditionFields = (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="language" label="Idioma">
          <Select
            id="language"
            className="w-full"
            value={value.language}
            disabled={disabled}
            onChange={(event) => set('language', event.target.value)}
          >
            <option value="es">Español</option>
            <option value="en">Inglés</option>
          </Select>
        </Field>
        <Field id="vat_regime" label="Régimen de IVA">
          <Select
            id="vat_regime"
            className="w-full"
            value={value.vat_regime}
            disabled={disabled}
            onChange={(event) => set('vat_regime', event.target.value)}
          >
            {VAT_REGIMES.map((regime) => (
              <option key={regime.value} value={regime.value}>
                {regime.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="payment_method" label="Forma de pago">
          <Select
            id="payment_method"
            className="w-full"
            value={value.payment_method ?? ''}
            disabled={disabled}
            onChange={(event) => set('payment_method', event.target.value)}
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method.value || 'none'} value={method.value}>
                {method.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="payment_terms_days" label="Días de pago" error={errors.payment_terms_days}>
          <Input
            {...fieldAria('payment_terms_days', errors.payment_terms_days)}
            invalid={Boolean(errors.payment_terms_days)}
            inputMode="numeric"
            value={String(value.payment_terms_days)}
            disabled={disabled}
            onChange={(event) => set('payment_terms_days', Number(event.target.value))}
            onBlur={() => onBlurField?.('payment_terms_days')}
          />
        </Field>
      </div>
      {extra ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="excise_number" label="CAE">
            <Input
              id="excise_number"
              value={value.excise_number ?? ''}
              disabled={disabled}
              onChange={(event) => set('excise_number', event.target.value)}
            />
          </Field>
          <Field id="eori" label="EORI">
            <Input id="eori" value={value.eori ?? ''} disabled={disabled} onChange={(event) => set('eori', event.target.value)} />
          </Field>
        </div>
      ) : null}
      <Field id="notes" label="Notas">
        <Textarea id="notes" value={value.notes ?? ''} disabled={disabled} onChange={(event) => set('notes', event.target.value)} />
      </Field>
    </>
  )

  return (
    <div className={split ? 'grid items-start gap-6 lg:grid-cols-2' : 'grid gap-4'}>
      <div className="grid gap-4">
        {split ? <h2 className="text-label font-medium text-ink-900">Datos fiscales</h2> : null}
        <fieldset className="grid gap-2" disabled={disabled}>
          <legend className="text-label text-text-secondary">Tipo</legend>
          <SegmentedControl
            aria-label="Tipo"
            value={value.kind}
            onChange={(kind) => set('kind', kind as ContactKind)}
            options={[
              { value: 'company', content: 'Empresa' },
              { value: 'person', content: 'Persona' },
            ]}
          />
        </fieldset>

        <Field id="legal_name" label="Nombre fiscal" error={errors.legal_name}>
          <Input
            {...described('legal_name', true)}
            invalid={Boolean(errors.legal_name)}
            value={value.legal_name}
            disabled={disabled}
            autoComplete="off"
            onChange={(event) => set('legal_name', event.target.value)}
            onBlur={() => onBlurField?.('legal_name')}
          />
          {errors.legal_name ? null : <Hint id="legal_name-hint">{person ? copy.contacts.personNameHint : copy.contacts.legalNameHint}</Hint>}
        </Field>
        {!person || value.trade_name ? (
          <Field id="trade_name" label="Nombre comercial">
            <Input
              id="trade_name"
              value={value.trade_name ?? ''}
              disabled={disabled}
              placeholder="Opcional"
              onChange={(event) => set('trade_name', event.target.value)}
            />
          </Field>
        ) : null}
        <div className={cn('grid gap-4', !split && 'sm:grid-cols-2')}>
          <Field id="tax_id" label="NIF" error={errors.tax_id}>
            <Input
              {...described('tax_id', true)}
              invalid={Boolean(errors.tax_id)}
              value={value.tax_id ?? ''}
              disabled={disabled}
              autoCapitalize="characters"
              autoComplete="off"
              onChange={(event) => set('tax_id', event.target.value)}
              onBlur={() => onBlurField?.('tax_id')}
            />
            {errors.tax_id ? null : (
              <Hint id="tax_id-hint" help={copy.contacts.taxHelp}>
                {copy.contacts.taxHint}
              </Hint>
            )}
          </Field>
          <Field id="country_code" label="País" error={errors.country_code}>
            <Select
              {...described('country_code', true)}
              className="w-full"
              value={value.country_code}
              disabled={disabled}
              onChange={(event) => set('country_code', event.target.value)}
            >
              {COUNTRIES.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.label}
                </option>
              ))}
            </Select>
            {errors.country_code ? null : (
              <Hint id="country_code-hint" help={copy.contacts.countryHelp}>
                {copy.contacts.countryHint}
              </Hint>
            )}
          </Field>
        </div>
        {duplicate ? (
          <p id="duplicate-tax" role="alert" className="text-label text-danger-600">
            <Link className="underline" to={`/contactos/${duplicate.id}`}>
              {fill(copy.contacts.duplicate, { name: duplicate.name })}
            </Link>
          </p>
        ) : null}
        <fieldset className="grid gap-2.5" disabled={disabled}>
          <legend className="mb-2 flex items-center gap-1 text-label text-text-secondary">
            {copy.contacts.roles}
            <InfoTip label={copy.contacts.roles}>{copy.contacts.rolesHelp}</InfoTip>
          </legend>
          <Checkbox
            label="Cliente"
            description={copy.contacts.roleCustomer}
            checked={value.is_customer}
            disabled={disabled}
            onChange={(checked) => set('is_customer', checked)}
          />
          <Checkbox
            label="Proveedor"
            description={copy.contacts.roleSupplier}
            checked={value.is_supplier}
            disabled={disabled}
            onChange={(checked) => set('is_supplier', checked)}
          />
          <Checkbox
            label="Transportista"
            description={copy.contacts.roleCarrier}
            checked={value.is_carrier}
            disabled={disabled}
            onChange={(checked) => set('is_carrier', checked)}
          />
          <Checkbox
            label="Operador logístico"
            description={copy.contacts.roleLogistics}
            checked={value.is_logistics_operator}
            disabled={disabled}
            onChange={(checked) => set('is_logistics_operator', checked)}
          />
        </fieldset>
        <div className={cn('grid gap-4', !split && 'sm:grid-cols-2')}>
          <Field id="email" label="Correo" error={errors.email}>
            <Input
              {...described('email', true)}
              invalid={Boolean(errors.email)}
              type="email"
              autoComplete="off"
              value={value.email ?? ''}
              disabled={disabled}
              placeholder="nombre@example.com"
              onChange={(event) => set('email', event.target.value)}
              onBlur={() => onBlurField?.('email')}
            />
            {errors.email ? null : <Hint id="email-hint">{copy.contacts.emailHint}</Hint>}
          </Field>
          <Field id="phone" label="Teléfono">
            <Input
              id="phone"
              type="tel"
              autoComplete="off"
              value={value.phone ?? ''}
              disabled={disabled}
              placeholder="Opcional"
              onChange={(event) => set('phone', event.target.value)}
            />
          </Field>
        </div>
      </div>
      {split ? (
        <div className="grid gap-4">
          <h2 className="text-label font-medium text-ink-900">Condiciones y notas</h2>
          {conditionFields}
        </div>
      ) : (
        <section className="grid gap-4 border-t border-border-subtle pt-3">
          <button
            type="button"
            aria-expanded={conditionsOpen || Boolean(errors.payment_terms_days)}
            aria-controls={conditionsId}
            className="-mx-2 flex min-h-8 items-center gap-2 rounded-md px-2 text-left outline-none transition-colors hover:bg-fill-hover focus-visible:shadow-(--shadow-focus)"
            onClick={() => setConditionsOpen((open) => !open)}
          >
            <ChevronDown
              className={cn('size-3.5 shrink-0 text-icon transition-transform', conditionsOpen || errors.payment_terms_days ? null : '-rotate-90')}
              strokeWidth={iconStroke}
            />
            <span className="text-label font-medium text-ink-900">{copy.contacts.conditions}</span>
            <span className="min-w-0 truncate text-caption text-text-tertiary">
              {conditionsSummary(value)}
            </span>
          </button>
          {conditionsOpen || errors.payment_terms_days ? (
            <div id={conditionsId} className="grid gap-4">
              {conditionFields}
            </div>
          ) : null}
        </section>
      )}
    </div>
  )
}

function conditionsSummary(value: ContactInput): string {
  const parts = [
    value.language === 'en' ? 'Inglés' : 'Español',
    vatLabel(value.vat_regime),
    value.payment_method ? paymentLabel(value.payment_method) : null,
    fill(copy.contactRecord.daysValue, { days: String(value.payment_terms_days) }),
  ]
  return parts.filter(Boolean).join(' · ')
}

function Hint({ id, help, children }: { id: string; help?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1 text-caption text-text-tertiary">
      <span id={id}>{children}</span>
      {help ? <InfoTip placement="top-start">{help}</InfoTip> : null}
    </div>
  )
}
