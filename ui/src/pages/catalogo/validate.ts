import { gtinError } from "@/pages/catalogo/gtin";
import { cmpDecimal, isPositiveDecimal, normalizeDecimal } from "@/pages/catalogo/money";
import type { FormatInput, ProductInput, WineInput } from "@/pages/catalogo/model";

const SKU = /^[A-Z0-9][A-Z0-9._-]{1,39}$/;
const WINE_CODE = /^[A-Z0-9-]{2,20}$/;
const FORMAT_CODE = /^[A-Z0-9]{2,10}$/;
const NC = /^[0-9]{8}$/;
const LEDGER = /^[A-Z0-9_-]{2,20}$/;
const ACCOUNT = /^7[0-9]{2,7}$/;

export function validateProduct(input: ProductInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const sku = input.sku.trim().toUpperCase();
  if (!SKU.test(sku)) errors.sku = "El SKU usa mayúsculas, números, punto, guion o barra baja (2 a 40 caracteres).";
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) errors.name = "El nombre tiene que tener entre 2 y 120 caracteres.";
  const nameEn = input.name_en.trim();
  if (nameEn.length > 120) errors.name_en = "El nombre en inglés admite hasta 120 caracteres.";
  if (input.kind === "wine") {
    if (!input.wine_id) errors.wine_id = "Elige el vino.";
    if (!input.format_id) errors.format_id = "Elige el formato.";
  }
  if (input.kind === "bulk_wine" && !input.wine_id) errors.wine_id = "Elige el vino.";
  const vintage = input.vintage.trim();
  if (vintage) {
    if (!/^\d{4}$/.test(vintage) || Number(vintage) < 1990 || Number(vintage) > 2100) {
      errors.vintage = "La añada tiene que estar entre 1990 y 2100.";
    }
  }
  const gtin = gtinError(input.gtin, [8, 12, 13, 14]);
  if (gtin) errors.gtin = gtin;
  const gtinCase = gtinError(input.gtin_case, [14]);
  if (gtinCase) errors.gtin_case = "El GTIN de la caja tiene 14 dígitos y un dígito de control válido.";
  const nc = input.nc_code.trim();
  if (nc && !NC.test(nc)) errors.nc_code = "El código NC tiene 8 dígitos.";
  const ledger = input.excise_product_key.trim().toUpperCase();
  if (ledger && !LEDGER.test(ledger)) {
    errors.excise_product_key = "La referencia del mayor usa letras, números, guion o barra baja (2 a 20).";
  }
  const alcohol = input.alcohol_pct.trim();
  if (alcohol) {
    const parsed = normalizeDecimal(alcohol, 2);
    if (parsed.error || !parsed.value) errors.alcohol_pct = "El grado tiene como máximo 2 decimales.";
    else {
      const low = cmpDecimal(parsed.value, "0");
      const high = cmpDecimal(parsed.value, "25");
      if (low === null || high === null || low < 0 || high > 0) errors.alcohol_pct = "El grado tiene que estar entre 0 y 25.";
    }
  }
  const account = input.sales_account.trim();
  if (account && !ACCOUNT.test(account)) errors.sales_account = "La cuenta de ventas empieza por 7 y tiene de 3 a 8 dígitos.";
  return errors;
}

export function validateWine(input: WineInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const code = input.code.trim().toUpperCase();
  if (!WINE_CODE.test(code)) errors.code = "El código usa mayúsculas, números o guion (2 a 20).";
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) errors.name = "El nombre tiene que tener entre 2 y 120 caracteres.";
  if ((input.category === "pdo_wine" || input.category === "pgi_wine") && input.pdo_pgi_name.trim().length < 2) {
    errors.pdo_pgi_name = "Indica el nombre de la DOP o IGP.";
  }
  return errors;
}

export function validateFormat(input: FormatInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const code = input.code.trim().toUpperCase();
  if (!FORMAT_CODE.test(code)) errors.code = "El código usa mayúsculas y números (2 a 10).";
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) errors.name = "El nombre tiene que tener entre 2 y 120 caracteres.";
  const volume = positiveInt(input.nominal_volume_ml);
  if (volume == null) errors.nominal_volume_ml = "El volumen tiene que ser un entero mayor que 0.";
  if (positiveInt(input.units_per_case) == null) errors.units_per_case = "Las unidades por caja tienen que ser un entero mayor que 0.";
  if (positiveInt(input.cases_per_pallet) == null) errors.cases_per_pallet = "Las cajas por palet tienen que ser un entero mayor que 0.";
  const gross = optionalInt(input.unit_gross_weight_g);
  const net = optionalInt(input.unit_net_weight_g);
  if (input.unit_gross_weight_g.trim() && gross == null) errors.unit_gross_weight_g = "El peso bruto tiene que ser un entero mayor que 0.";
  if (input.unit_net_weight_g.trim() && net == null) errors.unit_net_weight_g = "El peso neto tiene que ser un entero mayor que 0.";
  if (gross != null && net != null && net > gross) errors.unit_net_weight_g = "El peso neto no puede superar al bruto.";
  return errors;
}

export function validatePrice(input: string): string | null {
  const parsed = normalizeDecimal(input, 4);
  if (parsed.error || !parsed.value) return parsed.error ?? "Indica un precio.";
  return null;
}

export function validateMinQty(input: string): string | null {
  const parsed = normalizeDecimal(input, 3);
  if (parsed.error || !parsed.value) return "El mínimo no es válido.";
  if (!isPositiveDecimal(parsed.value)) return "El mínimo tiene que ser mayor que 0.";
  return null;
}

function positiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const number = Number(trimmed);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return number;
}

function optionalInt(value: string): number | null {
  if (!value.trim()) return null;
  return positiveInt(value);
}
