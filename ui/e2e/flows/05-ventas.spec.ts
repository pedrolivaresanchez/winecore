import { expect, test } from "playwright/test";
import { omitir, writeState } from "./support";

const SIN_STOCK =
  "El seed de demostración no deja stock envasado (la inspección solo tiene granel, sin product_id) y no hay series de numeración para presupuesto, pedido, albarán ni factura. La UI no puede completar la venta.";

test("Ventas: presupuesto, pedido, albarán y factura con PDF", async ({ page }) => {
  let customer = "";

  await test.step("Crear un presupuesto", async () => {
    const customers = await page.request.get("/api/v1/contacts?role=customer&archived=false&limit=20");
    const items = ((await customers.json()) as { items: { legal_name: string; city: string | null; country_code: string }[] }).items;
    customer = items.find((item) => item.city && item.country_code === "ES")?.legal_name ?? "";
    if (!customer) omitir("El seed de demostración no trae clientes.");
    await page.goto("/ventas/presupuestos?libro=winecore");
    await page.getByRole("button", { name: "Nuevo presupuesto" }).click();
    await page.locator('[data-screen="ventas-dialogo"]').waitFor();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Cliente" }).fill(customer);
    await page.getByRole("listbox").getByRole("option").filter({ hasText: customer }).first().click();
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
    await page.locator('[data-screen="facturas-nueva"]').waitFor();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Cliente" }).fill(customer);
    await page.getByRole("listbox").getByRole("option").filter({ hasText: customer }).first().click();
    await dialog.getByRole("radio", { name: "Desde albaranes" }).click();
    const elsewhere = dialog.getByRole("button", { name: /^Hay \d+ en / });
    const note = dialog.getByRole("checkbox").first();
    await expect(note.or(elsewhere).first()).toBeVisible();
    if (await elsewhere.isVisible()) await elsewhere.click();
    await note.check();
    await dialog.getByRole("button", { name: "Crear borrador" }).click();
    await page.waitForURL(/\/facturas\/[0-9a-f-]+$/i);
    await page.getByRole("button", { name: "Emitir" }).click();
    const numbering = page.locator('[data-screen="numeracion-primera"]');
    const confirm = page.getByRole("dialog").getByRole("button", { name: "Emitir" });
    await expect(numbering.or(confirm).first()).toBeVisible();
    if (await numbering.isVisible()) {
      await expect(numbering.getByText(/^Primera factura de .+ en \d{4}: elige la numeración$/)).toBeVisible();
      await numbering.getByRole("radio", { name: /Empezar una serie nueva/ }).check();
      await numbering.getByRole("button", { name: "Usar esta numeración" }).click();
    }
    await confirm.click();
    await page.getByRole("tab", { name: "Envío" }).click();
    await expect(page.getByText("Pendiente de envío").first()).toBeVisible();
    await page.getByRole("tab", { name: "PDF" }).click();
    await expect(page.getByTitle("PDF")).toBeVisible();
    const number = (await page.locator("h1").first().textContent())?.trim() ?? "";
    writeState({ customerName: customer, invoiceNumber: number, deliveryNoteId: noteId });
  });
});
