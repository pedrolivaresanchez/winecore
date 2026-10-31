import { expect, test } from "playwright/test";
import { pantalla } from "./support";

test.use({ viewport: { width: 390, height: 844 } });

test("Móvil: panel, bodega y gastos con el cajón", async ({ page }) => {
  async function abrirCajon() {
    await page.getByRole("button", { name: "Desplegar menú" }).click();
    await pantalla(page, "rail");
  }

  await test.step("El cajón abre el panel", async () => {
    await page.goto("/");
    await abrirCajon();
    await expect(page.getByText("Bodega").first()).toBeVisible();
    await page.getByRole("button", { name: "Panel" }).click();
    await pantalla(page, "panel");
  });

  await test.step("El cajón abre la bodega", async () => {
    await abrirCajon();
    await page.getByRole("button", { name: "Depósitos" }).click();
    await expect(page.locator('[data-screen^="bodega-"]')).toBeVisible();
  });

  await test.step("El cajón abre los gastos", async () => {
    await abrirCajon();
    await page.getByRole("button", { name: "Gastos" }).click();
    await expect(page.locator('[data-screen^="facturas-holded"], [data-screen="facturas-cargando"]')).toBeVisible();
  });
});
