import Decimal from "decimal.js";
import {
  halfUpDecimal,
  type Exemption,
  type Qualification,
  type TaxCode,
  type TaxKind,
} from "./taxCodes";

/**
 * Pure invoice calculation (TASK-FACT-001).
 *
 * line base = half-up(qty × unitPrice × (1 − discount/100), 2)
 * Group by tax code. Quota, surcharge and withholding are
 * half-up(base × percent/100, 2) on the grouped base.
 * importeTotal = subtotal + taxTotal + surchargeTotal (Verifactu; withholding stays out).
 * totalToPay = importeTotal − withholdingTotal.
 * One due date = issue date + the single payment term, as a Europe/Madrid civil date.
 */

const MAX_TAX_BREAKDOWNS = 12;

const TAX_KINDS = new Set<TaxKind>(["01", "02", "03", "05"]);
const QUALIFICATIONS = new Set<Qualification>(["S1", "S2", "N1", "N2"]);
const EXEMPTIONS = new Set<Exemption>(["E1", "E2", "E3", "E4", "E5", "E6"]);

export interface InvoiceCalculationErrorOptions {
  readonly code?: string;
  readonly httpStatus?: number;
  readonly details?: unknown;
  readonly openQuestions?: readonly string[];
}

export class InvoiceCalculationError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: unknown;
  readonly openQuestions: readonly string[];

  constructor(message: string, options?: InvoiceCalculationErrorOptions) {
    super(message);
    this.name = "InvoiceCalculationError";
    this.code = options?.code ?? "WC_VALIDATION";
    this.httpStatus = options?.httpStatus ?? 422;
    this.details = options?.details;
    this.openQuestions = options?.openQuestions ?? [];
  }
}

export interface InvoiceLineInput {
  readonly qty: Decimal;
  readonly unitPrice: Decimal;
  readonly discountPct: Decimal;
  readonly taxCode: TaxCode;
}

export interface ComputeInvoiceInput {
  readonly lines: readonly InvoiceLineInput[];
  readonly paymentTerms: { readonly days: readonly number[] };
  readonly issueDate: string;
}

export interface ComputedLine {
  readonly qty: Decimal;
  readonly unitPrice: Decimal;
  readonly discountPct: Decimal;
  readonly taxCode: TaxCode;
  readonly lineBase: Decimal;
}

export interface TaxBreakdown {
  readonly taxCode: TaxCode;
  readonly base: Decimal;
  readonly rate: Decimal;
  readonly quota: Decimal;
  readonly surchargeRate: Decimal;
  readonly surchargeQuota: Decimal;
  readonly withholdingRate: Decimal;
  readonly withholding: Decimal;
}

export interface InvoiceDue {
  readonly dueDate: string;
  readonly amount: Decimal;
}

export interface ComputedInvoice {
  readonly lines: ComputedLine[];
  readonly taxes: TaxBreakdown[];
  readonly subtotal: Decimal;
  readonly taxTotal: Decimal;
  readonly surchargeTotal: Decimal;
  readonly withholdingTotal: Decimal;
  readonly importeTotal: Decimal;
  readonly totalToPay: Decimal;
  readonly dues: InvoiceDue[];
}

interface PreparedLine {
  readonly qty: Decimal;
  readonly unitPrice: Decimal;
  readonly discountPct: Decimal;
  readonly taxCode: TaxCode;
  readonly lineBase: Decimal;
}

interface TaxGroup {
  readonly taxCode: TaxCode;
  base: Decimal;
}

export function computeInvoice(input: ComputeInvoiceInput): ComputedInvoice {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new InvoiceCalculationError("La factura necesita al menos una línea.");
  }

  const prepared: PreparedLine[] = [];
  for (let index = 0; index < input.lines.length; index++) {
    prepared.push(prepareLine(input.lines[index], index + 1));
  }

  const groups = new Map<string, TaxGroup>();
  for (const line of prepared) {
    const code = line.taxCode.code;
    const existing = groups.get(code);
    if (existing === undefined) {
      groups.set(code, { taxCode: line.taxCode, base: line.lineBase });
      continue;
    }
    if (!sameTreatment(existing.taxCode, line.taxCode)) {
      throw new InvoiceCalculationError(
        `El código de impuesto ${code} no tiene el mismo tratamiento en todas las líneas.`,
      );
    }
    existing.base = existing.base.plus(line.lineBase);
  }

  if (groups.size > MAX_TAX_BREAKDOWNS) {
    throw new InvoiceCalculationError(
      `Hay ${groups.size} desgloses fiscales; Verifactu admite como máximo ${MAX_TAX_BREAKDOWNS}.`,
      { details: { breakdowns: groups.size, max: MAX_TAX_BREAKDOWNS } },
    );
  }

  const taxes = [...groups.values()]
    .sort((left, right) => compareCode(left.taxCode.code, right.taxCode.code))
    .map((group) => toBreakdown(group));

  const subtotal = sum(taxes.map((tax) => tax.base));
  const taxTotal = sum(taxes.map((tax) => tax.quota));
  const surchargeTotal = sum(taxes.map((tax) => tax.surchargeQuota));
  const withholdingTotal = sum(taxes.map((tax) => tax.withholding));
  const importeTotal = subtotal.plus(taxTotal).plus(surchargeTotal);
  const totalToPay = importeTotal.minus(withholdingTotal);
  const dueDate = addCalendarDays(input.issueDate, readPaymentTermDays(input.paymentTerms));

  return {
    lines: prepared,
    taxes,
    subtotal,
    taxTotal,
    surchargeTotal,
    withholdingTotal,
    importeTotal,
    totalToPay,
    dues: [{ dueDate, amount: totalToPay }],
  };
}

function prepareLine(line: InvoiceLineInput | undefined, lineNo: number): PreparedLine {
  if (line === undefined || line === null || typeof line !== "object") {
    throw new InvoiceCalculationError(`La línea ${lineNo} no es válida.`);
  }

  const qty = readAmount(line.qty, `La cantidad de la línea ${lineNo}`);
  if (qty.isZero()) {
    throw new InvoiceCalculationError(`La cantidad de la línea ${lineNo} no puede ser cero.`);
  }

  const unitPrice = readAmount(line.unitPrice, `El precio unitario de la línea ${lineNo}`);
  if (unitPrice.isNeg()) {
    throw new InvoiceCalculationError(`El precio unitario de la línea ${lineNo} no puede ser negativo.`);
  }

  const discountPct = readAmount(line.discountPct, `El descuento de la línea ${lineNo}`);
  if (discountPct.isNeg() || discountPct.gt("100")) {
    throw new InvoiceCalculationError(`El descuento de la línea ${lineNo} debe estar entre 0 y 100.`);
  }

  const taxCode = line.taxCode;
  assertTaxCode(taxCode, lineNo);

  const factor = new halfUpDecimal("1").minus(discountPct.div("100"));
  const lineBase = qty.mul(unitPrice).mul(factor).toDecimalPlaces(2, halfUpDecimal.ROUND_HALF_UP);

  return { qty, unitPrice, discountPct, taxCode, lineBase };
}

function readAmount(value: unknown, label: string): Decimal {
  if (!Decimal.isDecimal(value) || !value.isFinite()) {
    throw new InvoiceCalculationError(`${label} tiene que ser un Decimal finito.`);
  }
  return new halfUpDecimal(value);
}

function assertTaxCode(taxCode: TaxCode, lineNo: number): void {
  if (taxCode === null || typeof taxCode !== "object") {
    throw new InvoiceCalculationError(`La línea ${lineNo} no tiene código de impuesto.`);
  }
  if (typeof taxCode.code !== "string" || !/^[A-Z0-9_]{2,20}$/.test(taxCode.code)) {
    throw new InvoiceCalculationError(`El código de impuesto de la línea ${lineNo} no es válido.`);
  }
  const code = taxCode.code;
  if (!TAX_KINDS.has(taxCode.tax)) {
    throw new InvoiceCalculationError(`El código de impuesto ${code} tiene un impuesto no válido.`);
  }
  if (typeof taxCode.regimeKey !== "string" || !/^[0-9]{2}$/.test(taxCode.regimeKey)) {
    throw new InvoiceCalculationError(`El código de impuesto ${code} tiene una clave de régimen no válida.`);
  }

  const qualification = taxCode.qualification;
  const exemption = taxCode.exemption;
  if (qualification !== null && !QUALIFICATIONS.has(qualification)) {
    throw new InvoiceCalculationError(`El código de impuesto ${code} tiene una calificación no válida.`);
  }
  if (exemption !== null && !EXEMPTIONS.has(exemption)) {
    throw new InvoiceCalculationError(`El código de impuesto ${code} tiene una exención no válida.`);
  }
  if ((qualification === null) === (exemption === null)) {
    throw new InvoiceCalculationError(
      `El código de impuesto ${code} debe tener calificación o exención, solo una de las dos.`,
    );
  }

  const notSubject = qualification === "N1" || qualification === "N2";
  if (taxCode.exempt !== (exemption !== null)) {
    throw new InvoiceCalculationError(`La marca de exención del código ${code} no coincide con la exención.`);
  }
  if (taxCode.notSubject !== notSubject) {
    throw new InvoiceCalculationError(
      `La marca de no sujeción del código ${code} no coincide con la calificación.`,
    );
  }
  if (typeof taxCode.requiresVatId !== "boolean") {
    throw new InvoiceCalculationError(`El código de impuesto ${code} no indica si exige NIF-IVA.`);
  }

  const rate = readPercent(taxCode.rate, `El tipo del código ${code}`);
  readPercent(taxCode.surchargeRate, `El recargo del código ${code}`);
  readPercent(taxCode.withholdingRate, `La retención del código ${code}`);
  if ((exemption !== null || notSubject) && !rate.isZero()) {
    throw new InvoiceCalculationError(`El código de impuesto ${code} exento o no sujeto no puede llevar tipo.`);
  }
}

function readPercent(value: unknown, label: string): Decimal {
  if (!Decimal.isDecimal(value) || !value.isFinite()) {
    throw new InvoiceCalculationError(`${label} tiene que ser un Decimal finito.`);
  }
  const percent = new halfUpDecimal(value);
  if (percent.isNeg() || percent.gt("999.99")) {
    throw new InvoiceCalculationError(`${label} tiene que estar entre 0 y 999,99.`);
  }
  return percent;
}

function sameTreatment(left: TaxCode, right: TaxCode): boolean {
  return (
    left.tax === right.tax &&
    left.regimeKey === right.regimeKey &&
    left.qualification === right.qualification &&
    left.exemption === right.exemption &&
    left.exempt === right.exempt &&
    left.notSubject === right.notSubject &&
    left.requiresVatId === right.requiresVatId &&
    left.rate.eq(right.rate) &&
    left.surchargeRate.eq(right.surchargeRate) &&
    left.withholdingRate.eq(right.withholdingRate)
  );
}

function toBreakdown(group: TaxGroup): TaxBreakdown {
  const { taxCode, base } = group;
  const rate = new halfUpDecimal(taxCode.rate);
  const surchargeRate = new halfUpDecimal(taxCode.surchargeRate);
  const withholdingRate = new halfUpDecimal(taxCode.withholdingRate);
  return {
    taxCode,
    base,
    rate,
    quota: percentOf(base, rate),
    surchargeRate,
    surchargeQuota: percentOf(base, surchargeRate),
    withholdingRate,
    withholding: percentOf(base, withholdingRate),
  };
}

/** half-up(base × percent / 100, 2). Percent is a percentage point, not a fraction. */
function percentOf(base: Decimal, percent: Decimal): Decimal {
  return new halfUpDecimal(base)
    .mul(new halfUpDecimal(percent))
    .div("100")
    .toDecimalPlaces(2, halfUpDecimal.ROUND_HALF_UP);
}

function sum(values: readonly Decimal[]): Decimal {
  let total = new halfUpDecimal("0");
  for (const value of values) {
    total = total.plus(value);
  }
  return total;
}

function compareCode(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * The model defines one term: due date = issue date + payment_terms_days.
 * `days` is an array so the caller can pass that single number.
 * Several terms have no split rule in the spec, so they are rejected.
 */
function readPaymentTermDays(paymentTerms: ComputeInvoiceInput["paymentTerms"]): number {
  if (paymentTerms === null || typeof paymentTerms !== "object" || !Array.isArray(paymentTerms.days)) {
    throw new InvoiceCalculationError("Indica un plazo de pago en días.");
  }
  if (paymentTerms.days.length === 0) {
    throw new InvoiceCalculationError("Indica un plazo de pago en días.");
  }
  if (paymentTerms.days.length !== 1) {
    throw new InvoiceCalculationError("No está definido cómo repartir el total a pagar entre varios plazos.", {
      openQuestions: [
        "Cómo se reparte el total a pagar si hay más de un plazo. El modelo (§12.3) define un solo vencimiento, la fecha de emisión más los días del plazo, y payment_terms_days es un único número.",
      ],
    });
  }
  const days = paymentTerms.days[0];
  if (days === undefined || !Number.isSafeInteger(days) || days < 0) {
    throw new InvoiceCalculationError("El plazo de pago debe ser un número entero de días mayor o igual que cero.");
  }
  return days;
}

interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * Business dates are civil dates in Europe/Madrid (a calendar day, not an instant).
 * Adding days uses the Gregorian calendar and does not consult a time zone,
 * so the DST transitions do not move the due date.
 */
function addCalendarDays(issueDate: string, days: number): string {
  const start = parseCivilDate(issueDate);
  const shifted = civilFromDays(daysFromCivil(start.year, start.month, start.day) + days);
  if (!isRealCivilDate(shifted)) {
    throw new InvoiceCalculationError("La fecha de vencimiento no cabe en el calendario.");
  }
  return formatCivilDate(shifted);
}

function parseCivilDate(issueDate: string): CivilDate {
  if (typeof issueDate !== "string") {
    throw new InvoiceCalculationError("La fecha de emisión debe ser una fecha de calendario AAAA-MM-DD.");
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(issueDate);
  const yearText = match?.[1];
  const monthText = match?.[2];
  const dayText = match?.[3];
  if (yearText === undefined || monthText === undefined || dayText === undefined) {
    throw new InvoiceCalculationError("La fecha de emisión debe ser una fecha de calendario AAAA-MM-DD.");
  }
  const date = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
  };
  if (!isRealCivilDate(date)) {
    throw new InvoiceCalculationError("La fecha de emisión no existe en el calendario.");
  }
  return date;
}

function isRealCivilDate(date: CivilDate): boolean {
  if (!Number.isInteger(date.year) || date.year < 1 || date.year > 9999) return false;
  if (!Number.isInteger(date.month) || date.month < 1 || date.month > 12) return false;
  if (!Number.isInteger(date.day) || date.day < 1 || date.day > 31) return false;
  const back = civilFromDays(daysFromCivil(date.year, date.month, date.day));
  return back.year === date.year && back.month === date.month && back.day === date.day;
}

function formatCivilDate(date: CivilDate): string {
  const year = String(date.year).padStart(4, "0");
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Days since 1970-01-01 in the proleptic Gregorian calendar. */
function daysFromCivil(year: number, month: number, day: number): number {
  const shiftedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor((shiftedYear >= 0 ? shiftedYear : shiftedYear - 399) / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function civilFromDays(days: number): CivilDate {
  let z = days + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const yearBase = yearOfEra + era * 400;
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPart = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPart + 2) / 5) + 1;
  const month = monthPart + (monthPart < 10 ? 3 : -9);
  return { year: yearBase + (month <= 2 ? 1 : 0), month, day };
}
