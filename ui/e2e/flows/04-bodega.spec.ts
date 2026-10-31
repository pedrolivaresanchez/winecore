import { expect, test } from "playwright/test";
import { pantalla, pulsarVisible } from "./support";

type Vessel = {
  code: string;
  kind: string;
  material: string;
  status: string;
  lot_id: string | null;
  lot_code: string | null;
  volume_ml: number;
  capacity_ml: number;
};

test("Bodega: trasiego en borrador, vista previa y confirmación", async ({ page }) => {
  let source = "";
  let dest = "";
  let lot = "";

  await test.step("Elegir origen con vino y destino vacío", async () => {
    await page.goto("/bodega/operaciones/nueva");
    await pantalla(page, "bodega-operacion");
    const payload = await page.evaluate(async () => {
      const response = await fetch("/api/v1/vessels?limit=100");
      return response.json() as Promise<{ items: Vessel[] }>;
    });
    const tanks = payload.items.filter(
      (item) => item.kind === "tank_storage" && item.material === "stainless_steel" && item.status === "in_service",
    );
    const full = tanks.find((item) => item.lot_id && item.volume_ml >= 10_000);
    const empty = tanks.find((item) => !item.lot_id && item.volume_ml === 0 && item.capacity_ml >= 10_000);
    if (!full?.lot_code || !empty) throw new Error("El seed no deja un depósito con vino y otro vacío");
    source = full.code;
    dest = empty.code;
    lot = full.lot_code;
  });

  await test.step("Guardar el borrador y ver la vista previa", async () => {
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/cellar-operations" &&
        response.ok(),
    );
    await page.getByRole("button", { name: /Trasiego/ }).click();
    await pulsarVisible(page, "Siguiente");
    await page.getByRole("button", { name: new RegExp(`^${source}\\b`) }).click();
    await page.locator("#input-0-volumen").fill("10");
    await pulsarVisible(page, "Siguiente");
    await page.getByRole("button", { name: new RegExp(`^${dest}\\b`) }).click();
    await page.locator("#output-0-volumen").fill("10");
    await pulsarVisible(page, "Siguiente");
    await pulsarVisible(page, "Siguiente");
    await expect(page.locator('[data-step="revision"]')).toBeVisible();
    await expect(page.locator('[data-effects="server"]')).toContainText(source);
    const draft = (await (await created).json()) as { id?: string };
    if (!draft.id) throw new Error("El borrador no devolvió id");
    await page.goto(`/bodega/operaciones/${draft.id}`);
    await pantalla(page, "bodega-operacion-ficha");
    await expect(page.getByText("Borrador").first()).toBeVisible();
  });

  await test.step("Confirmar desde la vista previa", async () => {
    await page.getByRole("button", { name: "Confirmar" }).click();
    await pantalla(page, "bodega-vista-previa");
    await expect(page.locator('[data-screen="bodega-vista-previa"]')).toContainText(source);
    await page.getByRole("dialog").getByRole("button", { name: "Confirmar" }).click();
    const failed = page.getByText("Error interno");
    const confirmed = page.getByText("Confirmada");
    await expect(failed.or(confirmed).first()).toBeVisible();
    if (await failed.isVisible()) {
      throw new Error("La confirmación devolvió un error interno");
    }
  });

  await test.step("El lote se ve en existencias físicas", async () => {
    await page.goto("/stock");
    await page.getByRole("button", { name: "Ver el 01/01/2027" }).click();
    await page.getByRole("radiogroup", { name: "Libro" }).waitFor();
    await page.getByRole("searchbox", { name: "Buscar lote, recipiente o vino" }).fill(lot);
    await expect(page.getByText(dest).first()).toBeVisible();
    await expect(page.getByText(lot).first()).toBeVisible();
  });
});
