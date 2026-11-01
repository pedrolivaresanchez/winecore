import { expect, test } from "playwright/test";
import { omitir, readState } from "./support";

test("Cobros: un cobro parcial actualiza el pendiente", async ({ page }) => {
  const state = readState();
  if (!state.invoiceNumber || !state.customerName) {
    omitir(
      "No hay factura emitida en esta corrida. El flujo de ventas no puede crearla: el seed no tiene stock envasado ni series de presupuesto, pedido, albarán y factura.",
    );
  }
  const customer = page.getByRole("region", { name: state.customerName, exact: true });
  const invoice = customer.getByRole("link", { name: new RegExp(state.invoiceNumber?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") ?? "") });
  const outstanding = invoice.locator("span").last();
  let before = "";

  await test.step("La factura aparece pendiente bajo su cliente", async () => {
    await page.goto("/cobros");
    await page.getByRole("searchbox", { name: /Buscar/ }).fill(state.invoiceNumber ?? "");
    await expect(invoice).toBeVisible();
    before = ((await outstanding.textContent()) ?? "").trim();
  });

  await test.step("Registrar un cobro parcial desde el cliente", async () => {
    await customer.getByRole("button", { name: "Cobrar" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("#cobro-cliente")).not.toHaveValue("");
    await dialog.locator("#cobro-importe").fill("1,00");
    const box = dialog.getByRole("checkbox").first();
    await expect(box).toBeVisible();
    await box.click();
    await dialog.getByRole("button", { name: "Registrar" }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step("El pendiente de esa factura baja", async () => {
    await expect(invoice).toBeVisible();
    await expect(outstanding).not.toHaveText(before);
    await expect(outstanding).not.toHaveText(/^\s*0,00/);
  });
});
