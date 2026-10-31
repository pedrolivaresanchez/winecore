import { Link } from "react-router-dom";
import { Field } from "@/components/Field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-field";
import { fieldAria } from "@/lib/field";
import {
  CATEGORY_OPTIONS,
  COLOR_OPTIONS,
  CONTAINER_OPTIONS,
  KIND_OPTIONS,
  TAX_OPTIONS,
  UNIT_OPTIONS,
  type Format,
  type FormatInput,
  type ProductInput,
  type ProductKind,
  type Wine,
  type WineInput,
} from "@/pages/catalogo/model";

function Check({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="flex min-h-11 items-start gap-2 py-1 text-compact">
      <input
        type="checkbox"
        className="mt-0.5 size-4"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {label}
        {hint ? <span className="mt-0.5 block text-meta text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

export function ProductForm({
  value,
  onChange,
  errors,
  wines,
  formats,
  locked = false,
  disabled,
  section,
  duplicate,
}: {
  value: ProductInput;
  onChange: (next: ProductInput) => void;
  errors: Record<string, string>;
  wines: Wine[];
  formats: Format[];
  locked?: boolean;
  disabled?: boolean;
  section: "create" | "general" | "fiscal" | "edi";
  duplicate?: { id: string; name: string } | null;
}) {
  function set<K extends keyof ProductInput>(key: K, next: ProductInput[K]) {
    onChange({ ...value, [key]: next });
  }

  function setKind(kind: ProductKind) {
    onChange({
      ...value,
      kind,
      requires_lot: kind === "wine" ? true : value.requires_lot,
      is_stock_tracked: kind === "service" || kind === "gift_card" ? false : value.is_stock_tracked,
    });
  }

  const wineKind = value.kind === "wine" || value.kind === "bulk_wine";
  const showGeneral = section === "create" || section === "general";
  const showFiscal = section === "create" || section === "fiscal";
  const showEdi = section === "edi";

  return (
    <div className="grid gap-4">
      {duplicate ? (
        <p id="duplicate-product" role="alert" className="text-compact text-destructive">
          Ya existe.{" "}
          <Link className="underline" to={`/catalogo/${duplicate.id}`}>
            {duplicate.name}
          </Link>
        </p>
      ) : null}
      {showGeneral ? (
        <>
          <fieldset className="grid gap-2" disabled={disabled || locked}>
            <legend className="text-compact font-medium">Tipo</legend>
            <div className="flex flex-wrap gap-2">
              {KIND_OPTIONS.map((kind) => (
                <label key={kind.id} className="flex min-h-11 items-center gap-2 rounded-full bg-muted px-3 text-compact">
                  <input type="radio" name="kind" checked={value.kind === kind.id} onChange={() => setKind(kind.id)} />
                  {kind.label}
                </label>
              ))}
            </div>
          </fieldset>
          {locked ? (
            <p className="text-compact text-muted-foreground">
              Este producto ya tiene movimientos. El vino, la añada y el formato no se pueden cambiar; crea otro producto.
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="sku" label="SKU" error={errors.sku}>
              <Input
                {...fieldAria("sku", errors.sku)}
                value={value.sku}
                disabled={disabled}
                autoCapitalize="characters"
                onChange={(event) => set("sku", event.target.value.toUpperCase())}
              />
            </Field>
            <Field id="name" label="Nombre" error={errors.name}>
              <Input {...fieldAria("name", errors.name)} value={value.name} disabled={disabled} onChange={(event) => set("name", event.target.value)} />
            </Field>
          </div>
          <Field id="name_en" label="Nombre en inglés" error={errors.name_en} hint="Se usa en facturas y proformas en inglés.">
            <Input
              {...fieldAria("name_en", errors.name_en)}
              value={value.name_en}
              disabled={disabled}
              onChange={(event) => set("name_en", event.target.value)}
            />
          </Field>
          {wineKind ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="wine_id" label="Vino" error={errors.wine_id}>
                <NativeSelect
                  {...fieldAria("wine_id", errors.wine_id)}
                  value={value.wine_id}
                  disabled={disabled || locked}
                  onChange={(event) => set("wine_id", event.target.value)}
                >
                  <option value="">Elige un vino</option>
                  {wines.map((wine) => (
                    <option key={wine.id} value={wine.id}>
                      {wine.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="vintage" label="Añada" error={errors.vintage} hint="Vacío si el vino no tiene añada.">
                <Input
                  {...fieldAria("vintage", errors.vintage)}
                  inputMode="numeric"
                  value={value.vintage}
                  disabled={disabled || locked}
                  placeholder="2025"
                  onChange={(event) => set("vintage", event.target.value)}
                />
              </Field>
            </div>
          ) : null}
          {value.kind === "wine" ? (
            <Field id="format_id" label="Formato" error={errors.format_id}>
              <NativeSelect
                {...fieldAria("format_id", errors.format_id)}
                value={value.format_id}
                disabled={disabled || locked}
                onChange={(event) => set("format_id", event.target.value)}
              >
                <option value="">Elige un formato</option>
                {formats.map((format) => (
                  <option key={format.id} value={format.id}>
                    {format.code} · {format.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          <Field id="unit" label="Unidad">
            <NativeSelect id="unit" value={value.unit} disabled={disabled} onChange={(event) => set("unit", event.target.value as ProductInput["unit"])}>
              {UNIT_OPTIONS.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Check
            label="Requiere lote"
            hint={value.kind === "wine" ? "El vino embotellado siempre lleva lote." : undefined}
            checked={value.kind === "wine" ? true : value.requires_lot}
            disabled={disabled || value.kind === "wine"}
            onChange={(checked) => set("requires_lot", checked)}
          />
          <Check
            label="Controla existencias"
            checked={value.kind === "service" || value.kind === "gift_card" ? false : value.is_stock_tracked}
            disabled={disabled || value.kind === "service" || value.kind === "gift_card"}
            onChange={(checked) => set("is_stock_tracked", checked)}
          />
        </>
      ) : null}

      {showFiscal ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="default_tax_code" label="IVA por defecto">
            <NativeSelect
              id="default_tax_code"
              value={value.default_tax_code}
              disabled={disabled}
              onChange={(event) => set("default_tax_code", event.target.value)}
            >
              {TAX_OPTIONS.map((tax) => (
                <option key={tax.id || "none"} value={tax.id}>
                  {tax.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="nc_code" label="Código NC" error={errors.nc_code} hint="8 dígitos. Hace falta para SILICIE y el e-DA.">
            <Input
              {...fieldAria("nc_code", errors.nc_code)}
              inputMode="numeric"
              value={value.nc_code}
              disabled={disabled}
              onChange={(event) => set("nc_code", event.target.value)}
            />
          </Field>
          <Field id="excise_product_key" label="Mayor SILICIE" error={errors.excise_product_key} hint="Referencia del mayor, por ejemplo B075-ENEBRO.">
            <Input
              {...fieldAria("excise_product_key", errors.excise_product_key)}
              value={value.excise_product_key}
              disabled={disabled}
              autoCapitalize="characters"
              onChange={(event) => set("excise_product_key", event.target.value.toUpperCase())}
            />
          </Field>
          <Field id="alcohol_pct" label="Grado declarado" error={errors.alcohol_pct}>
            <Input
              {...fieldAria("alcohol_pct", errors.alcohol_pct)}
              inputMode="decimal"
              value={value.alcohol_pct}
              disabled={disabled}
              placeholder="14,50"
              onChange={(event) => set("alcohol_pct", event.target.value)}
            />
          </Field>
          {section !== "create" ? (
            <Field id="sales_account" label="Cuenta de ventas" error={errors.sales_account} hint="Cuenta del grupo 7.">
              <Input
                {...fieldAria("sales_account", errors.sales_account)}
                value={value.sales_account}
                disabled={disabled}
                placeholder="70000000"
                onChange={(event) => set("sales_account", event.target.value)}
              />
            </Field>
          ) : null}
        </div>
      ) : null}

      {showEdi ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="gtin" label="GTIN unidad" error={errors.gtin} hint="Hace falta para El Corte Inglés.">
            <Input
              {...fieldAria("gtin", errors.gtin)}
              inputMode="numeric"
              value={value.gtin}
              disabled={disabled}
              onChange={(event) => set("gtin", event.target.value)}
            />
          </Field>
          <Field id="gtin_case" label="GTIN-14 caja" error={errors.gtin_case}>
            <Input
              {...fieldAria("gtin_case", errors.gtin_case)}
              inputMode="numeric"
              value={value.gtin_case}
              disabled={disabled}
              onChange={(event) => set("gtin_case", event.target.value)}
            />
          </Field>
        </div>
      ) : null}

      {section === "create" ? (
        <Field id="gtin" label="GTIN unidad" error={errors.gtin} hint="Opcional. Hace falta para El Corte Inglés.">
          <Input
            {...fieldAria("gtin", errors.gtin)}
            inputMode="numeric"
            value={value.gtin}
            disabled={disabled}
            onChange={(event) => set("gtin", event.target.value)}
          />
        </Field>
      ) : null}
    </div>
  );
}

export function WineForm({
  value,
  onChange,
  errors,
  disabled,
}: {
  value: WineInput;
  onChange: (next: WineInput) => void;
  errors: Record<string, string>;
  disabled?: boolean;
}) {
  function set<K extends keyof WineInput>(key: K, next: WineInput[K]) {
    onChange({ ...value, [key]: next });
  }
  const needsName = value.category === "pdo_wine" || value.category === "pgi_wine";
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="wine_code" label="Código" error={errors.code}>
          <Input
            {...fieldAria("wine_code", errors.code)}
            value={value.code}
            disabled={disabled}
            autoCapitalize="characters"
            onChange={(event) => set("code", event.target.value.toUpperCase())}
          />
        </Field>
        <Field id="wine_name" label="Nombre" error={errors.name}>
          <Input {...fieldAria("wine_name", errors.name)} value={value.name} disabled={disabled} onChange={(event) => set("name", event.target.value)} />
        </Field>
        <Field id="wine_color" label="Color">
          <NativeSelect id="wine_color" value={value.color} disabled={disabled} onChange={(event) => set("color", event.target.value as WineInput["color"])}>
            {COLOR_OPTIONS.map((color) => (
              <option key={color.id} value={color.id}>
                {color.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="wine_category" label="Categoría">
          <NativeSelect
            id="wine_category"
            value={value.category}
            disabled={disabled}
            onChange={(event) => set("category", event.target.value as WineInput["category"])}
          >
            {CATEGORY_OPTIONS.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {needsName ? (
        <Field id="pdo_pgi_name" label={value.category === "pdo_wine" ? "DOP" : "IGP"} error={errors.pdo_pgi_name}>
          <Input
            {...fieldAria("pdo_pgi_name", errors.pdo_pgi_name)}
            value={value.pdo_pgi_name}
            disabled={disabled}
            onChange={(event) => set("pdo_pgi_name", event.target.value)}
          />
        </Field>
      ) : null}
      <Check label="Ecológico" checked={value.is_organic} disabled={disabled} onChange={(checked) => set("is_organic", checked)} />
      <Check label="Sin sulfitos añadidos" checked={value.no_added_sulfites} disabled={disabled} onChange={(checked) => set("no_added_sulfites", checked)} />
      <Check label="Parcela única" checked={value.is_single_plot} disabled={disabled} onChange={(checked) => set("is_single_plot", checked)} />
    </div>
  );
}

export function FormatForm({
  value,
  onChange,
  errors,
  disabled,
}: {
  value: FormatInput;
  onChange: (next: FormatInput) => void;
  errors: Record<string, string>;
  disabled?: boolean;
}) {
  function set<K extends keyof FormatInput>(key: K, next: FormatInput[K]) {
    onChange({ ...value, [key]: next });
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id="format_code" label="Código" error={errors.code}>
        <Input
          {...fieldAria("format_code", errors.code)}
          value={value.code}
          disabled={disabled}
          autoCapitalize="characters"
          onChange={(event) => set("code", event.target.value.toUpperCase())}
        />
      </Field>
      <Field id="format_name" label="Nombre" error={errors.name}>
        <Input {...fieldAria("format_name", errors.name)} value={value.name} disabled={disabled} onChange={(event) => set("name", event.target.value)} />
      </Field>
      <Field id="format_container" label="Envase">
        <NativeSelect
          id="format_container"
          value={value.container}
          disabled={disabled}
          onChange={(event) => set("container", event.target.value as FormatInput["container"])}
        >
          {CONTAINER_OPTIONS.map((container) => (
            <option key={container.id} value={container.id}>
              {container.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="nominal_volume_ml" label="Volumen (ml)" error={errors.nominal_volume_ml}>
        <Input
          {...fieldAria("nominal_volume_ml", errors.nominal_volume_ml)}
          inputMode="numeric"
          value={value.nominal_volume_ml}
          disabled={disabled}
          placeholder="750"
          onChange={(event) => set("nominal_volume_ml", event.target.value)}
        />
      </Field>
      <Field id="units_per_case" label="Unidades por caja" error={errors.units_per_case}>
        <Input
          {...fieldAria("units_per_case", errors.units_per_case)}
          inputMode="numeric"
          value={value.units_per_case}
          disabled={disabled}
          onChange={(event) => set("units_per_case", event.target.value)}
        />
      </Field>
      <Field id="cases_per_pallet" label="Cajas por palet" error={errors.cases_per_pallet}>
        <Input
          {...fieldAria("cases_per_pallet", errors.cases_per_pallet)}
          inputMode="numeric"
          value={value.cases_per_pallet}
          disabled={disabled}
          onChange={(event) => set("cases_per_pallet", event.target.value)}
        />
      </Field>
      <Field id="unit_gross_weight_g" label="Peso bruto (g)" error={errors.unit_gross_weight_g}>
        <Input
          {...fieldAria("unit_gross_weight_g", errors.unit_gross_weight_g)}
          inputMode="numeric"
          value={value.unit_gross_weight_g}
          disabled={disabled}
          onChange={(event) => set("unit_gross_weight_g", event.target.value)}
        />
      </Field>
      <Field id="unit_net_weight_g" label="Peso neto (g)" error={errors.unit_net_weight_g}>
        <Input
          {...fieldAria("unit_net_weight_g", errors.unit_net_weight_g)}
          inputMode="numeric"
          value={value.unit_net_weight_g}
          disabled={disabled}
          onChange={(event) => set("unit_net_weight_g", event.target.value)}
        />
      </Field>
    </div>
  );
}
