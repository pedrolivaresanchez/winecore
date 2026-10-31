import { Link } from "react-router-dom";
import { Field } from "@/components/Field";
import { fieldAria } from "@/lib/field";
import { taxIdWarning } from "@/lib/tax-id";
import { Input } from "@/components/ui/input";
import { NativeSelect, TextArea } from "@/components/ui/native-field";
import { copy, fill } from "@/i18n";
import {
  COUNTRIES,
  PAYMENT_METHODS,
  VAT_REGIMES,
  type ContactInput,
  type ContactKind,
} from "@/lib/contacts";
function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-compact">
      <input
        type="checkbox"
        className="size-4"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

export function ContactForm({
  value,
  onChange,
  errors,
  duplicate,
  disabled,
  extra = false,
  split = false,
}: {
  value: ContactInput;
  onChange: (next: ContactInput) => void;
  errors: Record<string, string>;
  duplicate?: { id: string; name: string } | null;
  disabled?: boolean;
  extra?: boolean;
  split?: boolean;
}) {
  function set<K extends keyof ContactInput>(key: K, next: ContactInput[K]) {
    onChange({ ...value, [key]: next });
  }

  const taxWarning = errors.tax_id ? null : taxIdWarning(value.tax_id ?? "", value.country_code);

  return (
    <div className={split ? "grid items-start gap-6 lg:grid-cols-2" : "grid gap-4"}>
      <div className="grid gap-4">
      {split ? <h3 className="text-body font-semibold">Datos fiscales</h3> : null}
      <fieldset className="grid gap-2" disabled={disabled}>
        <legend className="text-compact font-medium">Tipo</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["company", "Empresa"],
              ["person", "Persona"],
            ] as const
          ).map(([kind, label]) => (
            <label key={kind} className="flex min-h-11 items-center gap-2 rounded-full bg-muted px-3 text-compact">
              <input
                type="radio"
                name="kind"
                checked={value.kind === kind}
                onChange={() => set("kind", kind as ContactKind)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <Field id="legal_name" label="Nombre fiscal" error={errors.legal_name} hint="Entre 2 y 120 caracteres.">
        <Input
          {...fieldAria("legal_name", errors.legal_name)}
          value={value.legal_name}
          disabled={disabled}
          onChange={(event) => set("legal_name", event.target.value)}
        />
      </Field>
      <Field id="trade_name" label="Nombre comercial">
        <Input id="trade_name" value={value.trade_name ?? ""} disabled={disabled} onChange={(event) => set("trade_name", event.target.value)} />
      </Field>
      <Field id="tax_id" label="NIF" error={errors.tax_id}>
        <Input
          {...fieldAria("tax_id", errors.tax_id)}
          value={value.tax_id ?? ""}
          disabled={disabled}
          autoCapitalize="characters"
          aria-describedby={errors.tax_id ? "tax_id-error" : taxWarning ? "tax_id-warning" : undefined}
          onChange={(event) => set("tax_id", event.target.value)}
        />
      </Field>
      {taxWarning ? (
        <p id="tax_id-warning" role="status" className="-mt-2 rounded-lg bg-status-warning px-3 py-2 text-compact text-status-warning-fg">
          {taxWarning}
        </p>
      ) : null}
      {duplicate ? (
        <p id="duplicate-tax" role="alert" className="text-compact text-destructive">
          <Link className="underline" to={`/contactos/${duplicate.id}`}>
            {fill(copy.contacts.duplicate, { name: duplicate.name })}
          </Link>
        </p>
      ) : null}
      <Field id="country_code" label="País" error={errors.country_code}>
        <NativeSelect
          {...fieldAria("country_code", errors.country_code)}
          value={value.country_code}
          disabled={disabled}
          onChange={(event) => set("country_code", event.target.value)}
        >
          {COUNTRIES.map((country) => (
            <option key={country.code} value={country.code}>
              {country.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="email" label="Correo" error={errors.email}>
        <Input
          {...fieldAria("email", errors.email)}
          type="email"
          autoComplete="email"
          value={value.email ?? ""}
          disabled={disabled}
          placeholder="nombre@example.com"
          onChange={(event) => set("email", event.target.value)}
        />
      </Field>
      <Field id="phone" label="Teléfono">
        <Input
          id="phone"
          type="tel"
          autoComplete="tel"
          value={value.phone ?? ""}
          disabled={disabled}
          placeholder="Opcional"
          onChange={(event) => set("phone", event.target.value)}
        />
      </Field>
      <fieldset className="grid gap-1" disabled={disabled}>
        <legend className="text-compact font-medium">Papel</legend>
        <Check label="Cliente" checked={value.is_customer} disabled={disabled} onChange={(checked) => set("is_customer", checked)} />
        <Check label="Proveedor" checked={value.is_supplier} disabled={disabled} onChange={(checked) => set("is_supplier", checked)} />
        <Check label="Transportista" checked={value.is_carrier} disabled={disabled} onChange={(checked) => set("is_carrier", checked)} />
        <Check label="Operador logístico" checked={value.is_logistics_operator} disabled={disabled} onChange={(checked) => set("is_logistics_operator", checked)} />
      </fieldset>
      </div>
      <div className="grid gap-4">
      {split ? <h3 className="text-body font-semibold">Condiciones y notas</h3> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="language" label="Idioma">
          <NativeSelect id="language" value={value.language} disabled={disabled} onChange={(event) => set("language", event.target.value)}>
            <option value="es">Español</option>
            <option value="en">Inglés</option>
          </NativeSelect>
        </Field>
        <Field id="vat_regime" label="Régimen de IVA">
          <NativeSelect id="vat_regime" value={value.vat_regime} disabled={disabled} onChange={(event) => set("vat_regime", event.target.value)}>
            {VAT_REGIMES.map((regime) => (
              <option key={regime.value} value={regime.value}>
                {regime.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="payment_method" label="Forma de pago">
          <NativeSelect
            id="payment_method"
            value={value.payment_method ?? ""}
            disabled={disabled}
            onChange={(event) => set("payment_method", event.target.value)}
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method.value || "none"} value={method.value}>
                {method.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="payment_terms_days" label="Días de pago" error={errors.payment_terms_days} hint="Entre 0 y 180 días.">
          <Input
            {...fieldAria("payment_terms_days", errors.payment_terms_days)}
            inputMode="numeric"
            value={String(value.payment_terms_days)}
            disabled={disabled}
            onChange={(event) => set("payment_terms_days", Number(event.target.value))}
          />
        </Field>
      </div>
      {extra ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="excise_number" label="CAE">
            <Input id="excise_number" value={value.excise_number ?? ""} disabled={disabled} onChange={(event) => set("excise_number", event.target.value)} />
          </Field>
          <Field id="eori" label="EORI">
            <Input id="eori" value={value.eori ?? ""} disabled={disabled} onChange={(event) => set("eori", event.target.value)} />
          </Field>
        </div>
      ) : null}
      <Field id="notes" label="Notas">
        <TextArea id="notes" value={value.notes ?? ""} disabled={disabled} onChange={(event) => set("notes", event.target.value)} />
      </Field>
      </div>
    </div>
  );
}
