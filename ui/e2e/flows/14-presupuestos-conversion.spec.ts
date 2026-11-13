import { expect, test } from "playwright/test";

function yearInMadrid(): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", year: "numeric" }).format(new Date());
}

test("Presupuestos: el listado va primero y el año en curso filtra la conversión", async ({ page }) => {
  const year = yearInMadrid();
  await page.goto("/ventas/presupuestos");
  await expect(page.getByRole("combobox", { name: "Año" })).toHaveValue(year);

  const list = page.locator('[data-book="quote"] table, [data-book="quote"] ul').first();
  const conversion = page.locator('[data-conversion="summary"]');
  await expect(list).toBeVisible();
  await expect(conversion).toBeVisible();
  const listBox = await list.boundingBox();
  const conversionBox = await conversion.boundingBox();
  expect(listBox && conversionBox && listBox.y < conversionBox.y).toBe(true);

  const response = await page.request.get(`/api/v1/quotes/conversion?from=${year}-01-01&to=${year}-12-31`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    summary: { quotes: number; bottles_budgeted: string; bottles_invoiced: string; conversion_bottles_pct: string | null };
    by_reference: { label: string }[];
  };

  await expect(page.locator("[data-conversion-quotes]")).toHaveAttribute("data-conversion-quotes", String(body.summary.quotes));
  await expect(page.locator("[data-conversion-bottles]")).toHaveAttribute("data-conversion-bottles", body.summary.bottles_budgeted);
  await expect(page.locator("[data-conversion-invoiced]")).toHaveAttribute("data-conversion-invoiced", body.summary.bottles_invoiced);
  await expect(page.locator('[data-conversion="breakdown"]')).toHaveCount(0);

  await page.locator("[data-conversion-quotes]").click();
  await expect(page.locator('[data-conversion="breakdown"]')).toBeVisible();
  const first = body.by_reference[0];
  if (first) {
    await expect(page.locator('[data-conversion="breakdown"]').getByRole("cell", { name: first.label, exact: true }).first()).toBeVisible();
  }

  await page.getByRole("radio", { name: "Convertido" }).click();
  await expect(page).toHaveURL(/status=converted/);
  const converted = await page.request.get(`/api/v1/quotes/conversion?from=${year}-01-01&to=${year}-12-31&status=converted`);
  expect(converted.ok()).toBe(true);
  const filtered = (await converted.json()) as { summary: { quotes: number } };
  await expect(page.locator("[data-conversion-quotes]")).toHaveAttribute("data-conversion-quotes", String(filtered.summary.quotes));
});
