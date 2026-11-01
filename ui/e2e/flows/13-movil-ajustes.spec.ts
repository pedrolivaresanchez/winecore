import { expect, test, type Page } from "playwright/test";
import { MOVIL, sinDesborde } from "./movil";

test.use(MOVIL);

async function abrirAjustes(page: Page, area?: RegExp) {
  await page.goto("/");
  await page.getByRole("button", { name: "Desplegar menú" }).first().tap();
  await page.getByRole("button", { name: /Cuenta de/ }).first().tap();
  await page.getByRole("menuitem", { name: "Ajustes" }).tap();
  await expect(page.locator('[data-screen="ajustes"]')).toBeVisible();
  if (!area) return;
  if ((await page.locator('[data-screen="rail"]').count()) === 0) await page.getByRole("button", { name: "Desplegar menú" }).first().tap();
  await page.locator('[data-screen="rail"]').getByRole("button", { name: area }).first().tap();
}

test("Móvil: Ajustes se abre desde el menú y la lista cabe en 390 px", async ({ page }) => {
  await abrirAjustes(page);
  await sinDesborde(page, "lista de ajustes");
});

test("Móvil: Sociedades y numeración muestra las series en tarjetas con la acción a la vista", async ({ page }) => {
  await abrirAjustes(page, /^Sociedades/);
  const serie = page.locator('[data-screen="numeracion"] ul li').first();
  await expect(serie).toBeVisible();
  await sinDesborde(page, "sociedades y numeración");

  await test.step("Cada serie enseña su estado y «Dar de baja» sin desplazar", async () => {
    await expect(serie.getByText("Activa")).toBeVisible();
    const baja = serie.getByRole("button", { name: "Dar de baja" });
    await expect(baja).toBeVisible();
    const caja = await baja.boundingBox();
    expect((caja?.x ?? 0) + (caja?.width ?? 0), "«Dar de baja» se sale por la derecha").toBeLessThanOrEqual(390);
    expect(caja?.height ?? 0, "«Dar de baja» es más baja que un dedo").toBeGreaterThanOrEqual(36);
  });

  await test.step("El perfil de documentos se abre como hoja y cabe", async () => {
    await page.getByRole("button", { name: "Documentos" }).first().tap();
    const hoja = page.getByRole("dialog");
    await expect(hoja).toBeVisible();
    await expect(hoja.getByRole("button", { name: "Guardar" })).toBeVisible();
    await sinDesborde(page, "perfil de documentos");
    await hoja.getByRole("button", { name: "Cerrar" }).first().tap();
    await expect(hoja).toBeHidden();
  });
});

test("Móvil: Seguridad se abre sin desbordar", async ({ page }) => {
  await abrirAjustes(page, /^Seguridad/);
  await expect(page.getByRole("heading", { name: /Seguridad/ }).first()).toBeVisible();
  await sinDesborde(page, "seguridad");
});
