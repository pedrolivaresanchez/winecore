import { expect, test } from "playwright/test";

test("Facturas: la venta bodega se elige y se filtra por trimestre", async ({ page }) => {
  await page.goto("/facturas");
  await expect(page.getByRole("heading", { name: "Facturas" })).toBeVisible();
  await page.getByRole("button", { name: "Venta bodega" }).click();
  await page.getByRole("menuitemradio", { name: "2026 T4" }).click();
  await expect(page).toHaveURL(/cellar=2026-Q4/);

  await page.goto("/facturas/nueva");
  await page.locator('[data-screen="facturas-nueva"]').waitFor();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "CVPO" }).click();
  await expect(dialog.getByRole("radio", { name: "Venta bodega" })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Completa" })).toBeVisible();
});
