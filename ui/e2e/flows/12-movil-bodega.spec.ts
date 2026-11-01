import { expect, test, type Page } from "playwright/test";
import { datosMovil, MOVIL, sinDesborde } from "./movil";
import { pantalla } from "./support";

test.use(MOVIL);

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

async function abrirPrimeraFila(page: Page) {
  await page.locator("[data-grid-scroll] tbody tr").first().locator("td").first().locator("span, div").last().tap();
}

test("Móvil: abrir el plano de depósitos, un depósito y el modo edición", async ({ page }) => {
  await test.step("El plano cabe en 390 px", async () => {
    await page.goto("/bodega/depositos?vista=plano");
    await expect(page.locator('[data-screen^="bodega-plano"]').first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^FERM-001/ }).first()).toBeVisible();
    await sinDesborde(page, "plano de depósitos");
  });

  await test.step("Tocar un depósito abre su hoja con las acciones", async () => {
    await page.getByRole("button", { name: /^FERM-001/ }).first().tap();
    const hoja = page.getByRole("dialog");
    await expect(hoja).toBeVisible();
    await expect(hoja.getByText("Fermentador 01").first()).toBeVisible();
    await expect(hoja.getByRole("button", { name: "Nueva operación" })).toBeVisible();
    await sinDesborde(page, "hoja del depósito");
    await hoja.getByRole("button", { name: /^Cerrar/ }).tap();
    await expect(hoja).toBeHidden();
  });

  await test.step("El modo edición deja Guardar y Descartar a la vista", async () => {
    await page.getByRole("button", { name: "Editar", exact: true }).tap();
    await pantalla(page, "bodega-plano-editar");
    for (const nombre of ["Descartar", "Guardar"]) {
      const boton = page.getByRole("button", { name: nombre, exact: true });
      await expect(boton).toBeVisible();
      const caja = await boton.boundingBox();
      expect(caja, `${nombre} sin caja`).not.toBeNull();
      expect((caja?.x ?? 0) + (caja?.width ?? 0), `${nombre} se sale por la derecha`).toBeLessThanOrEqual(390);
    }
    await sinDesborde(page, "plano en edición");
    await page.getByRole("button", { name: "Descartar", exact: true }).tap();
  });
});

test("Móvil: trasiego entre depósitos (movimiento de stock)", async ({ page }) => {
  await datosMovil();
  let origen = "";
  let destino = "";
  let lote = "";

  await test.step("Elegir un depósito con vino y otro vacío", async () => {
    await page.goto("/bodega/operaciones/nueva");
    await pantalla(page, "bodega-operacion");
    await sinDesborde(page, "nueva operación");
    const respuesta = await page.request.get("/api/v1/vessels?limit=100");
    const items = ((await respuesta.json()) as { items: Vessel[] }).items;
    const tanques = items.filter(
      (item) => item.kind === "tank_storage" && item.material === "stainless_steel" && item.status === "in_service",
    );
    const lleno = tanques.find((item) => item.lot_id && item.volume_ml >= 10_000);
    const vacio = tanques.find((item) => !item.lot_id && item.volume_ml === 0 && item.capacity_ml >= 10_000);
    if (!lleno?.lot_code || !vacio) throw new Error("El seed no deja un depósito con vino y otro vacío");
    origen = lleno.code;
    destino = vacio.code;
    lote = lleno.lot_code;
  });

  let operacion = "";

  await test.step("Trasiego de 10 litros con el teclado de la pantalla", async () => {
    const creada = page.waitForResponse(
      (resp) =>
        resp.request().method() === "POST" && new URL(resp.url()).pathname === "/api/v1/cellar-operations" && resp.ok(),
    );
    await page.getByRole("button", { name: /Trasiego/ }).tap();
    await page.getByRole("button", { name: "Siguiente" }).tap();
    await sinDesborde(page, "orígenes del trasiego");
    await page.getByRole("button", { name: new RegExp(`^${origen}\\b`) }).tap();
    await page.locator("#input-0-volumen").fill("");
    await page.locator("#input-0-volumen").tap();
    const teclado = page.getByRole("group", { name: "Teclado numérico" });
    await expect(teclado).toBeVisible();
    await teclado.getByRole("button", { name: "1", exact: true }).tap();
    await teclado.getByRole("button", { name: "0", exact: true }).tap();
    await expect(page.locator("#input-0-volumen")).toHaveValue(/^10/);
    await sinDesborde(page, "origen con litros");
    await page.getByRole("button", { name: "Siguiente" }).tap();
    await page.getByRole("button", { name: new RegExp(`^${destino}\\b`) }).tap();
    await page.locator("#output-0-volumen").fill("");
    await page.locator("#output-0-volumen").tap();
    await teclado.getByRole("button", { name: "1", exact: true }).tap();
    await teclado.getByRole("button", { name: "0", exact: true }).tap();
    await sinDesborde(page, "destino con litros");
    await page.getByRole("button", { name: "Siguiente" }).tap();
    await page.getByRole("button", { name: "Siguiente" }).tap();
    await expect(page.locator('[data-step="revision"]')).toBeVisible();
    await expect(page.locator('[data-effects="server"]')).toContainText(origen);
    await sinDesborde(page, "revisión del trasiego");
    const borrador = (await (await creada).json()) as { id?: string };
    if (!borrador.id) throw new Error("El borrador no devolvió id");
    operacion = borrador.id;
  });

  await test.step("Abrir el borrador y confirmarlo", async () => {
    await page.goto(`/bodega/operaciones/${operacion}`);
    await pantalla(page, "bodega-operacion-ficha");
    await sinDesborde(page, "operación en borrador");
    await page.getByRole("button", { name: "Confirmar" }).tap();
    await pantalla(page, "bodega-vista-previa");
    await sinDesborde(page, "vista previa de la operación");
    await page.getByRole("dialog").getByRole("button", { name: "Confirmar" }).tap();
    await expect(page.getByText("Confirmada").first()).toBeVisible();
  });

  await test.step("El destino recibe el lote y existencias lo lista", async () => {
    const respuesta = await page.request.get("/api/v1/vessels?limit=100");
    const items = ((await respuesta.json()) as { items: Vessel[] }).items;
    const recibido = items.find((item) => item.code === destino);
    expect(recibido?.lot_code, "el destino no tiene el lote").toBe(lote);
    expect(recibido?.volume_ml, "el destino no recibió los 10 litros").toBe(10_000);

    await page.goto("/stock");
    const epoca = page.getByRole("button", { name: "Ver el 01/01/2027" });
    if (await epoca.isVisible().catch(() => false)) await epoca.tap();
    const buscador = page.getByRole("searchbox", { name: "Buscar lote, recipiente o vino" });
    await buscador.waitFor();
    await buscador.fill(lote);
    await expect(page.locator("[data-grid-scroll] tbody tr").first()).toBeVisible();
    await sinDesborde(page, "existencias tras el trasiego");
    await abrirPrimeraFila(page);
    await expect(page.getByRole("dialog").getByText(lote).first()).toBeVisible();
  });
});

test("Móvil: existencias deja ver litros y unidades y abre el detalle de la fila", async ({ page }) => {
  await page.goto("/stock");
  const epoca = page.getByRole("button", { name: "Ver el 01/01/2027" });
  if (await epoca.isVisible().catch(() => false)) await epoca.tap();
  await expect(page.locator("[data-grid-scroll] tbody tr").first()).toBeVisible();

  await test.step("Litros y unidades entran en la pantalla sin desplazar la tabla", async () => {
    for (const cabecera of ["Litros", "Unidades"]) {
      const celda = page.locator("[data-grid-scroll] thead th").filter({ hasText: cabecera }).first();
      await expect(celda, `falta la columna ${cabecera}`).toBeVisible();
      const caja = await celda.boundingBox();
      expect((caja?.x ?? 0) + 60, `${cabecera} empieza fuera de la pantalla`).toBeLessThanOrEqual(390);
    }
    await sinDesborde(page, "existencias");
  });

  await test.step("Tocar el recipiente abre la hoja con ubicación, lote y estado", async () => {
    await abrirPrimeraFila(page);
    const hoja = page.getByRole("dialog");
    await expect(hoja.getByText("Ubicación")).toBeVisible();
    await expect(hoja.getByText("Lote").first()).toBeVisible();
    await sinDesborde(page, "detalle de existencias");
  });
});

test("Móvil: contar una línea de un aforo y guardarla", async ({ page }) => {
  const datos = await datosMovil();
  test.skip(!datos.stockCountId, "El seed no dejó un aforo abierto.");

  await test.step("Abrir el aforo en recuento", async () => {
    await page.goto(`/stock/aforos/${datos.stockCountId}`);
    await expect(page.locator('[data-screen^="aforo"]')).toBeVisible();
    await sinDesborde(page, "aforo en recuento");
  });

  await test.step("Escribir lo contado y guardar", async () => {
    const campo = page.getByRole("textbox", { name: "Unidades contadas" }).first();
    await campo.scrollIntoViewIfNeeded();
    await campo.fill("100");
    await sinDesborde(page, "aforo con una línea contada");
    const guardado = page.waitForResponse(
      (resp) => resp.request().method() === "PUT" && /\/inventory-counts\/[^/]+\/lines$/.test(new URL(resp.url()).pathname),
    );
    await page.getByRole("button", { name: "Guardar", exact: true }).tap();
    expect((await guardado).ok()).toBe(true);
  });
});
