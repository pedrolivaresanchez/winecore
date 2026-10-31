# TASK-FACT-001 · Cálculo de la factura (`computeInvoice`)
- Hito M1 · 1,5 días · Escalado: sí (IVA)
- Historias / RNF: US-FACT-02, US-FACT-06
- Depende de: TASK-CORE-001

## Objetivo
Función pura que calcula líneas, desglose por tratamiento fiscal y tipo (redondeo por tipo, HALF_UP), recargo, retención, **importe total de la factura** (para Verifactu) y **total a pagar**, y vencimientos.

## Contexto
`02-modelo-dominio.md` §12.3 · `04-regulatorio/verifactu.md` §5–§6 · `billing.tax_code`.

## Ficheros
`api/src/core/billing/compute.ts`.

## Interfaz exacta
```ts
export function computeInvoice(input: { lines: { qty: Decimal; unitPrice: Decimal; discountPct: Decimal; taxCode: TaxCode }[]; paymentTerms: { days: number[] }; issueDate: string }): {
  lines: ComputedLine[]; taxes: { taxCode; base; rate; quota; surchargeRate; surchargeQuota; withholdingRate; withholding }[];
  subtotal: Decimal; taxTotal: Decimal; surchargeTotal: Decimal; withholdingTotal: Decimal;
  importeTotal: Decimal;   // subtotal + taxTotal + surchargeTotal (Verifactu)
  totalToPay: Decimal;     // importeTotal − withholdingTotal (billing.invoice.total)
  dues: { dueDate: string; amount: Decimal }[] }
```

## Criterios de aceptación
- `IVA21_ALQ`: retención del 19 % fuera de `importeTotal` y dentro de `totalToPay`.
- `IVA21_RE`: recargo 5,2 % en `taxes` y en `importeTotal`.
- Exentas (`EXP_E2`, `INTRA_E5`): sin tipo ni cuota.
- Máximo 12 desgloses (límite de Verifactu) → error si se supera.

## Tests requeridos
Tabla de casos (los de `11-tests.md` §5) y propiedades P-0x: suma de vencimientos = total a pagar; desglose recalculado = desglose guardado; independencia del orden de las líneas.
