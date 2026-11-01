import { expect, test } from "playwright/test";
import { pantalla } from "./support";

const LEGAL = "Bodega Sintetica E2E S.L.";
const TRADE = "Casa Sintetica";
const NIF = "B84729136";
const EMAIL = "pedidos-e2e@example.com";

test("Contactos: alta, edición, búsqueda y archivo", async ({ page }) => {
  await test.step("Crear una empresa con un NIF sintético", async () => {
    await page.goto("/contactos/nuevo");
    await pantalla(page, "contacto-nuevo");
    await page.locator("#legal_name").fill(LEGAL);
    await page.locator("#trade_name").fill("Casa");
    await page.locator("#tax_id").fill(NIF);
    await page.locator("#email").fill(EMAIL);
    await page.getByRole("button", { name: "Crear contacto" }).click();
    await pantalla(page, "contacto-preview");
    await expect(page.getByRole("heading", { name: LEGAL })).toBeVisible();
    await page.getByRole("button", { name: "Abrir ficha" }).click();
    await pantalla(page, "ficha");
    await expect(page.getByRole("heading", { name: LEGAL })).toBeVisible();
  });

  await test.step("Editar el nombre comercial", async () => {
    await page.getByRole("button", { name: "Editar" }).click();
    await page.locator("#trade_name").fill(TRADE);
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByRole("button", { name: "Editar" })).toBeVisible();
    await expect(page.getByText(TRADE).first()).toBeVisible();
  });

  await test.step("Buscar el contacto por el NIF", async () => {
    await page.goto("/contactos");
    await pantalla(page, "contactos");
    await page.locator("#buscar-contactos").fill(NIF);
    const row = page.getByRole("link", { name: LEGAL });
    await expect(row).toBeVisible();
    const href = await row.getAttribute("href");
    if (!href) throw new Error("La fila no enlaza la ficha");
    await page.goto(href);
    await pantalla(page, "ficha");
    await expect(page.getByText(TRADE).first()).toBeVisible();
  });

  await test.step("Archivar desde el menú de acciones", async () => {
    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menuitem", { name: "Archivar" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archivar" }).click();
    await expect(page.getByText("Archivado").first()).toBeVisible();
  });

  await test.step("La búsqueda activa ya no lo lista", async () => {
    await page.goto("/contactos");
    await pantalla(page, "contactos");
    await page.locator("#buscar-contactos").fill(NIF);
    await expect(page.getByRole("link", { name: LEGAL })).toHaveCount(0);
  });
});
