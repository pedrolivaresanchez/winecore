import { expect, test } from "playwright/test";
import { pantalla } from "./support";

test("Valoración de existencias: tarifa, total y detalle", async ({ page }) => {
  await page.goto("/stock/valoracion");
  await pantalla(page, "stock-valoracion");
  await expect(page.getByRole("heading", { name: "Valoración de existencias" })).toBeVisible();
  const tariff = page.getByRole("combobox", { name: "Tarifa" });
  await expect(tariff).toBeVisible();
  await expect(tariff.locator("option")).toHaveCount(4);
  await expect(page.getByText("Total").first()).toBeVisible();
  await tariff.selectOption("final");
  await expect(page).toHaveURL(/tarifa=final/);
  await expect(page.getByText("PVP").first()).toBeVisible();
});

test.describe("móvil", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("La valoración cabe en el móvil y cambia de sección", async ({ page }) => {
    await page.goto("/stock/valoracion");
    await pantalla(page, "stock-valoracion");
    await expect(page.getByRole("combobox", { name: "Tarifa" })).toBeVisible();
    await page.getByRole("button", { name: "Valoración" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Existencias" }).click();
    await pantalla(page, "stock");
  });
});
