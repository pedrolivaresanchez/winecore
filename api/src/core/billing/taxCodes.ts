import type { Decimal } from 'decimal.js';
import { money } from '../money';

export type TaxKind = "01" | "02" | "03" | "05";
export type Qualification = "S1" | "S2" | "N1" | "N2";
export type Exemption = "E1" | "E2" | "E3" | "E4" | "E5" | "E6";

/** One row of `billing.tax_code` (docs/02-ddl/0009_billing.sql). */
export interface TaxCode {
  readonly code: string;
  readonly nameEs: string;
  readonly tax: TaxKind;
  readonly regimeKey: string;
  readonly qualification: Qualification | null;
  readonly exemption: Exemption | null;
  /** Percent. Zero when the operation is exempt or not subject. */
  readonly rate: Decimal;
  /** Equivalence surcharge, percent. Zero when it does not apply. */
  readonly surchargeRate: Decimal;
  /** IRPF withholding, percent. Zero when there is no withholding. */
  readonly withholdingRate: Decimal;
  readonly exempt: boolean;
  readonly notSubject: boolean;
  readonly legalMentionEs: string | null;
  readonly legalMentionEn: string | null;
  readonly requiresVatId: boolean;
}

interface SeedInput {
  readonly code: string;
  readonly nameEs: string;
  readonly tax: TaxKind;
  readonly regimeKey: string;
  readonly qualification: Qualification | null;
  readonly exemption: Exemption | null;
  readonly rate: string;
  readonly surchargeRate: string;
  readonly withholdingRate: string;
  readonly legalMentionEs: string | null;
  readonly legalMentionEn: string | null;
  readonly requiresVatId: boolean;
}

function seed(input: SeedInput): TaxCode {
  return {
    code: input.code,
    nameEs: input.nameEs,
    tax: input.tax,
    regimeKey: input.regimeKey,
    qualification: input.qualification,
    exemption: input.exemption,
    rate: money.fromString(input.rate),
    surchargeRate: money.fromString(input.surchargeRate),
    withholdingRate: money.fromString(input.withholdingRate),
    exempt: input.exemption !== null,
    notSubject: input.qualification === "N1" || input.qualification === "N2",
    legalMentionEs: input.legalMentionEs,
    legalMentionEn: input.legalMentionEn,
    requiresVatId: input.requiresVatId,
  };
}

/** IVA general 21 %. */
export const IVA21: TaxCode = seed({
  code: "IVA21",
  nameEs: "IVA general 21 %",
  tax: "01",
  regimeKey: "01",
  qualification: "S1",
  exemption: null,
  rate: "21.00",
  surchargeRate: "0.00",
  withholdingRate: "0.00",
  legalMentionEs: null,
  legalMentionEn: null,
  requiresVatId: false,
});

/** IVA reducido 10 % (hostelería, catas). Migración 0045. */
export const IVA10: TaxCode = seed({
  code: "IVA10",
  nameEs: "IVA reducido 10 %",
  tax: "01",
  regimeKey: "01",
  qualification: "S1",
  exemption: null,
  rate: "10.00",
  surchargeRate: "0.00",
  withholdingRate: "0.00",
  legalMentionEs: null,
  legalMentionEn: null,
  requiresVatId: false,
});

/** IVA 21 % + recargo de equivalencia 5,2 %. */
export const IVA21_RE: TaxCode = seed({
  code: "IVA21_RE",
  nameEs: "IVA 21 % + recargo de equivalencia 5,2 %",
  tax: "01",
  regimeKey: "18",
  qualification: "S1",
  exemption: null,
  rate: "21.00",
  surchargeRate: "5.20",
  withholdingRate: "0.00",
  legalMentionEs: null,
  legalMentionEn: null,
  requiresVatId: false,
});

/** Arrendamiento de local: IVA 21 % + retención 19 %. */
export const IVA21_ALQ: TaxCode = seed({
  code: "IVA21_ALQ",
  nameEs: "Arrendamiento local IVA 21 % + ret. 19 %",
  tax: "01",
  regimeKey: "11",
  qualification: "S1",
  exemption: null,
  rate: "21.00",
  surchargeRate: "0.00",
  withholdingRate: "19.00",
  legalMentionEs: null,
  legalMentionEn: null,
  requiresVatId: false,
});

/** Exportación exenta (art. 21 LIVA), también Reino Unido y Canarias. */
export const EXP_E2: TaxCode = seed({
  code: "EXP_E2",
  nameEs: "Exportación exenta (art. 21 LIVA)",
  tax: "01",
  regimeKey: "02",
  qualification: null,
  exemption: "E2",
  rate: "0.00",
  surchargeRate: "0.00",
  withholdingRate: "0.00",
  legalMentionEs: "Operación exenta de IVA por exportación (art. 21 Ley 37/1992).",
  legalMentionEn: "VAT exempt export (Art. 21 Spanish VAT Act 37/1992).",
  requiresVatId: false,
});

/** Entrega intracomunitaria exenta (art. 25 LIVA). Exige NIF-IVA validado. */
export const INTRA_E5: TaxCode = seed({
  code: "INTRA_E5",
  nameEs: "Entrega intracomunitaria exenta (art. 25)",
  tax: "01",
  regimeKey: "01",
  qualification: null,
  exemption: "E5",
  rate: "0.00",
  surchargeRate: "0.00",
  withholdingRate: "0.00",
  legalMentionEs: "Entrega intracomunitaria exenta de IVA (art. 25 Ley 37/1992).",
  legalMentionEn:
    "VAT exempt intra-Community supply (Art. 25 Spanish VAT Act 37/1992; Art. 138 Directive 2006/112/EC).",
  requiresVatId: true,
});

/** No sujeta por reglas de localización. */
export const NS_LOC: TaxCode = seed({
  code: "NS_LOC",
  nameEs: "No sujeta por reglas de localización",
  tax: "01",
  regimeKey: "01",
  qualification: "N2",
  exemption: null,
  rate: "0.00",
  surchargeRate: "0.00",
  withholdingRate: "0.00",
  legalMentionEs: "Operación no sujeta al IVA español por reglas de localización.",
  legalMentionEn: "Not subject to Spanish VAT (place-of-supply rules).",
  requiresVatId: false,
});

/** Seed order of `0009_billing.sql`, then the codes added by later migrations. */
export const TAX_CODE_SEEDS = [IVA21, IVA21_RE, IVA21_ALQ, EXP_E2, INTRA_E5, NS_LOC, IVA10] as const;

export const TAX_CODES = {
  IVA21,
  IVA10,
  IVA21_RE,
  IVA21_ALQ,
  EXP_E2,
  INTRA_E5,
  NS_LOC,
} as const;

export type SeedTaxCodeId = keyof typeof TAX_CODES;
