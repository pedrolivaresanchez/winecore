import { Link } from 'react-router-dom'
import { Field } from '@/components/Field'
import { fieldAria } from '@/lib/field'
import { Checkbox, Input, SegmentedControl, Select, Textarea } from '@/ui'
import { copy, fill } from '@/i18n'
import {
  COUNTRIES,
  PAYMENT_METHODS,
  VAT_REGIMES,
  type ContactInput,
  type ContactKind,
} from '@/lib/contacts'

export function ContactForm({
  value,
  onChange,
  errors,
  duplicate,
  disabled,
  extra = false,
  split = false,
}: {
  value: ContactInput
  onChange: (next: ContactInput) => void
  errors: Record<string, string>
  duplicate?: { id: string; name: string } | null
  disabled?: boolean
  extra?: boolean
  split?: boolean
}) {
  function set<K extends keyof ContactInput>(key: K, next: ContactInput[K]) {
    onChange({ ...value, [key]: next })
  }

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
            {...fieldAria('legal_name', errors.legal_name)}
            invalid={Boolean(errors.legal_name)}
            value={value.legal_name}
            disabled={disabled}
            onChange={(event) => set('legal_name', event.target.value)}
          />
        </Field>
        <Field id="trade_name" label="Nombre comercial">
          <Input
            id="trade_name"
            value={value.trade_name ?? ''}
            disabled={disabled}
            onChange={(event) => set('trade_name', event.target.value)}
          />
        </Field>
        <Field id="tax_id" label="NIF" error={errors.tax_id}>
          <Input
            {...fieldAria('tax_id', errors.tax_id)}
            invalid={Boolean(errors.tax_id)}
            value={value.tax_id ?? ''}
            disabled={disabled}
            autoCapitalize="characters"
            onChange={(event) => set('tax_id', event.target.value)}
          />
        </Field>
        {duplicate ? (
          <p id="duplicate-tax" role="alert" className="text-label text-danger-600">
            <Link className="underline" to={`/contactos/${duplicate.id}`}>
              {fill(copy.contacts.duplicate, { name: duplicate.name })}
            </Link>
          </p>
        ) : null}
        <Field id="country_code" label="País" error={errors.country_code}>
          <Select
            {...fieldAria('country_code', errors.country_code)}
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
        </Field>
        <Field id="email" label="Correo" error={errors.email}>
          <Input
            {...fieldAria('email', errors.email)}
            invalid={Boolean(errors.email)}
            type="email"
            autoComplete="email"
            value={value.email ?? ''}
            disabled={disabled}
            placeholder="nombre@example.com"
            onChange={(event) => set('email', event.target.value)}
          />
        </Field>
        <Field id="phone" label="Teléfono">
          <Input
            id="phone"
            type="tel"
            autoComplete="tel"
            value={value.phone ?? ''}
            disabled={disabled}
            placeholder="Opcional"
            onChange={(event) => set('phone', event.target.value)}
          />
        </Field>
        <fieldset className="grid gap-2" disabled={disabled}>
          <legend className="text-label text-text-secondary">Papel</legend>
          <Checkbox label="Cliente" checked={value.is_customer} disabled={disabled} onChange={(checked) => set('is_customer', checked)} />
          <Checkbox label="Proveedor" checked={value.is_supplier} disabled={disabled} onChange={(checked) => set('is_supplier', checked)} />
          <Checkbox label="Transportista" checked={value.is_carrier} disabled={disabled} onChange={(checked) => set('is_carrier', checked)} />
          <Checkbox
            label="Operador logístico"
            checked={value.is_logistics_operator}
            disabled={disabled}
            onChange={(checked) => set('is_logistics_operator', checked)}
          />
        </fieldset>
      </div>
      <div className="grid gap-4">
        {split ? <h2 className="text-label font-medium text-ink-900">Condiciones y notas</h2> : null}
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
      </div>
    </div>
  )
}
