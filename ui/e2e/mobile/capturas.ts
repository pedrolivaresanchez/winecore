/**
 * Capturas finales del móvil: 390x844 con densidad 2 (780x1688), una por pantalla y flujo, con
 * los datos sintéticos de e2e/mobile/seed.ts. Los nombres siguen `movil_<pantalla>_390.png`.
 *
 * Uso (con API y UI ya levantadas y sembradas):
 *   CAPTURAS_BASE=http://127.0.0.1:5261 CAPTURAS_API=http://127.0.0.1:3161 \
 *     CAPTURAS_OUT=/opt/cursor/artifacts/screenshots bun e2e/mobile/capturas.ts [expresion-regular]
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { MOBILE_CONTEXT } from "./measure";

const BASE = process.env.CAPTURAS_BASE ?? "http://127.0.0.1:5261";
const API = process.env.CAPTURAS_API ?? "http://127.0.0.1:3161";
const OUT = process.env.CAPTURAS_OUT ?? "/opt/cursor/artifacts/screenshots";
const CHROME = process.env.CHROME_PATH ?? "/usr/local/bin/google-chrome";
const FILTER = process.argv[2] ? new RegExp(process.argv[2]) : null;

// Respuestas JSON de la API sin esquema: solo se leen para localizar datos del seed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function get(pathname: string): Promise<Json> {
  const response = await fetch(`${API}/v1${pathname}`, { headers: { "x-dev-user": "owner@winecore.test" } });
  return response.ok ? ((await response.json()) as Json) : {};
}

async function first(pathname: string, pick: (item: Json) => boolean = () => true): Promise<Json | undefined> {
  return (((await get(pathname)).items ?? []) as Json[]).find(pick);
}

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => undefined);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(600);
}

/** Factura de papel dibujada con canvas, sin ningún dato real: pesa varios MB para que se comprima. */
async function fotoDeFactura(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 3200;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Sin canvas");
    context.fillStyle = "#6b6a66";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#f7f5ef";
    context.fillRect(180, 160, 2040, 2880);
    context.fillStyle = "#1d2430";
    context.font = "bold 120px sans-serif";
    context.fillText("FACTURA F-2026-0142", 280, 380);
    context.font = "70px sans-serif";
    context.fillText("Suministros Ejemplo S.L.", 280, 520);
    context.fillText("Calle Ejemplo 1, 00000 Ciudad", 280, 620);
    context.fillText("Fecha 01/11/2026", 280, 780);
    const filas: [string, string][] = [
      ["Botellas 75 cl x 600", "312,00"],
      ["Corchos x 600", "96,00"],
      ["Cápsulas x 600", "54,00"],
      ["Portes", "18,00"],
    ];
    filas.forEach(([concepto, importe], index) => {
      context.fillText(concepto, 280, 1040 + index * 150);
      context.fillText(importe, 1700, 1040 + index * 150);
    });
    context.font = "bold 90px sans-serif";
    context.fillText("Total con IVA", 280, 1900);
    context.fillText("580,80", 1650, 1900);
    const ruido = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < ruido.data.length; index += 4) {
      const delta = Math.floor(Math.random() * 14) - 7;
      ruido.data[index] += delta;
      ruido.data[index + 1] += delta;
      ruido.data[index + 2] += delta;
    }
    context.putImageData(ruido, 0, 0);
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Sin blob"))), "image/jpeg", 0.97),
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text = "";
    for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(text);
  });
  return Buffer.from(base64, "base64");
}

type Shot = { name: string; run: (page: Page) => Promise<void> };

async function elegirCliente(page: Page, nombre: string) {
  const cliente = page.getByRole("dialog").getByRole("combobox", { name: "Cliente" });
  await cliente.fill(nombre);
  await page.getByRole("listbox").getByRole("option").filter({ hasText: nombre }).first().tap();
}

async function elegirProducto(page: Page) {
  await page.getByRole("dialog").getByRole("combobox", { name: "Producto" }).first().click();
  const opcion = page.getByRole("listbox").getByRole("option").first();
  await opcion.waitFor();
  await opcion.tap();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const customer = await first("/contacts?role=customer&archived=false&limit=20", (item) => item.city);
  const quote = await first("/quotes?limit=5");
  const order = await first("/sales-orders?limit=5");
  const note = await first("/delivery-notes?limit=5");
  const invoices = ((await get("/invoices?limit=20")).items ?? []) as Json[];
  const draft = invoices.find((item) => item.status === "draft");
  const issued = invoices.find((item) => item.status === "issued");
  const expense = await first("/supplier-invoices?limit=20", (item) => item.status === "validated" || item.status === "approved");
  const captured = await first("/supplier-invoices?limit=20", (item) => item.status === "captured");
  const approval = await first("/approvals?limit=5");
  const count = await first("/inventory-counts?limit=5");
  const statement = await first("/bank-statements?limit=5");
  const product = await first("/products?limit=20", (item) => item.kind === "wine");
  const vessel = await first("/vessels?limit=100", (item) => item.kind === "tank_storage" && item.lot_id);
  const customerName = String((await first("/contacts?role=customer&archived=false&limit=20"))?.name ?? "");
  const full = await first("/vessels?limit=100", (item) => item.kind === "tank_storage" && item.lot_id && item.volume_ml >= 10_000);
  const empty = await first(
    "/vessels?limit=100",
    (item) => item.kind === "tank_storage" && !item.lot_id && item.volume_ml === 0 && item.capacity_ml >= 10_000,
  );

  const plain = (name: string, url: string): Shot => ({
    name,
    run: async (page) => {
      await page.goto(url);
      await settle(page);
    },
  });

  const ajustes = (name: string, area: string): Shot => ({
    name,
    run: async (page) => {
      await page.goto("/");
      await settle(page);
      await page.getByRole("button", { name: "Desplegar menú" }).first().click();
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: /Cuenta de/ }).first().click();
      await page.getByRole("menuitem", { name: "Ajustes" }).click();
      await page.waitForTimeout(600);
      if (area === "Cuenta") return;
      if ((await page.locator('[data-screen="rail"]').count()) === 0) await page.getByRole("button", { name: "Desplegar menú" }).first().click();
      await page.locator('[data-screen="rail"]').getByRole("button", { name: new RegExp(`^${area}`) }).first().click();
      await page.waitForTimeout(600);
    },
  });

  const shots: Shot[] = [
    plain("panel", "/"),
    {
      name: "menu",
      run: async (page) => {
        await page.goto("/");
        await settle(page);
        await page.getByRole("button", { name: "Desplegar menú" }).first().click();
        await page.waitForTimeout(600);
      },
    },
    {
      name: "paleta",
      run: async (page) => {
        await page.goto("/");
        await settle(page);
        await page.getByRole("button", { name: /^Buscar/ }).last().click();
        await page.keyboard.type("fact");
        await page.waitForTimeout(500);
      },
    },
    plain("facturas_lista", "/facturas"),
    {
      name: "factura_nueva",
      run: async (page) => {
        await page.goto("/facturas");
        await settle(page);
        await page.getByRole("button", { name: "Nueva factura" }).first().tap();
        await page.getByRole("dialog").waitFor();
        await elegirCliente(page, customerName);
        await elegirProducto(page);
        await page.getByRole("dialog").getByRole("textbox", { name: "Precio" }).fill("12,50");
        await page.waitForTimeout(500);
      },
    },
    draft ? plain("factura_borrador", `/facturas/${draft.id}`) : plain("factura_borrador", "/facturas"),
    issued ? plain("factura_emitida", `/facturas/${issued.id}`) : plain("factura_emitida", "/facturas"),
    plain("presupuestos", "/ventas/presupuestos"),
    quote ? plain("presupuesto_ficha", `/ventas/presupuestos/${quote.id}`) : plain("presupuesto_ficha", "/ventas/presupuestos"),
    plain("pedidos", "/ventas/pedidos"),
    order ? plain("pedido_ficha", `/ventas/pedidos/${order.id}`) : plain("pedido_ficha", "/ventas/pedidos"),
    plain("albaranes", "/ventas/albaranes"),
    note ? plain("albaran_ficha", `/ventas/albaranes/${note.id}`) : plain("albaran_ficha", "/ventas/albaranes"),
    plain("gastos", "/gastos"),
    plain("gasto_captura", "/gastos/capturar"),
    {
      name: "gasto_foto",
      run: async (page) => {
        await page.goto("/gastos/capturar");
        await settle(page);
        const foto = await fotoDeFactura(page);
        const subida = page.waitForResponse(
          (resp) => resp.request().method() === "POST" && new URL(resp.url()).pathname === "/api/v1/supplier-invoices/capture",
        );
        await page.locator("#captura-gasto").setInputFiles({ name: "factura-camara.jpg", mimeType: "image/jpeg", buffer: foto });
        await subida;
        await page.getByRole("img", { name: /Vista previa/ }).waitFor();
        await page.waitForTimeout(800);
      },
    },
    expense ? plain("gasto_ficha", `/gastos/${expense.id}`) : plain("gasto_ficha", "/gastos"),
    captured ? plain("gasto_capturado", `/gastos/${captured.id}`) : plain("gasto_capturado", "/gastos"),
    plain("aprobaciones", "/aprobaciones"),
    approval ? plain("aprobacion_detalle", `/aprobaciones/${approval.id}`) : plain("aprobacion_detalle", "/aprobaciones"),
    plain("plano", "/bodega/depositos?vista=plano"),
    {
      name: "plano_deposito",
      run: async (page) => {
        await page.goto("/bodega/depositos?vista=plano");
        await settle(page);
        await page.getByRole("button", { name: /^FERM-001/ }).first().tap();
        await page.getByRole("dialog").waitFor();
        await page.waitForTimeout(500);
      },
    },
    plain("depositos_lista", "/bodega/depositos?vista=lista"),
    vessel ? plain("deposito_ficha", `/bodega/depositos/${vessel.code}`) : plain("deposito_ficha", "/bodega/depositos"),
    {
      name: "trasiego",
      run: async (page) => {
        if (!full || !empty) throw new Error("El seed no deja un depósito con vino y otro vacío");
        await page.goto("/bodega/operaciones/nueva");
        await settle(page);
        await page.getByRole("button", { name: /Trasiego/ }).tap();
        await page.getByRole("button", { name: "Siguiente" }).tap();
        await page.getByRole("button", { name: new RegExp(`^${full.code}\\b`) }).tap();
        await page.locator("#input-0-volumen").fill("");
        await page.locator("#input-0-volumen").tap();
        const teclado = page.getByRole("group", { name: "Teclado numérico" });
        await teclado.getByRole("button", { name: "1", exact: true }).tap();
        await teclado.getByRole("button", { name: "0", exact: true }).tap();
        await page.waitForTimeout(500);
      },
    },
    plain("stock", "/stock"),
    {
      name: "stock_detalle",
      run: async (page) => {
        await page.goto("/stock");
        await settle(page);
        await page.locator('[data-grid-scroll] tbody tr').first().locator("td").nth(0).locator("span, div").last().tap();
        await page.waitForTimeout(800);
      },
    },
    plain("stock_movimientos", "/stock/movimientos"),
    plain("stock_aforos", "/stock/aforos"),
    count ? plain("stock_aforo_ficha", `/stock/aforos/${count.id}`) : plain("stock_aforo_ficha", "/stock/aforos"),
    plain("cobros", "/cobros"),
    {
      name: "cobro_registrar",
      run: async (page) => {
        await page.goto("/cobros");
        await settle(page);
        await page.getByRole("button", { name: "Registrar cobro" }).first().tap();
        await page.getByRole("dialog").waitFor();
        await page.waitForTimeout(500);
      },
    },
    plain("pagos", "/cobros?vista=pagos"),
    statement
      ? plain("conciliacion", `/cobros?vista=conciliacion&extracto=${statement.id}`)
      : plain("conciliacion", "/cobros?vista=conciliacion"),
    plain("contactos", "/contactos"),
    customer ? plain("contacto_ficha", `/contactos/${customer.id}`) : plain("contacto_ficha", "/contactos"),
    plain("catalogo", "/catalogo"),
    product ? plain("producto_ficha", `/catalogo/${product.id}`) : plain("producto_ficha", "/catalogo"),
    plain("tarifas", "/catalogo/tarifas"),
    plain("informes", "/informes"),
    ajustes("ajustes", "Cuenta"),
    ajustes("ajustes_sociedades", "Sociedades y numeración"),
    ajustes("ajustes_seguridad", "Seguridad"),
  ];

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  const done: string[] = [];
  const failed: string[] = [];
  for (const shot of shots) {
    if (FILTER && !FILTER.test(shot.name)) continue;
    const context = await browser.newContext({ ...MOBILE_CONTEXT, baseURL: BASE });
    const page = await context.newPage();
    try {
      await shot.run(page);
      const file = path.join(OUT, `movil_${shot.name}_390.png`);
      await page.screenshot({ path: file });
      done.push(file);
      console.log(`✓ ${shot.name}`);
    } catch (error) {
      failed.push(shot.name);
      console.log(`✗ ${shot.name}: ${(error as Error).message.split("\n")[0]}`);
    } finally {
      await context.close();
    }
  }
  await browser.close();
  console.log(`${done.length} capturas en ${OUT}; fallidas: ${failed.join(", ") || "ninguna"}`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
