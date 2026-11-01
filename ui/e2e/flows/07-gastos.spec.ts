import { expect, test } from "playwright/test";
import { pantalla } from "./support";

/** Una página en blanco: PDF válido y mínimo, sin binarios en el repositorio. */
function tinyPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

test("Gastos: capturar un PDF, completar, validar y aprobar", async ({ page }) => {
  await test.step("Abrir la captura", async () => {
    await page.goto("/gastos/capturar");
    await pantalla(page, "gastos-captura");
  });

  await test.step("Subir el PDF sintético", async () => {
    await page.locator("#captura-gasto").setInputFiles({
      name: "gasto-e2e.pdf",
      mimeType: "application/pdf",
      buffer: tinyPdf(),
    });
    await page.getByRole("button", { name: "Revisar" }).click();
    await page.waitForURL(/\/gastos\/[0-9a-f-]+$/i);
  });

  await test.step("Completar los datos que no leyó el OCR", async () => {
    const supplier = page.locator("#gasto-contacto");
    await supplier.waitFor();
    if ((await supplier.locator("option").count()) > 1) {
      await supplier.selectOption({ index: 1 });
    } else {
      await page.locator("#gasto-nombre").fill("Suministros Sinteticos SL");
      await page.locator("#gasto-nif").fill("B11111119");
    }
    await page.locator("#gasto-numero").fill(`F-E2E-${Date.now()}`);
    await page.locator('label[for="gasto-fecha"]').locator("xpath=..").getByRole("button").first().click();
    await page.getByRole("button", { name: "Hoy", exact: true }).click();
    await page.locator("#gasto-categoria").selectOption({ index: 1 });
    if (!(await page.locator("#linea-desc-0").isVisible())) {
      await page.getByRole("button", { name: "Añadir línea" }).click();
    }
    await page.locator("#linea-desc-0").fill("Metabisulfito de potasio sintetico");
    await page.locator("#linea-base-0").fill("48");
    await page.locator("#linea-iva-0").fill("21");
    await expect(page.locator("#gasto-total")).toHaveValue("58.08");
  });

  await test.step("Validar y aprobar el gasto", async () => {
    await page.getByRole("button", { name: "Validar" }).click();
    await page.getByRole("button", { name: "Aprobar" }).click();
    await expect(page.getByText("Aprobado").first()).toBeVisible();
  });
});
