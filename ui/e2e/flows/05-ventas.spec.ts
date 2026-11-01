import { expect, test } from "playwright/test";
import { omitir, writeState } from "./support";

const SIN_STOCK =
  "El seed de demostración no deja stock envasado (la inspección solo tiene granel, sin product_id) y no hay series de numeración para presupuesto, pedido, albarán ni factura. La UI no puede completar la venta.";

test("Ventas: presupuesto, pedido, albarán y factura con PDF", async ({ page }) => {
  let customer = "";

  await test.step("Crear un presupuesto", async () => {
    await page.goto("/ventas/presupuestos");
    await page.getByRole("button", { name: "Nuevo presupuesto" }).first().click();
    await page.locator('[data-screen="ventas-dialogo"]').waitFor();
    const dialog = page.getByRole("dialog");
    const customerBox = dialog.getByRole("combobox", { name: "Cliente" });
    await customerBox.click();
    const firstCustomer = page.getByRole("listbox").getByRole("option").first();
    await firstCustomer.waitFor();
    customer = ((await firstCustomer.locator("span").first().textContent()) ?? "").trim();
    await firstCustomer.click();
    const product = dialog.getByRole("combobox", { name: "Producto" });
    await product.click();
    const firstProduct = page.getByRole("listbox").getByRole("option").first();
    await firstProduct.waitFor();
    await firstProduct.click();
    const price = dialog.getByRole("textbox", { name: "Precio" });
    await price.fill("12");
    const reason = dialog.getByRole("textbox", { name: /motivo/i });
    if (await reason.isVisible().catch(() => false)) await reason.fill("Precio de la prueba");
    const created = page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/quotes",
    );
    await page.getByRole("dialog").getByRole("button", { name: "Crear" }).click();
    const response = await created;
    if (!response.ok()) {
      const text = await response.text();
      if (/serie|reglas activo|regla de entidad/i.test(text)) omitir(SIN_STOCK);
      throw new Error(text.slice(0, 400));
    }
    await page.waitForURL(/\/ventas\/presupuestos\/[0-9a-f-]+/i);
  });

  await test.step("Aceptar el presupuesto y confirmar el pedido", async () => {
    const accepted = page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/accept"),
    );
    await page.getByRole("button", { name: "Aceptar" }).click();
    const acceptance = await accepted;
    if (!acceptance.ok()) {
      const text = await acceptance.text();
      if (/serie/i.test(text)) omitir(SIN_STOCK);
      throw new Error(text.slice(0, 400));
    }
    await page.getByRole("button", { name: "Crear pedido" }).click();
    await page.waitForURL(/\/ventas\/pedidos\/[0-9a-f-]+/i);
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByRole("button", { name: "Crear albarán" })).toBeVisible();
  });

  await test.step("Emitir el albarán y sacar stock físico", async () => {
    await page.getByRole("button", { name: "Crear albarán" }).click();
    const lot = page.getByRole("dialog").getByRole("combobox").last();
    if ((await lot.locator("option").count()) < 2) omitir(SIN_STOCK);
    await lot.selectOption({ index: 1 });
    await page.getByRole("dialog").getByRole("button", { name: "Crear" }).click();
    await page.waitForURL(/\/ventas\/albaranes\/[0-9a-f-]+$/i);
    const noteId = page.url().split("/").pop() ?? "";
    await page.getByRole("button", { name: "Emitir" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Emitir" }).click();
    await expect(page.getByText("Emitido").first()).toBeVisible();
    writeState({ customerName: customer, deliveryNoteId: noteId });
  });

  await test.step("Facturar el albarán, emitir y abrir el PDF", async () => {
    const noteId = page.url().split("/").pop() ?? "";
    await page.goto("/facturas/nueva");
    await page.locator("#albaranes-factura").fill(noteId);
    await page.getByRole("button", { name: "Crear borrador" }).click();
    await page.waitForURL(/\/facturas\/[0-9a-f-]+$/i);
    await page.getByRole("button", { name: "Emitir" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Emitir" }).click();
    await page.getByRole("tab", { name: "Envío" }).click();
    await expect(page.getByText("Pendiente de envío").first()).toBeVisible();
    await page.getByRole("tab", { name: "PDF" }).click();
    await expect(page.getByTitle("PDF")).toBeVisible();
    const number = (await page.locator("h1").first().textContent())?.trim() ?? "";
    writeState({ customerName: customer, invoiceNumber: number, deliveryNoteId: noteId });
  });
});
