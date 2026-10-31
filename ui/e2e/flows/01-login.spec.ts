import { expect, test } from "playwright/test";
import { pantalla } from "./support";

test("Entrar con la sesión de desarrollo y ver el panel", async ({ page }) => {
  await test.step("Abrir WineCore: la API identifica al propietario sin Timbal", async () => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/$/);
    await pantalla(page, "panel");
  });

  await test.step("El panel muestra Aprobaciones para el propietario", async () => {
    await expect(page.getByRole("heading", { name: "Panel" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Aprobaciones" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Cuenta de owner@winecore.test" }).click();
    await expect(page.getByText("Propietario").first()).toBeVisible();
    await expect(page.getByText("owner@winecore.test").first()).toBeVisible();
  });
});
