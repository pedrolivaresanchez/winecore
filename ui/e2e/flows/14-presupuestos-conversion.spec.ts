import { expect, test } from "playwright/test";

test("Presupuestos: el resumen de conversión coincide con el informe", async ({ page }) => {
  await page.goto("/ventas/presupuestos");
  await expect(page.locator('[data-conversion="summary"]')).toBeVisible();

  const response = await page.request.get("/api/v1/quotes/conversion");
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    summary: { quotes: number; bottles_budgeted: string; bottles_invoiced: string; conversion_bottles_pct: string | null };
    by_reference: { label: string }[];
  };

  await expect(page.locator("[data-conversion-quotes]")).toHaveAttribute("data-conversion-quotes", String(body.summary.quotes));
  await expect(page.locator("[data-conversion-bottles]")).toHaveAttribute("data-conversion-bottles", body.summary.bottles_budgeted);
  await expect(page.locator("[data-conversion-invoiced]")).toHaveAttribute("data-conversion-invoiced", body.summary.bottles_invoiced);
  await expect(page.locator('[data-conversion="breakdown"]')).toBeVisible();
  const first = body.by_reference[0];
  if (first) await expect(page.getByRole("cell", { name: first.label })).toBeVisible();

  await page.getByRole("radio", { name: "Convertido" }).click();
  await expect(page).toHaveURL(/status=converted/);
  const converted = await page.request.get("/api/v1/quotes/conversion?status=converted");
  expect(converted.ok()).toBe(true);
  const filtered = (await converted.json()) as { summary: { quotes: number } };
  await expect(page.locator("[data-conversion-quotes]")).toHaveAttribute("data-conversion-quotes", String(filtered.summary.quotes));
});
