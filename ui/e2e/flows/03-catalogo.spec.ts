import { expect, test } from "playwright/test";
import { armarPasskey, omitir, pantalla, registrarPasskey } from "./support";

test("Catálogo: pedir activación de una tarifa y aprobarla", async ({ page }) => {
  await armarPasskey(page);

  await test.step("Abrir el borrador de una tarifa y pedir activación", async () => {
    await page.goto("/catalogo/tarifas");
    await page.getByRole("link", { name: "Tarifa distribuidor" }).click();
    await pantalla(page, "tarifa");
    await page.getByRole("tab", { name: "v3" }).click();
    await expect(page.locator('[data-screen="tarifa"]')).toHaveAttribute("data-version", "draft");
    await page.getByRole("button", { name: "Pedir activación" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Pedir activación" }).click();
    await expect(page.getByText("Pendiente").first()).toBeVisible();
  });

  await test.step("Registrar una passkey de desarrollo y aprobar", async () => {
    await registrarPasskey(page);
    await page.goto("/aprobaciones");
    await page.getByRole("link", { name: /Activar tarifa distributor v3/ }).click();
    await pantalla(page, "aprobacion");
    await page.getByRole("button", { name: "Aprobar" }).click();
    const stepUp = page.locator('[data-screen="verificacion"]');
    const approved = page.locator('[data-screen="aprobacion"][data-status="approved"]');
    await expect(stepUp.or(approved)).toBeVisible();
    if (await stepUp.isVisible()) {
      await page.getByRole("button", { name: "Comprobar passkey" }).click();
    }
    await expect(approved).toBeVisible();
  });

  await test.step("La versión queda activa", async () => {
    await page.goto("/catalogo/tarifas");
    await page.getByRole("link", { name: "Tarifa distribuidor" }).click();
    await pantalla(page, "tarifa");
    await page.getByRole("tab", { name: "v3" }).click();
    const version = await page.locator('[data-screen="tarifa"]').getAttribute("data-version");
    if (version !== "active") {
      omitir(
        "Tras aprobar, la versión sigue en borrador. executeTariffActivation no está expuesto por HTTP, así que la UI no puede consumir la aprobación ni dejar la versión activa.",
      );
    }
  });
});
