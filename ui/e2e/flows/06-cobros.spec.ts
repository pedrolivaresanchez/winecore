import { expect, test } from "playwright/test";
import { omitir, readState } from "./support";

test("Cobros: un cobro parcial actualiza el pendiente", async ({ page }) => {
  const state = readState();
  if (!state.invoiceNumber || !state.customerName) {
    omitir(
      "No hay factura emitida en esta corrida. El flujo de ventas no puede crearla: el seed no tiene stock envasado ni series de presupuesto, pedido, albarán y factura.",
    );
  }

  await test.step("Registrar un cobro parcial de la factura", async () => {
    await page.goto("/cobros");
    await page.getByRole("button", { name: "Registrar cobro" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#cobro-cliente").selectOption({ label: state.customerName ?? "" });
    await dialog.locator("#cobro-importe").fill("1,00");
    const box = dialog.getByRole("checkbox").first();
    await expect(box).toBeVisible();
    await box.click();
    await dialog.getByRole("button", { name: "Registrar" }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step("El pendiente de ese cliente baja", async () => {
    await page.getByRole("searchbox", { name: /Buscar/ }).fill(state.customerName ?? "");
    const row = page.getByRole("row", { name: state.customerName });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText(state.invoiceNumber ?? "---");
    const total = row.locator("td").last();
    await expect(total).not.toHaveText(/^\s*0,00/);
  });
});
