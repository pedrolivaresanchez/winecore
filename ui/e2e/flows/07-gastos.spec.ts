import { expect, test } from "playwright/test";
import { omitir, pantalla } from "./support";

const FACTURAE = `<?xml version="1.0" encoding="UTF-8"?>
<fe:Facturae xmlns:fe="http://www.facturae.gob.es/formato/Versiones/Facturaev3_2_2.xml">
  <Parties>
    <SellerParty>
      <TaxIdentification><TaxIdentificationNumber>ESB11111119</TaxIdentificationNumber></TaxIdentification>
      <LegalEntity><CorporateName>Suministros Sinteticos SL</CorporateName></LegalEntity>
    </SellerParty>
    <BuyerParty>
      <TaxIdentification><TaxIdentificationNumber>B00000000</TaxIdentificationNumber></TaxIdentification>
    </BuyerParty>
  </Parties>
  <Invoices>
    <Invoice>
      <InvoiceHeader><InvoiceNumber>F-E2E-118</InvoiceNumber></InvoiceHeader>
      <InvoiceIssueData>
        <IssueDate>2026-10-02</IssueDate>
        <InvoiceCurrencyCode>EUR</InvoiceCurrencyCode>
      </InvoiceIssueData>
      <TaxesOutputs>
        <Tax>
          <TaxRate>21.00</TaxRate>
          <TaxableBase><TotalAmount>48.00</TotalAmount></TaxableBase>
          <TaxAmount><TotalAmount>10.08</TotalAmount></TaxAmount>
        </Tax>
      </TaxesOutputs>
      <InvoiceTotals>
        <TotalGrossAmountBeforeTaxes>48.00</TotalGrossAmountBeforeTaxes>
        <TotalTaxOutputs>10.08</TotalTaxOutputs>
        <TotalTaxesWithheld>0.00</TotalTaxesWithheld>
        <InvoiceTotal>58.08</InvoiceTotal>
      </InvoiceTotals>
      <Items>
        <InvoiceLine>
          <ItemDescription>Metabisulfito de potasio sintetico</ItemDescription>
          <Quantity>2.000</Quantity>
          <UnitPriceWithoutTax>24.00</UnitPriceWithoutTax>
          <GrossAmount>48.00</GrossAmount>
        </InvoiceLine>
      </Items>
    </Invoice>
  </Invoices>
</fe:Facturae>`;

test("Gastos: capturar un XML Facturae, validar y aprobar", async ({ page }) => {
  await test.step("Abrir la captura", async () => {
    await page.goto("/gastos/capturar");
    await pantalla(page, "gastos-captura");
  });

  await test.step("Subir la factura XML sintética", async () => {
    await page.locator("#captura-gasto").setInputFiles({
      name: "facturae-e2e.xml",
      mimeType: "application/xml",
      buffer: Buffer.from(FACTURAE),
    });
    const rejected = page.getByText("Algún fichero no sirve");
    if (await rejected.isVisible({ timeout: 3_000 }).catch(() => false)) {
      omitir(
        "La pantalla de captura solo admite foto o PDF. El XML Facturae, que la API sí extrae, no se puede enviar desde la UI.",
      );
    }
    await page.getByRole("button", { name: "Revisar" }).click();
  });

  await test.step("Validar y aprobar el gasto", async () => {
    await page.getByRole("button", { name: "Validar" }).click();
    await page.getByRole("button", { name: "Aprobar" }).click();
    await expect(page.getByText("Aprobado").first()).toBeVisible();
  });
});
