import { describe, expect, it } from 'bun:test';
import type { Decimal } from 'decimal.js';
import {
  computeInvoice,
  InvoiceCalculationError,
  type ComputedInvoice,
  type InvoiceLineInput,
  type TaxBreakdown,
} from '../../src/core/billing/compute';
import { money } from '../../src/core/money';
import {
  EXP_E2,
  INTRA_E5,
  IVA21,
  IVA21_ALQ,
  IVA21_RE,
  NS_LOC,
  type TaxCode,
} from '../../src/core/billing/taxCodes';

function dec(value: string): Decimal {
  return money.fromString(value);
}

function euros(value: Decimal): string {
  return money.toString(value);
}

function line(qty: string, unitPrice: string, discountPct: string, taxCode: TaxCode): InvoiceLineInput {
  return {
    qty: dec(qty),
    unitPrice: dec(unitPrice),
    discountPct: dec(discountPct),
    taxCode,
  };
}

function invoice(
  lines: readonly InvoiceLineInput[],
  days: readonly number[] = [30],
  issueDate = "2026-03-10",
): ComputedInvoice {
  return computeInvoice({ lines, paymentTerms: { days }, issueDate });
}

function tax(result: ComputedInvoice, code: string): TaxBreakdown {
  const found = result.taxes.find((item) => item.taxCode.code === code);
  if (found === undefined) {
    throw new Error(`falta el desglose ${code}`);
  }
  return found;
}

function subjectCode(code: string, rate: string): TaxCode {
  return {
    code,
    nameEs: "Tipo de prueba",
    tax: "01",
    regimeKey: "01",
    qualification: "S1",
    exemption: null,
    rate: dec(rate),
    surchargeRate: dec("0.00"),
    withholdingRate: dec("0.00"),
    exempt: false,
    notSubject: false,
    legalMentionEs: null,
    legalMentionEn: null,
    requiresVatId: false,
  };
}

function catchError(run: () => void): InvoiceCalculationError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(InvoiceCalculationError);
    if (error instanceof InvoiceCalculationError) return error;
  }
  throw new Error("la llamada debería haber fallado");
}

describe("computeInvoice", () => {
  it("las semillas de impuesto coinciden con el DDL → tipos, recargo, retención y marcas", () => {
    expect(IVA21.rate.toFixed(2)).toBe("21.00");
    expect(IVA21.surchargeRate.toFixed(2)).toBe("0.00");
    expect(IVA21.withholdingRate.toFixed(2)).toBe("0.00");
    expect(IVA21.qualification).toBe("S1");
    expect(IVA21.exemption).toBe(null);
    expect(IVA21.regimeKey).toBe("01");
    expect(IVA21.tax).toBe("01");
    expect(IVA21.exempt).toBe(false);
    expect(IVA21.notSubject).toBe(false);
    expect(IVA21.requiresVatId).toBe(false);

    expect(IVA21_RE.surchargeRate.toFixed(2)).toBe("5.20");
    expect(IVA21_RE.regimeKey).toBe("18");
    expect(IVA21_RE.qualification).toBe("S1");

    expect(IVA21_ALQ.withholdingRate.toFixed(2)).toBe("19.00");
    expect(IVA21_ALQ.regimeKey).toBe("11");

    expect(EXP_E2.exemption).toBe("E2");
    expect(EXP_E2.qualification).toBe(null);
    expect(EXP_E2.regimeKey).toBe("02");
    expect(EXP_E2.rate.toFixed(2)).toBe("0.00");
    expect(EXP_E2.exempt).toBe(true);
    expect(EXP_E2.notSubject).toBe(false);
    expect(EXP_E2.legalMentionEs).toBe("Operación exenta de IVA por exportación (art. 21 Ley 37/1992).");

    expect(INTRA_E5.exemption).toBe("E5");
    expect(INTRA_E5.requiresVatId).toBe(true);
    expect(INTRA_E5.exempt).toBe(true);
    expect(INTRA_E5.legalMentionEs).toBe("Entrega intracomunitaria exenta de IVA (art. 25 Ley 37/1992).");

    expect(NS_LOC.qualification).toBe("N2");
    expect(NS_LOC.exemption).toBe(null);
    expect(NS_LOC.notSubject).toBe(true);
    expect(NS_LOC.exempt).toBe(false);
    expect(NS_LOC.rate.toFixed(2)).toBe("0.00");
  });

  it("un solo tipo IVA21 → importe total 145,20 y vencimiento a 30 días", () => {
    // UI-13. line_base = round(12 × 10.00 × 1, 2) = 120.00
    // quota = round(120.00 × 21 / 100, 2) = 25.20
    // importeTotal = 120.00 + 25.20 + 0 = 145.20
    // totalToPay = 145.20 − 0 = 145.20
    // 2026-03-10 + 30 days = 2026-04-09 (21 days to 31 March, then 9 days)
    const qty = dec("12");
    const result = invoice([line("12", "10.00", "0", IVA21)]);

    expect(euros(result.lines[0]?.lineBase ?? dec("0"))).toBe("120.00");
    expect(qty.toString()).toBe("12");
    expect(result.taxes.length).toBe(1);
    expect(tax(result, "IVA21").taxCode).toBe(IVA21);
    expect(euros(tax(result, "IVA21").base)).toBe("120.00");
    expect(euros(tax(result, "IVA21").rate)).toBe("21.00");
    expect(euros(tax(result, "IVA21").quota)).toBe("25.20");
    expect(euros(tax(result, "IVA21").surchargeRate)).toBe("0.00");
    expect(euros(tax(result, "IVA21").surchargeQuota)).toBe("0.00");
    expect(euros(tax(result, "IVA21").withholding)).toBe("0.00");
    expect(euros(result.subtotal)).toBe("120.00");
    expect(euros(result.taxTotal)).toBe("25.20");
    expect(euros(result.surchargeTotal)).toBe("0.00");
    expect(euros(result.withholdingTotal)).toBe("0.00");
    expect(euros(result.importeTotal)).toBe("145.20");
    expect(euros(result.totalToPay)).toBe("145.20");
    expect(result.dues.length).toBe(1);
    expect(result.dues[0]?.dueDate).toBe("2026-04-09");
    expect(euros(result.dues[0]?.amount ?? dec("0"))).toBe("145.20");
  });

  it("varios tratamientos con el mismo 21 % no se mezclan → 209,10", () => {
    // IVA21: 100.00 × 21 % = 21.00
    // IVA21_RE: 50.00 × 21 % = 10.50; 50.00 × 5,2 % = 2.60
    // EXP_E2: 25.00 × 0 % = 0.00
    // subtotal 175.00; cuota 31.50; recargo 2.60
    // importeTotal = 175.00 + 31.50 + 2.60 = 209.10
    const result = invoice([
      line("2", "50.00", "0", IVA21),
      line("1", "50.00", "0", IVA21_RE),
      line("1", "25.00", "0", EXP_E2),
    ]);

    expect(result.taxes.map((item) => item.taxCode.code)).toEqual(["EXP_E2", "IVA21", "IVA21_RE"]);
    expect(euros(tax(result, "IVA21").base)).toBe("100.00");
    expect(euros(tax(result, "IVA21").quota)).toBe("21.00");
    expect(euros(tax(result, "IVA21_RE").quota)).toBe("10.50");
    expect(euros(tax(result, "IVA21_RE").surchargeQuota)).toBe("2.60");
    expect(euros(tax(result, "EXP_E2").quota)).toBe("0.00");
    expect(euros(result.subtotal)).toBe("175.00");
    expect(euros(result.taxTotal)).toBe("31.50");
    expect(euros(result.surchargeTotal)).toBe("2.60");
    expect(euros(result.withholdingTotal)).toBe("0.00");
    expect(euros(result.importeTotal)).toBe("209.10");
    expect(euros(result.totalToPay)).toBe("209.10");
  });

  it("recargo de equivalencia del 5,2 % → entra en el importe total", () => {
    // US-FACT-06. base 10 × 40.00 = 400.00
    // quota = round(400 × 21 / 100, 2) = 84.00
    // surcharge = round(400 × 5.2 / 100, 2) = 20.80
    // importeTotal = 400 + 84 + 20.80 = 504.80
    const result = invoice([line("10", "40.00", "0", IVA21_RE)]);
    expect(euros(tax(result, "IVA21_RE").surchargeRate)).toBe("5.20");
    expect(euros(tax(result, "IVA21_RE").surchargeQuota)).toBe("20.80");
    expect(euros(result.surchargeTotal)).toBe("20.80");
    expect(euros(result.importeTotal)).toBe("504.80");
    expect(euros(result.totalToPay)).toBe("504.80");
  });

  it("el recargo se redondea aparte de la cuota → 0,16 y no 0,15", () => {
    // base = 0.12
    // quota = round(0.12 × 21 / 100, 2) = round(0.0252, 2) = 0.03
    // surcharge = round(0.12 × 5.2 / 100, 2) = round(0.00624, 2) = 0.01
    // A single round of 26.2 % would be round(0.03144, 2) = 0.03. The spec rounds each one.
    // importeTotal = 0.12 + 0.03 + 0.01 = 0.16
    const result = invoice([line("1", "0.12", "0", IVA21_RE)]);
    expect(euros(tax(result, "IVA21_RE").quota)).toBe("0.03");
    expect(euros(tax(result, "IVA21_RE").surchargeQuota)).toBe("0.01");
    expect(euros(result.importeTotal)).toBe("0.16");
  });

  it("la retención del arrendamiento queda fuera del importe total → a pagar 1.020,00", () => {
    // US-FACT-06. base 1000.00
    // quota = 210.00; withholding = round(1000 × 19 / 100, 2) = 190.00
    // importeTotal = 1000 + 210 = 1210.00 (does not subtract withholding)
    // totalToPay = 1210.00 − 190.00 = 1020.00
    const result = invoice([line("1", "1000.00", "0", IVA21_ALQ)]);
    expect(euros(tax(result, "IVA21_ALQ").quota)).toBe("210.00");
    expect(euros(tax(result, "IVA21_ALQ").withholdingRate)).toBe("19.00");
    expect(euros(tax(result, "IVA21_ALQ").withholding)).toBe("190.00");
    expect(euros(result.withholdingTotal)).toBe("190.00");
    expect(euros(result.importeTotal)).toBe("1210.00");
    expect(euros(result.totalToPay)).toBe("1020.00");
    expect(euros(result.dues[0]?.amount ?? dec("0"))).toBe("1020.00");
  });

  it("la exportación exenta no lleva cuota → el importe total es la base", () => {
    // qty 6 × 15.50 = 93.00. Rate 0, so quota and surcharge are 0.
    // Verifactu §6 does not inform rate, quota or surcharge for OperacionExenta;
    // the formula still yields 0 and the exemption flag is E2.
    const result = invoice([line("6", "15.50", "0", EXP_E2)]);
    expect(tax(result, "EXP_E2").taxCode.exempt).toBe(true);
    expect(tax(result, "EXP_E2").taxCode.exemption).toBe("E2");
    expect(euros(tax(result, "EXP_E2").base)).toBe("93.00");
    expect(euros(tax(result, "EXP_E2").rate)).toBe("0.00");
    expect(euros(tax(result, "EXP_E2").quota)).toBe("0.00");
    expect(euros(tax(result, "EXP_E2").surchargeQuota)).toBe("0.00");
    expect(euros(result.taxTotal)).toBe("0.00");
    expect(euros(result.importeTotal)).toBe("93.00");
    expect(euros(result.totalToPay)).toBe("93.00");
  });

  it("la entrega intracomunitaria exenta no lleva cuota → 144,00", () => {
    // 3 × 48.00 = 144.00. Exemption E5, rate 0, quota 0.
    const result = invoice([line("3", "48.00", "0", INTRA_E5)]);
    expect(tax(result, "INTRA_E5").taxCode.requiresVatId).toBe(true);
    expect(tax(result, "INTRA_E5").taxCode.exemption).toBe("E5");
    expect(euros(tax(result, "INTRA_E5").base)).toBe("144.00");
    expect(euros(tax(result, "INTRA_E5").quota)).toBe("0.00");
    expect(euros(result.importeTotal)).toBe("144.00");
    expect(euros(result.taxTotal)).toBe("0.00");
  });

  it("una operación no sujeta por localización no lleva cuota → 160,00", () => {
    // 2 × 80.00 = 160.00. Qualification N2, rate 0.
    const result = invoice([line("2", "80.00", "0", NS_LOC)]);
    expect(tax(result, "NS_LOC").taxCode.notSubject).toBe(true);
    expect(euros(tax(result, "NS_LOC").rate)).toBe("0.00");
    expect(euros(tax(result, "NS_LOC").quota)).toBe("0.00");
    expect(euros(result.importeTotal)).toBe("160.00");
  });

  it("un descuento del 15 % baja la base antes del IVA → 123,42", () => {
    // round(12 × 10.00 × (1 − 15/100), 2) = round(102, 2) = 102.00
    // quota = round(102 × 0.21, 2) = 21.42
    // importeTotal = 123.42
    const result = invoice([line("12", "10.00", "15", IVA21)]);
    expect(euros(result.lines[0]?.lineBase ?? dec("0"))).toBe("102.00");
    expect(euros(result.taxTotal)).toBe("21.42");
    expect(euros(result.importeTotal)).toBe("123.42");
  });

  it("el descuento se redondea una sola vez sobre el producto → base 9,05", () => {
    // 10.05 × (1 − 10/100) = 9.045. The first discarded digit is 5, so half-up → 9.05.
    // Rounding the gross and the discount separately would give 10.05 − 1.01 = 9.04.
    // quota = round(9.05 × 0.21, 2) = round(1.9005, 2) = 1.90
    // importeTotal = 9.05 + 1.90 = 10.95
    const result = invoice([line("1", "10.05", "10", IVA21)]);
    expect(euros(result.lines[0]?.lineBase ?? dec("0"))).toBe("9.05");
    expect(euros(result.taxTotal)).toBe("1.90");
    expect(euros(result.importeTotal)).toBe("10.95");
  });

  it("un precio que acaba en 5 milésimas redondea la base al alza → 1,01", () => {
    // round(1.005, 2) = 1.01
    // quota = round(1.01 × 0.21, 2) = round(0.2121, 2) = 0.21
    // importeTotal = 1.22
    const result = invoice([line("1", "1.005", "0", IVA21)]);
    expect(euros(result.lines[0]?.lineBase ?? dec("0"))).toBe("1.01");
    expect(euros(result.taxTotal)).toBe("0.21");
    expect(euros(result.importeTotal)).toBe("1.22");
  });

  it("una cuota que acaba en 5 milésimas redondea al alza → 0,11", () => {
    // base 0.50 × 21 / 100 = 0.105 exactly → 0.11
    // importeTotal = 0.50 + 0.11 = 0.61
    const result = invoice([line("1", "0.50", "0", IVA21)]);
    expect(euros(tax(result, "IVA21").base)).toBe("0.50");
    expect(euros(tax(result, "IVA21").quota)).toBe("0.11");
    expect(euros(result.importeTotal)).toBe("0.61");
  });

  it("una cuota negativa que acaba en 5 milésimas se aleja de cero → −0,11", () => {
    // base −0.50 × 0.21 = −0.105 → −0.11
    // importeTotal = −0.61
    const result = invoice([line("-1", "0.50", "0", IVA21)]);
    expect(euros(tax(result, "IVA21").base)).toBe("-0.50");
    expect(euros(tax(result, "IVA21").quota)).toBe("-0.11");
    expect(euros(result.importeTotal)).toBe("-0.61");
    expect(euros(result.totalToPay)).toBe("-0.61");
  });

  it("la cuota sale de la base agrupada y no de redondear cada línea → 0,61", () => {
    // Each line base is 1.45. Per line, round(1.45 × 0.21, 2) = round(0.3045, 2) = 0.30,
    // and 0.30 + 0.30 = 0.60.
    // Grouped base 2.90 × 0.21 = 0.609 → 0.61.
    // importeTotal = 2.90 + 0.61 = 3.51
    const result = invoice([line("1", "1.45", "0", IVA21), line("1", "1.45", "0", IVA21)]);
    expect(result.taxes.length).toBe(1);
    expect(euros(tax(result, "IVA21").base)).toBe("2.90");
    expect(euros(tax(result, "IVA21").quota)).toBe("0.61");
    expect(euros(result.importeTotal)).toBe("3.51");
  });

  it("una retención que acaba en 5 milésimas redondea al alza → a pagar 10,71", () => {
    // base 10.50
    // quota = round(2.205, 2) = 2.21
    // withholding = round(1.995, 2) = 2.00
    // importeTotal = 12.71; totalToPay = 12.71 − 2.00 = 10.71
    const result = invoice([line("1", "10.50", "0", IVA21_ALQ)]);
    expect(euros(tax(result, "IVA21_ALQ").quota)).toBe("2.21");
    expect(euros(tax(result, "IVA21_ALQ").withholding)).toBe("2.00");
    expect(euros(result.importeTotal)).toBe("12.71");
    expect(euros(result.totalToPay)).toBe("10.71");
  });

  it("el producto exacto se redondea con más de 20 cifras significativas → …654,32", () => {
    // Both inputs fit the DDL widths. Q = 12345678901.005, P = 100000000 − 0.000001.
    // Q×P = Q×1e8 − Q×1e−6 = 1234567890100500000 − 12345.678901005
    //     = 1234567890100487654.321098995 → 1234567890100487654.32
    // quota = round(1234567890100487654.32 × 21 / 100, 2) = round(259259256921102407.4072, 2)
    //       = 259259256921102407.41
    // importeTotal = 1493827147021590061.73
    const result = invoice([line("12345678901.005", "99999999.999999", "0", IVA21)]);
    expect(euros(result.lines[0]?.lineBase ?? dec("0"))).toBe("1234567890100487654.32");
    expect(euros(result.taxTotal)).toBe("259259256921102407.41");
    expect(euros(result.importeTotal)).toBe("1493827147021590061.73");
  });

  it("una cantidad negativa invierte base y cuota → abono de 90,75", () => {
    // round(−4 × 18.75, 2) = −75.00
    // quota = round(−75 × 0.21, 2) = −15.75
    // importeTotal = −90.75
    const result = invoice([line("-4", "18.75", "0", IVA21)]);
    expect(euros(result.lines[0]?.lineBase ?? dec("0"))).toBe("-75.00");
    expect(euros(result.taxTotal)).toBe("-15.75");
    expect(euros(result.importeTotal)).toBe("-90.75");
    expect(euros(result.totalToPay)).toBe("-90.75");
    expect(euros(result.dues[0]?.amount ?? dec("0"))).toBe("-90.75");
  });

  it("un abono con recargo invierte también el recargo → −504,80", () => {
    // Mirror of the 400.00 equivalence-surcharge case.
    // quota −84.00; surcharge −20.80; importeTotal −504.80
    const result = invoice([line("-10", "40.00", "0", IVA21_RE)]);
    expect(euros(tax(result, "IVA21_RE").quota)).toBe("-84.00");
    expect(euros(tax(result, "IVA21_RE").surchargeQuota)).toBe("-20.80");
    expect(euros(result.importeTotal)).toBe("-504.80");
  });

  it("un abono de arrendamiento invierte la retención → a pagar −1.020,00", () => {
    // base −1000; quota −210; withholding −190
    // importeTotal = −1210; totalToPay = −1210 − (−190) = −1020
    const result = invoice([line("-1", "1000.00", "0", IVA21_ALQ)]);
    expect(euros(result.importeTotal)).toBe("-1210.00");
    expect(euros(result.withholdingTotal)).toBe("-190.00");
    expect(euros(result.totalToPay)).toBe("-1020.00");
  });

  it("líneas de signo distinto se agrupan antes de redondear → cuota 0,11", () => {
    // Bases 1.00 and −0.50. Grouped base 0.50 × 0.21 = 0.105 → 0.11.
    // Per line it would be 0.21 + (−0.11) = 0.10.
    // importeTotal = 0.61
    const result = invoice([line("1", "1.00", "0", IVA21), line("-1", "0.50", "0", IVA21)]);
    expect(euros(tax(result, "IVA21").base)).toBe("0.50");
    expect(euros(tax(result, "IVA21").quota)).toBe("0.11");
    expect(euros(result.importeTotal)).toBe("0.61");
    expect(euros(result.lines[0]?.lineBase ?? dec("0"))).toBe("1.00");
    expect(euros(result.lines[1]?.lineBase ?? dec("0"))).toBe("-0.50");
  });

  it("un descuento sobre una cantidad negativa reduce la base del abono → −18,15", () => {
    // round(−2 × 10 × (1 − 25/100), 2) = −15.00
    // quota = −3.15; importeTotal = −18.15
    const result = invoice([line("-2", "10.00", "25", IVA21)]);
    expect(euros(result.lines[0]?.lineBase ?? dec("0"))).toBe("-15.00");
    expect(euros(result.importeTotal)).toBe("-18.15");
  });

  it("un descuento del 100 % deja la base a cero y no falla", () => {
    // Issuing rejects a total of zero (§12.3). This function only calculates it.
    const result = invoice([line("2", "5.00", "100", IVA21)]);
    expect(euros(result.subtotal)).toBe("0.00");
    expect(euros(result.importeTotal)).toBe("0.00");
    expect(euros(result.totalToPay)).toBe("0.00");
    expect(euros(result.dues[0]?.amount ?? dec("1"))).toBe("0.00");
  });

  it("doce desgloses se calculan y las cuotas suman 0,78", () => {
    // Twelve codes, each base 1.00, rates 1 % … 12 %.
    // quota_i = i/100. Sum of 1..12 cents = 0.78.
    // importeTotal = 12.00 + 0.78 = 12.78
    const lines = Array.from({ length: 12 }, (_, index) => {
      const n = index + 1;
      const code = `R${String(n).padStart(2, "0")}`;
      return line("1", "1.00", "0", subjectCode(code, `${n}.00`));
    });
    const result = invoice(lines);
    expect(result.taxes.length).toBe(12);
    expect(euros(result.subtotal)).toBe("12.00");
    expect(euros(result.taxTotal)).toBe("0.78");
    expect(euros(result.importeTotal)).toBe("12.78");
    expect(euros(result.totalToPay)).toBe("12.78");
    expect(result.taxes.map((item) => item.taxCode.code)).toEqual(
      Array.from({ length: 12 }, (_, index) => `R${String(index + 1).padStart(2, "0")}`),
    );
  });

  it("trece líneas de doce códigos siguen dentro del límite → 12 desgloses", () => {
    const lines = Array.from({ length: 12 }, (_, index) => {
      const n = index + 1;
      return line("1", "1.00", "0", subjectCode(`R${String(n).padStart(2, "0")}`, "21.00"));
    });
    lines.push(line("1", "1.00", "0", subjectCode("R01", "21.00")));
    const result = invoice(lines);
    expect(result.taxes.length).toBe(12);
    expect(euros(tax(result, "R01").base)).toBe("2.00");
  });

  it("trece desgloses superan el máximo de Verifactu → error", () => {
    const lines = Array.from({ length: 13 }, (_, index) => {
      const n = index + 1;
      return line("1", "1.00", "0", subjectCode(`R${String(n).padStart(2, "0")}`, "21.00"));
    });
    const error = catchError(() => invoice(lines));
    expect(error.code).toBe("WC_VALIDATION");
    expect(error.httpStatus).toBe(422);
    expect(error.message).toBe("Hay 13 desgloses fiscales; Verifactu admite como máximo 12.");
    expect(error.details).toEqual({ breakdowns: 13, max: 12 });
    expect(error.openQuestions.length).toBe(0);
  });

  it("el orden de las líneas no cambia el desglose ni los totales", () => {
    const forward = [
      line("2", "40.00", "10", IVA21),
      line("1", "80.00", "0", EXP_E2),
      line("4", "25.50", "0", IVA21_ALQ),
      line("-1", "10.00", "0", IVA21),
    ];
    const backward = [...forward].reverse();
    const left = invoice(forward, [15], "2026-01-31");
    const right = invoice(backward, [15], "2026-01-31");

    expect(left.lines.map((item) => euros(item.lineBase))).toEqual(["72.00", "80.00", "102.00", "-10.00"]);
    expect(right.lines.map((item) => euros(item.lineBase))).toEqual(["-10.00", "102.00", "80.00", "72.00"]);
    expect(left.taxes.map((item) => item.taxCode.code)).toEqual(right.taxes.map((item) => item.taxCode.code));
    expect(left.taxes.map((item) => euros(item.base))).toEqual(right.taxes.map((item) => euros(item.base)));
    expect(left.taxes.map((item) => euros(item.quota))).toEqual(right.taxes.map((item) => euros(item.quota)));
    expect(euros(left.importeTotal)).toBe(euros(right.importeTotal));
    expect(euros(left.totalToPay)).toBe(euros(right.totalToPay));
    expect(left.dues[0]?.dueDate).toBe("2026-02-15");
    expect(right.dues[0]?.dueDate).toBe(left.dues[0]?.dueDate);
  });

  it("suma días de calendario, también en bisiesto y en los cambios de hora → fecha civil", () => {
    // 2026-01-31 + 30 = 2026-03-02 (2026 is not a leap year).
    // 2024-01-31 + 30 = 2024-03-01 (2024 is a leap year).
    // 2027-03-28 and 2027-10-31 are the DST transitions; the civil date still moves one day.
    const rows: readonly (readonly [string, number, string])[] = [
      ["2026-03-10", 30, "2026-04-09"],
      ["2026-01-31", 30, "2026-03-02"],
      ["2024-01-31", 30, "2024-03-01"],
      ["2024-02-29", 1, "2024-03-01"],
      ["2027-03-28", 1, "2027-03-29"],
      ["2027-10-31", 1, "2027-11-01"],
      ["2026-10-31", 0, "2026-10-31"],
      ["1900-02-28", 1, "1900-03-01"],
      ["2000-02-29", 1, "2000-03-01"],
      ["2026-01-01", 180, "2026-06-30"],
    ];
    for (const [issueDate, days, dueDate] of rows) {
      const result = invoice([line("1", "1.00", "0", IVA21)], [days], issueDate);
      expect(result.dues[0]?.dueDate).toBe(dueDate);
    }
  });

  it("cada día de 2024 a 2028 más 0, 1 o 30 coincide con el calendario gregoriano", () => {
    for (let year = 2024; year <= 2028; year++) {
      for (let month = 1; month <= 12; month++) {
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        for (let day = 1; day <= lastDay; day++) {
          for (const add of [0, 1, 30]) {
            const shifted = new Date(Date.UTC(year, month - 1, day + add));
            const expected = [
              String(shifted.getUTCFullYear()).padStart(4, "0"),
              String(shifted.getUTCMonth() + 1).padStart(2, "0"),
              String(shifted.getUTCDate()).padStart(2, "0"),
            ].join("-");
            const issueDate = [
              String(year).padStart(4, "0"),
              String(month).padStart(2, "0"),
              String(day).padStart(2, "0"),
            ].join("-");
            const result = invoice([line("1", "1.00", "0", IVA21)], [add], issueDate);
            if (result.dues[0]?.dueDate !== expected) {
              throw new Error(`${issueDate} + ${add} → ${result.dues[0]?.dueDate} en vez de ${expected}`);
            }
          }
        }
      }
    }
  });

  it("una fecha que no existe o no es AAAA-MM-DD → error", () => {
    for (const issueDate of ["2026-02-29", "2026-13-01", "2026-04-31", "10-03-2026", "2026/03/10", ""]) {
      const error = catchError(() => invoice([line("1", "1.00", "0", IVA21)], [30], issueDate));
      expect(error.code).toBe("WC_VALIDATION");
      expect(error.message.length > 0).toBe(true);
    }
  });

  it("sin líneas, cantidad cero, precio negativo o descuento fuera de rango → error", () => {
    const empty = catchError(() => invoice([]));
    expect(empty.message).toBe("La factura necesita al menos una línea.");

    const zero = catchError(() => invoice([line("0", "10.00", "0", IVA21)]));
    expect(zero.message).toBe("La cantidad de la línea 1 no puede ser cero.");

    const negativePrice = catchError(() => invoice([line("1", "-10.00", "0", IVA21)]));
    expect(negativePrice.message).toBe("El precio unitario de la línea 1 no puede ser negativo.");

    const discount = catchError(() => invoice([line("1", "10.00", "100.01", IVA21)]));
    expect(discount.message).toBe("El descuento de la línea 1 debe estar entre 0 y 100.");

    const numberAmount = catchError(() =>
      invoice([
        {
          qty: 12 as unknown as Decimal,
          unitPrice: dec("10"),
          discountPct: dec("0"),
          taxCode: IVA21,
        },
      ]),
    );
    expect(numberAmount.message).toBe("La cantidad de la línea 1 tiene que ser un Decimal finito.");
  });

  it("varios plazos no tienen reparto definido → error y pregunta abierta", () => {
    const error = catchError(() => invoice([line("1", "10.00", "0", IVA21)], [30, 60]));
    expect(error.message).toBe("No está definido cómo repartir el total a pagar entre varios plazos.");
    expect(error.openQuestions.length).toBe(1);
    expect(error.openQuestions[0]).toContain("un solo vencimiento");
  });

  it("sin plazo, plazo negativo o plazo fraccionario → error", () => {
    const missing = catchError(() => invoice([line("1", "10.00", "0", IVA21)], []));
    expect(missing.message).toBe("Indica un plazo de pago en días.");

    const negative = catchError(() => invoice([line("1", "10.00", "0", IVA21)], [-1]));
    expect(negative.message).toBe("El plazo de pago debe ser un número entero de días mayor o igual que cero.");

    const fraction = catchError(() => invoice([line("1", "10.00", "0", IVA21)], [1.5]));
    expect(fraction.message).toBe("El plazo de pago debe ser un número entero de días mayor o igual que cero.");
  });

  it("el mismo código con otro tipo → error", () => {
    const other = { ...IVA21, rate: dec("10.00") };
    const error = catchError(() => invoice([line("1", "10.00", "0", IVA21), line("1", "10.00", "0", other)]));
    expect(error.message).toBe("El código de impuesto IVA21 no tiene el mismo tratamiento en todas las líneas.");
  });

  it("una exención con tipo distinto de cero → error", () => {
    const broken: TaxCode = { ...EXP_E2, rate: dec("21.00") };
    const error = catchError(() => invoice([line("1", "10.00", "0", broken)]));
    expect(error.message).toBe("El código de impuesto EXP_E2 exento o no sujeto no puede llevar tipo.");
  });
});
