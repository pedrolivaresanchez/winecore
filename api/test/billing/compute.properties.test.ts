/// <reference path="./bun-test.d.ts" />

import { describe, expect, it } from "bun:test";
import type Decimal from "decimal.js";
import { computeInvoice, type ComputeInvoiceInput, type ComputedInvoice } from "../../src/core/billing/compute";
import { halfUpDecimal, TAX_CODE_SEEDS, type TaxCode } from "../../src/core/billing/taxCodes";

const SEED = 20261031;
const RANDOM_CASES = 200;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function digits(rng: () => number, count: number): string {
  let text = "";
  for (let index = 0; index < count; index++) {
    text += String(Math.floor(rng() * 10));
  }
  return text;
}

function randomQty(rng: () => number): string {
  const negative = rng() < 0.25;
  const whole = Math.floor(rng() * 20);
  const frac = digits(rng, 3);
  if (whole === 0 && frac === "000") {
    return negative ? "-1.000" : "1.000";
  }
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

function randomPrice(rng: () => number): string {
  const whole = Math.floor(rng() * 500);
  return `${whole}.${digits(rng, 6)}`;
}

function randomDiscount(rng: () => number): string {
  const cents = Math.floor(rng() * 10001);
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  return `${whole}.${frac}`;
}

function randomIssueDate(rng: () => number): string {
  const year = 2024 + Math.floor(rng() * 5);
  const month = String(1 + Math.floor(rng() * 12)).padStart(2, "0");
  const day = String(1 + Math.floor(rng() * 28)).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function line(qty: string, unitPrice: string, discountPct: string, taxCode: TaxCode): ComputeInvoiceInput["lines"][number] {
  return {
    qty: new halfUpDecimal(qty),
    unitPrice: new halfUpDecimal(unitPrice),
    discountPct: new halfUpDecimal(discountPct),
    taxCode,
  };
}

function buildCases(): ComputeInvoiceInput[] {
  const fixed: ComputeInvoiceInput[] = [
    {
      issueDate: "2026-03-10",
      paymentTerms: { days: [30] },
      lines: TAX_CODE_SEEDS.map((taxCode) => line("2.000", "15.500000", "0.00", taxCode)),
    },
    {
      issueDate: "2027-03-28",
      paymentTerms: { days: [0] },
      lines: [line("-3.500", "80.000000", "10.00", TAX_CODE_SEEDS[2] ?? TAX_CODE_SEEDS[0])],
    },
    {
      issueDate: "2027-10-31",
      paymentTerms: { days: [45] },
      lines: [line("4.000", "9.990000", "0.00", TAX_CODE_SEEDS[0]), line("-1.500", "9.990000", "0.00", TAX_CODE_SEEDS[0])],
    },
  ];

  const rng = mulberry32(SEED);
  const random: ComputeInvoiceInput[] = [];
  for (let index = 0; index < RANDOM_CASES; index++) {
    const count = 2 + Math.floor(rng() * 4);
    const lines = [];
    for (let lineNo = 0; lineNo < count; lineNo++) {
      const taxCode = TAX_CODE_SEEDS[Math.floor(rng() * TAX_CODE_SEEDS.length)] ?? TAX_CODE_SEEDS[0];
      lines.push(line(randomQty(rng), randomPrice(rng), randomDiscount(rng), taxCode));
    }
    random.push({
      lines,
      paymentTerms: { days: [Math.floor(rng() * 181)] },
      issueDate: randomIssueDate(rng),
    });
  }
  return [...fixed, ...random];
}

const cases = buildCases();

function round2(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, halfUpDecimal.ROUND_HALF_UP);
}

function percentOf(base: Decimal, rate: Decimal): Decimal {
  return round2(new halfUpDecimal(base).mul(new halfUpDecimal(rate)).div("100"));
}

function fail(index: number, message: string): never {
  throw new Error(`caso ${index} (semilla ${SEED}): ${message}`);
}

function moneyText(value: Decimal): string {
  return value.toFixed(2);
}

function taxSnapshot(result: ComputedInvoice): string {
  return JSON.stringify({
    taxes: result.taxes.map((tax) => ({
      code: tax.taxCode.code,
      base: moneyText(tax.base),
      quota: moneyText(tax.quota),
      surcharge: moneyText(tax.surchargeQuota),
      withholding: moneyText(tax.withholding),
    })),
    subtotal: moneyText(result.subtotal),
    taxTotal: moneyText(result.taxTotal),
    surchargeTotal: moneyText(result.surchargeTotal),
    withholdingTotal: moneyText(result.withholdingTotal),
    importeTotal: moneyText(result.importeTotal),
    totalToPay: moneyText(result.totalToPay),
    dues: result.dues.map((due) => ({ dueDate: due.dueDate, amount: moneyText(due.amount) })),
  });
}

describe("computeInvoice", () => {
  it("importeTotal es subtotal más cuotas más recargo, y el total a pagar resta la retención", () => {
    cases.forEach((input, index) => {
      const result = computeInvoice(input);
      const importe = result.subtotal.plus(result.taxTotal).plus(result.surchargeTotal);
      if (!result.importeTotal.eq(importe)) {
        fail(index, `importeTotal ${moneyText(result.importeTotal)} != ${moneyText(importe)}`);
      }
      const payable = result.importeTotal.minus(result.withholdingTotal);
      if (!result.totalToPay.eq(payable)) {
        fail(index, `totalToPay ${moneyText(result.totalToPay)} != ${moneyText(payable)}`);
      }
      expect(result.importeTotal.eq(result.subtotal.plus(result.taxTotal).plus(result.surchargeTotal))).toBe(true);
    });
  });

  it("cada cuota es el redondeo de base por tipo, y lo mismo el recargo y la retención", () => {
    cases.forEach((input, index) => {
      const result = computeInvoice(input);
      let baseSum = new halfUpDecimal("0");
      let quotaSum = new halfUpDecimal("0");
      let surchargeSum = new halfUpDecimal("0");
      let withholdingSum = new halfUpDecimal("0");
      for (const tax of result.taxes) {
        const quota = percentOf(tax.base, tax.rate);
        const surcharge = percentOf(tax.base, tax.surchargeRate);
        const withholding = percentOf(tax.base, tax.withholdingRate);
        if (!tax.quota.eq(quota)) fail(index, `cuota ${tax.taxCode.code}`);
        if (!tax.surchargeQuota.eq(surcharge)) fail(index, `recargo ${tax.taxCode.code}`);
        if (!tax.withholding.eq(withholding)) fail(index, `retención ${tax.taxCode.code}`);
        baseSum = baseSum.plus(tax.base);
        quotaSum = quotaSum.plus(tax.quota);
        surchargeSum = surchargeSum.plus(tax.surchargeQuota);
        withholdingSum = withholdingSum.plus(tax.withholding);
      }
      if (!result.subtotal.eq(baseSum)) fail(index, "subtotal");
      if (!result.taxTotal.eq(quotaSum)) fail(index, "taxTotal");
      if (!result.surchargeTotal.eq(surchargeSum)) fail(index, "surchargeTotal");
      if (!result.withholdingTotal.eq(withholdingSum)) fail(index, "withholdingTotal");
    });
  });

  it("la suma de las bases de línea es el subtotal y la suma de vencimientos es el total a pagar", () => {
    cases.forEach((input, index) => {
      const result = computeInvoice(input);
      let lineSum = new halfUpDecimal("0");
      input.lines.forEach((inputLine, lineNo) => {
        const output = result.lines[lineNo];
        if (output === undefined) fail(index, `falta la línea ${lineNo}`);
        const qty = new halfUpDecimal(inputLine.qty);
        const unitPrice = new halfUpDecimal(inputLine.unitPrice);
        const discount = new halfUpDecimal(inputLine.discountPct);
        const expected = round2(qty.mul(unitPrice).mul(new halfUpDecimal("1").minus(discount.div("100"))));
        if (!output.lineBase.eq(expected)) fail(index, `base de la línea ${lineNo}`);
        lineSum = lineSum.plus(output.lineBase);
      });
      if (!result.subtotal.eq(lineSum)) fail(index, "suma de bases");

      let dueSum = new halfUpDecimal("0");
      for (const due of result.dues) {
        dueSum = dueSum.plus(due.amount);
      }
      if (!dueSum.eq(result.totalToPay)) fail(index, "vencimientos");
      if (result.dues.length !== 1) fail(index, "número de vencimientos");
    });
  });

  it("recalcular la factura devuelve el mismo desglose", () => {
    cases.forEach((input, index) => {
      const first = taxSnapshot(computeInvoice(input));
      const second = taxSnapshot(computeInvoice(input));
      if (first !== second) fail(index, "el segundo cálculo no coincide");
    });
  });

  it("el desglose no depende del orden de las líneas", () => {
    const rng = mulberry32(SEED ^ 0x9e3779b9);
    cases.forEach((input, index) => {
      const lines = [...input.lines];
      for (let cursor = lines.length - 1; cursor > 0; cursor--) {
        const swap = Math.floor(rng() * (cursor + 1));
        const current = lines[cursor];
        const other = lines[swap];
        if (current === undefined || other === undefined) fail(index, "barajado");
        lines[cursor] = other;
        lines[swap] = current;
      }
      const original = taxSnapshot(computeInvoice(input));
      const shuffled = taxSnapshot(computeInvoice({ ...input, lines }));
      if (original !== shuffled) fail(index, "el orden cambia el desglose");
    });
  });
});
