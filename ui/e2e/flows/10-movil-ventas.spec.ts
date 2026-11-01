import { expect, test, type Page } from "playwright/test";
import { datosMovil, MOVIL, sinDesborde } from "./movil";
import { pantalla } from "./support";

test.use(MOVIL);

async function elegirCliente(page: Page, nombre: string) {
  const dialog = page.getByRole("dialog");
  const cliente = dialog.getByRole("combobox", { name: "Cliente" });
  await cliente.fill(nombre);
  await page.getByRole("listbox").getByRole("option").filter({ hasText: nombre }).first().tap();
}

async function elegirProducto(page: Page) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Producto" }).first().click();
  const opcion = page.getByRole("listbox").getByRole("option").first();
  await opcion.waitFor();
  await opcion.tap();
}

test("Móvil: factura en borrador con una línea", async ({ page }) => {
  const datos = await datosMovil();

  await test.step("Abrir el alta de factura", async () => {
    await page.goto("/facturas");
    await sinDesborde(page, "lista de facturas");
    await page.getByRole("button", { name: "Nueva factura" }).first().tap();
    await pantalla(page, "facturas-nueva");
    await sinDesborde(page, "nueva factura");
  });

  await test.step("Cliente, producto y precio", async () => {
    await elegirCliente(page, datos.customerName);
    await elegirProducto(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Precio" }).fill("12,50");
    const motivo = dialog.getByRole("textbox", { name: /motivo/i });
    if (await motivo.isVisible().catch(() => false)) await motivo.fill("Precio de la prueba móvil");
    await sinDesborde(page, "nueva factura con una línea");
  });

  await test.step("Crear el borrador y verlo", async () => {
    const creada = page.waitForResponse(
      (respuesta) => respuesta.request().method() === "POST" && new URL(respuesta.url()).pathname === "/api/v1/invoices",
    );
    await page.getByRole("dialog").getByRole("button", { name: "Crear borrador" }).tap();
    expect((await creada).ok()).toBe(true);
    await page.waitForURL(/\/facturas\/[0-9a-f-]+$/i);
    await expect(page.getByText("Borrador").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Emitir" }).first()).toBeVisible();
    await sinDesborde(page, "factura en borrador");
  });
});

test("Móvil: presupuesto nuevo", async ({ page }) => {
  const datos = await datosMovil();

  await test.step("Abrir el alta", async () => {
    await page.goto("/ventas/presupuestos");
    await sinDesborde(page, "lista de presupuestos");
    await page.getByRole("button", { name: "Nuevo presupuesto" }).first().tap();
    await pantalla(page, "ventas-dialogo");
    await sinDesborde(page, "nuevo presupuesto");
  });

  await test.step("Rellenar y crear", async () => {
    await elegirCliente(page, datos.customerName);
    await elegirProducto(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Precio" }).fill("12");
    const motivo = dialog.getByRole("textbox", { name: /motivo/i });
    if (await motivo.isVisible().catch(() => false)) await motivo.fill("Precio de la prueba móvil");
    await sinDesborde(page, "presupuesto relleno");
    const creado = page.waitForResponse(
      (respuesta) => respuesta.request().method() === "POST" && new URL(respuesta.url()).pathname === "/api/v1/quotes",
    );
    await dialog.getByRole("button", { name: "Crear" }).tap();
    expect((await creado).ok()).toBe(true);
    await page.waitForURL(/\/ventas\/presupuestos\/[0-9a-f-]+/i);
    await sinDesborde(page, "ficha del presupuesto");
  });
});

test("Móvil: registrar un cobro", async ({ page }) => {
  await datosMovil();

  await test.step("Abrir los cobros pendientes", async () => {
    await page.goto("/cobros");
    await pantalla(page, "cobros-pendiente");
    await sinDesborde(page, "cobros pendientes");
  });

  await test.step("Cobrar a un cliente", async () => {
    await page.getByRole("button", { name: "Cobrar", exact: true }).first().tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await sinDesborde(page, "registrar cobro");
    await page.locator("#cobro-importe").fill("10,00");
    await page.getByRole("dialog").getByRole("textbox", { name: "Referencia" }).fill("Prueba móvil");
    const factura = page.getByRole("dialog").getByRole("checkbox").first();
    await factura.scrollIntoViewIfNeeded();
    await factura.tap();
    await expect(factura).toBeChecked();
    await sinDesborde(page, "cobro relleno");
  });

  await test.step("Registrar y ver el cobro", async () => {
    const registrado = page.waitForResponse(
      (respuesta) => respuesta.request().method() === "POST" && new URL(respuesta.url()).pathname === "/api/v1/payments",
    );
    await page.getByRole("dialog").getByRole("button", { name: "Registrar", exact: true }).tap();
    expect((await registrado).ok()).toBe(true);
    await expect(page.getByRole("dialog")).toBeHidden();
    await sinDesborde(page, "cobros tras registrar");
  });
});
