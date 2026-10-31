import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { gtinWithCheck } from "../../src/pages/catalogo/gtin.ts";

const uiUrl = process.env.CATALOGO_UI_URL ?? "http://127.0.0.1:5173";
const apiUrl = process.env.CATALOGO_API_URL ?? "http://127.0.0.1:3000";
const outDir = "/opt/cursor/artifacts/screenshots";
const chromePath = "/usr/local/bin/google-chrome";

const viewports = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

type Product = {
  id: string;
  sku: string;
  name: string;
  kind: string;
  gtin: string | null;
  wine_id: string | null;
  vintage: number | null;
  format_id: string | null;
};

type Wine = { id: string; code: string; name: string };
type Format = { id: string; code: string; name: string };
type PriceList = { id: string; code: string; name: string; active_version: number | null };
type Version = { version: number; status: string; notes: string | null };

type Catalog = {
  products: Product[];
  wines: Wine[];
  formats: Format[];
  lists: PriceList[];
  sample: Product;
  missing: Product;
  other: Product;
  wine: Wine;
  format: Format;
  list: PriceList;
};

function gtin(seed: number): string {
  const code = gtinWithCheck(`840${String(seed % 1_000_000_000).padStart(9, "0")}`);
  if (!code) throw new Error(`GTIN no válido para ${seed}`);
  return code;
}

async function api<T>(pathname: string, init?: RequestInit, user = "owner@winecore.test"): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  headers.set("X-Dev-User", user);
  if (init?.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${apiUrl}${pathname}`, { ...init, headers });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as T & { code?: string; message?: string }) : ({} as T);
  if (!response.ok) {
    const body = json as { code?: string; message?: string };
    throw new Error(`${init?.method ?? "GET"} ${pathname} → ${response.status} ${body.code ?? ""} ${body.message ?? text}`);
  }
  return json;
}

async function loadCatalog(): Promise<Catalog> {
  const productsPage = await api<{ items: Product[]; total: number }>("/v1/products?limit=100");
  const winesPage = await api<{ items: Wine[] }>("/v1/wines?limit=100");
  const formatsPage = await api<{ items: Format[] }>("/v1/formats?limit=100");
  const listsPage = await api<{ items: PriceList[] }>("/v1/price-lists?limit=100");
  const products = productsPage.items;
  const wines = winesPage.items;
  const formats = formatsPage.items;
  const lists = listsPage.items;
  if (products.length < 2) throw new Error("El seed no tiene productos de catálogo");
  if (wines.length < 2) throw new Error("El seed no tiene vinos");
  if (formats.length < 1) throw new Error("El seed no tiene formatos");
  if (lists.length < 1) throw new Error("El seed no tiene tarifas");
  const sample = products.find((item) => item.gtin && item.wine_id && item.vintage != null && item.format_id);
  const missing = products.find((item) => !item.gtin && item.wine_id && item.vintage != null);
  const other = products.find((item) => missing && item.wine_id && item.wine_id !== missing.wine_id && item.id !== sample?.id);
  if (!sample || !missing || !other || !sample.wine_id || !sample.format_id) {
    throw new Error("El seed no cubre GTIN, datos que faltan y dos vinos");
  }
  const wine = wines.find((item) => item.id === missing.wine_id);
  const format = formats.find((item) => item.id === sample.format_id);
  const list = lists.find((item) => item.code === "distributor") ?? lists[0];
  if (!wine || !format || !list) throw new Error("El seed no enlaza vino, formato y tarifa");
  if (list.active_version == null) throw new Error(`La tarifa ${list.code} no publica active_version`);
  const versions = await api<{ items: Version[] }>(`/v1/price-lists/${list.id}/versions`);
  const statuses = new Set(versions.items.map((item) => item.status));
  if (!statuses.has("draft") || !statuses.has("active")) {
    throw new Error(`La tarifa ${list.code} no tiene borrador y versión activa`);
  }
  const prices = await api<{ items: { price_list_name?: string; name?: string; unit_price: string }[] }>(
    `/v1/products/${sample.id}/prices`,
  );
  if (prices.items.length === 0) throw new Error("El producto de muestra no tiene precios en la versión activa");
  const price = prices.items[0];
  if (!price?.price_list_name && !price?.name) throw new Error("El precio no trae el nombre de la tarifa");
  return { products, wines, formats, lists, sample, missing, other, wine, format, list };
}

function shown(page: Page, text: string) {
  return page.getByText(text).filter({ visible: true });
}

async function assertInView(page: Page, name: string) {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (extra > 1) throw new Error(`${name} se sale ${extra}px`);
}

async function shot(page: Page, name: string, width: number) {
  await page.waitForTimeout(250);
  const file = path.join(outDir, `real-catalogo-${name}-${width}.png`);
  await page.screenshot({ path: file });
  await assertInView(page, file);
  console.log(file);
}

async function gotoReady(page: Page, routePath: string, screen: string) {
  await page.goto(`${uiUrl}${routePath}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(`[data-screen="${screen}"]`, { timeout: 20_000 });
}

async function openContext(browser: Browser, viewport: { width: number; height: number }, user?: string) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    reducedMotion: "reduce",
    colorScheme: "light",
    extraHTTPHeaders: user ? { "X-Dev-User": user } : undefined,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return {
    page,
    async close() {
      if (errors.length > 0) throw new Error(errors.join(" | "));
      await context.close();
    },
  };
}

async function productTab(page: Page, width: number, id: "precios" | "existencias") {
  const label = id === "precios" ? "Precios" : "Existencias";
  if (width < 768) await page.locator("#producto-seccion").selectOption(id);
  else await page.getByRole("tab", { name: label, exact: true }).click();
}

async function openFilters(page: Page, width: number) {
  if (width >= 768) return;
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.waitForSelector("[data-screen='catalogo-filtros']");
}

async function runOwner(page: Page, width: number, catalog: Catalog) {
  const stamp = Date.now().toString(36).toUpperCase();
  const sku = `QA${width}${stamp}`.slice(0, 20);
  const duplicateSku = `QD${width}${stamp}`.slice(0, 20);
  const productName = `Cosecha prueba ${width}`;
  const editedName = `${productName} editada`;
  const wineCode = `W${stamp}`.slice(0, 20);
  const wineName = `Vino prueba ${width}`;
  const formatCode = `F${stamp}`.slice(0, 10);
  const formatName = `Formato prueba ${width}`;
  const unitGtin = gtin(Date.now());
  const duplicateGtin = gtin(Date.now() + 17);
  const usedVintages = new Set(
    catalog.products
      .filter((item) => item.wine_id === catalog.sample.wine_id && item.format_id === catalog.sample.format_id)
      .map((item) => item.vintage),
  );
  let vintage = width < 768 ? 2030 : 2060;
  while (usedVintages.has(vintage)) vintage += 1;

  await gotoReady(page, "/catalogo", "catalogo");
  await shown(page, catalog.sample.name).first().waitFor();
  await page.getByText(/\d+ productos/).filter({ visible: true }).first().waitFor();
  await shot(page, "lista", width);

  await page.getByRole("button", { name: "Granel", exact: true }).click();
  await shown(page, "Nada coincide con los filtros").first().waitFor();
  await page.getByRole("button", { name: "Vino", exact: true }).click();
  await openFilters(page, width);
  const wineSelect = page.locator(width < 768 ? "#filtro-vino-hoja" : "#filtro-vino");
  const vintageInput = page.locator(width < 768 ? "#filtro-anada-hoja" : "#filtro-anada");
  await wineSelect.selectOption(catalog.wine.id);
  await vintageInput.fill(String(catalog.missing.vintage));
  if (width < 768) await page.getByRole("button", { name: "Ver productos" }).click();
  await page.getByRole("button", { name: "GTIN", exact: true }).click();
  await shown(page, catalog.missing.name).first().waitFor();
  await shown(page, "Sin GTIN").first().waitFor();
  await expectHidden(page, catalog.other.name);
  await shot(page, "filtros", width);

  await gotoReady(page, "/catalogo", "catalogo");
  await page.locator("#buscar-productos").fill(catalog.sample.name);
  await shown(page, catalog.sample.sku).first().waitFor();
  await expectHidden(page, catalog.other.sku);
  await page.locator("#buscar-productos").fill(catalog.sample.sku);
  await shown(page, catalog.sample.name).first().waitFor();
  await page.locator("#buscar-productos").fill(catalog.sample.gtin ?? "");
  await shown(page, catalog.sample.sku).first().waitFor();
  await expectHidden(page, catalog.other.sku);
  await shot(page, "busqueda", width);

  await page.locator("#buscar-productos").fill("");
  await shown(page, catalog.other.name).first().waitFor();
  if (width < 768) {
    await page.getByRole("button", { name: /^Filtros/ }).click();
    const gtinColumn = page.locator("[data-screen='catalogo-filtros']").getByRole("button", { name: "GTIN", exact: true });
    await gtinColumn.waitFor();
    await gtinColumn.scrollIntoViewIfNeeded();
    await shot(page, "columnas", width);
    const before = await page.evaluate(() => localStorage.getItem("winecore.columns.products"));
    await gtinColumn.click();
    await page.waitForFunction((prev) => localStorage.getItem("winecore.columns.products") !== prev, before);
    await page.getByRole("button", { name: "Ver productos" }).click();
  } else {
    await page.getByRole("button", { name: "Columnas" }).click();
    await page.getByRole("menuitem", { name: "GTIN" }).waitFor();
    await shot(page, "columnas", width);
    await page.getByRole("menuitem", { name: "GTIN" }).click();
    await page.keyboard.press("Escape");
    const gtinHeader = page.getByRole("columnheader", { name: "GTIN", exact: true });
    await gtinHeader.scrollIntoViewIfNeeded();
    await gtinHeader.waitFor();
  }

  const first = catalog.products[0];
  const second = catalog.products[1];
  if (!first || !second) throw new Error("Hacen falta dos productos para el preview");
  await gotoReady(page, "/catalogo", "catalogo");
  await shown(page, first.name).first().waitFor();
  if (width < 768) await page.getByRole("button", { name: first.name }).first().click();
  else await page.getByRole("row", { name: first.name }).first().getByText(first.name, { exact: true }).click();
  await page.waitForSelector("[data-screen='producto-preview']");
  await page.getByRole("link", { name: "Abrir ficha" }).waitFor();
  await page.getByRole("heading", { name: first.name }).waitFor();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("heading", { name: second.name }).waitFor();
  await shot(page, "preview", width);
  await page.getByRole("button", { name: "Anterior" }).click();
  await page.getByRole("heading", { name: first.name }).waitFor();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Nuevo producto", exact: true }).click();
  await page.waitForSelector("[data-screen='producto-alta']");
  await page.locator("#sku").fill(sku);
  await page.locator("#name").fill(productName);
  await page.locator("#wine_id").selectOption(catalog.sample.wine_id ?? "");
  await page.locator("#vintage").fill(String(vintage));
  await page.locator("#format_id").selectOption(catalog.sample.format_id ?? "");
  await page.locator("#gtin").fill(unitGtin);
  await page.locator("#sku").scrollIntoViewIfNeeded();
  await shot(page, "alta", width);
  await page.getByRole("button", { name: "Crear producto" }).click();
  await page.waitForSelector("[data-screen='producto']");
  await shown(page, productName).first().waitFor();
  const createdId = page.url().split("/").pop() ?? "";

  await gotoReady(page, "/catalogo", "catalogo");
  await page.getByRole("button", { name: "Nuevo producto", exact: true }).click();
  await page.locator("#sku").fill(duplicateSku);
  await page.locator("#name").fill("Copia que no debe crearse");
  await page.locator("#wine_id").selectOption(catalog.sample.wine_id ?? "");
  await page.locator("#vintage").fill(String(catalog.sample.vintage));
  await page.locator("#format_id").selectOption(catalog.sample.format_id ?? "");
  await page.locator("#gtin").fill(duplicateGtin);
  await page.getByRole("button", { name: "Crear producto" }).click();
  await page.locator("#duplicate-product").waitFor();
  await shown(page, "Ya existe.").first().waitFor();
  await shown(page, catalog.sample.name).first().waitFor();
  await shot(page, "duplicado", width);
  await page.getByRole("button", { name: "Cerrar" }).click();

  await gotoReady(page, `/catalogo/${catalog.sample.id}`, "producto");
  await shown(page, catalog.sample.sku).first().waitFor();
  await page.getByRole("button", { name: "Editar" }).waitFor();
  await shot(page, "producto", width);
  await productTab(page, width, "precios");
  await shown(page, "Precios vigentes").first().waitFor();
  await shown(page, "€").first().waitFor();
  await shot(page, "precios", width);
  await productTab(page, width, "existencias");
  await shown(page, "El stock por almacén aparecerá cuando se active Existencias").first().waitFor();
  await shot(page, "existencias", width);

  await gotoReady(page, `/catalogo/${createdId}`, "producto");
  await page.getByRole("button", { name: "Editar" }).click();
  await page.locator("#name").fill(editedName);
  await shot(page, "editar", width);
  await page.getByRole("button", { name: "Guardar" }).click();
  await shown(page, "Cambios guardados").first().waitFor();
  await shown(page, editedName).first().waitFor();
  await page.getByText("Cambios guardados").first().waitFor({ state: "hidden", timeout: 8_000 });
  const current = await api<{ updated_at: string }>(`/v1/products/${createdId}`);
  await page.getByRole("button", { name: "Editar" }).click();
  await page.locator("#name").waitFor();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await api(`/v1/products/${createdId}`, {
    method: "PATCH",
    headers: { "If-Match": current.updated_at },
    body: JSON.stringify({ name_en: "Stale check" }),
  });
  await page.locator("#name").fill(`${editedName} tarde`);
  await page.getByRole("button", { name: "Guardar" }).click();
  await shown(page, "WC_STALE_VERSION").first().waitFor();
  await shot(page, "obsoleto", width);

  await gotoReady(page, "/catalogo/vinos", "vinos");
  await shown(page, catalog.wine.name).first().waitFor();
  await shot(page, "vinos", width);
  await page.getByRole("button", { name: "Nuevo vino", exact: true }).click();
  await page.waitForSelector("[data-screen='vino-alta']");
  await page.locator("#wine_code").fill(wineCode);
  await page.locator("#wine_name").fill(wineName);
  await page.locator("#pdo_pgi_name").fill("DOP de prueba");
  await shot(page, "alta-vino", width);
  await page.getByRole("button", { name: "Crear vino" }).click();
  await shown(page, wineName).first().waitFor();
  await page.getByText("Vino creado").first().waitFor({ state: "hidden", timeout: 8_000 });

  if (width < 768) await page.locator("#vinos-seccion").selectOption("formatos");
  await shown(page, catalog.format.name).first().waitFor();
  await shot(page, "formatos", width);
  await page.getByRole("button", { name: "Más acciones" }).click();
  await page.getByRole("menuitem", { name: "Nuevo formato" }).click();
  await page.waitForSelector("[data-screen='formato-alta']");
  await page.locator("#format_code").fill(formatCode);
  await page.locator("#format_name").fill(formatName);
  await page.locator("#nominal_volume_ml").fill("750");
  await shot(page, "alta-formato", width);
  await page.getByRole("button", { name: "Crear formato" }).click();
  await shown(page, formatName).first().waitFor();

  await gotoReady(page, "/catalogo/tarifas", "tarifas");
  await shown(page, catalog.list.name).first().waitFor();
  await shown(page, `v${catalog.list.active_version}`).first().waitFor();
  await shot(page, "tarifas", width);
  await shown(page, catalog.list.name).first().click();
  await page.waitForSelector("[data-screen='tarifa']");
  await page.getByRole("tab", { name: /Borrador/ }).click();
  await shown(page, "Disponible al activar Aprobaciones").first().waitFor();
  await page.getByRole("button", { name: "Solicitar activación" }).waitFor({ state: "hidden" });
  if (width >= 768) {
    const price = page.getByRole("textbox", { name: "Precio" }).first();
    await price.waitFor();
    const currentPrice = await price.inputValue();
    const nextPrice = bumpPrice(currentPrice);
    await price.fill(nextPrice);
    await page.getByRole("button", { name: "Guardar precios" }).click();
    await shown(page, "Precios guardados").first().waitFor();
    await page.getByText("Precios guardados").first().waitFor({ state: "hidden", timeout: 8_000 });
    await page.getByRole("textbox", { name: "Precio" }).first().waitFor();
    const saved = await page.getByRole("textbox", { name: "Precio" }).first().inputValue();
    if (saved !== nextPrice) throw new Error(`El precio guardado es «${saved}», esperaba «${nextPrice}»`);
  }
  await shot(page, "tarifa-borrador", width);
  await page.getByRole("tab", { name: /Activa/ }).click();
  await shown(page, "WC050").first().waitFor();
  await shot(page, "tarifa-activa", width);
}

function bumpPrice(value: string): string {
  const match = /^(.*?)(\d)$/.exec(value.trim());
  if (!match) throw new Error(`Precio no editable: ${value}`);
  const digit = match[2] === "9" ? "8" : String(Number(match[2]) + 1);
  return `${match[1]}${digit}`;
}

async function expectHidden(page: Page, text: string) {
  const started = Date.now();
  let count = 1;
  while (Date.now() - started < 10_000) {
    count = await page.getByText(text, { exact: true }).filter({ visible: true }).count();
    if (count === 0) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`«${text}» sigue visible (${count})`);
}

async function runReadOnly(browser: Browser, viewport: { width: number; height: number }, user: string, shotName: string, catalog: Catalog) {
  const session = await openContext(browser, viewport, user);
  try {
    await gotoReady(session.page, "/catalogo", "catalogo");
    await session.page.getByRole("button", { name: `Cuenta de ${user}` }).waitFor();
    await shown(session.page, catalog.sample.name).first().waitFor();
    await session.page.getByRole("button", { name: "Nuevo producto", exact: true }).waitFor({ state: "hidden" });
    await shot(session.page, shotName, viewport.width);
    await gotoReady(session.page, `/catalogo/${catalog.sample.id}`, "producto");
    await session.page.getByRole("button", { name: "Editar" }).waitFor({ state: "hidden" });
    await gotoReady(session.page, "/catalogo/vinos", "vinos");
    await session.page.getByRole("button", { name: "Nuevo vino", exact: true }).waitFor({ state: "hidden" });
    await gotoReady(session.page, `/catalogo/tarifas/${catalog.list.id}`, "tarifa");
    await session.page.getByRole("button", { name: "Nueva versión" }).waitFor({ state: "hidden" });
  } finally {
    await session.close();
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const catalog = await loadCatalog();
  console.log(
    `catálogo: ${catalog.products.length} productos, ${catalog.wines.length} vinos, ${catalog.formats.length} formatos, tarifa ${catalog.list.code} v${catalog.list.active_version}`,
  );
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    for (const viewport of viewports) {
      const owner = await openContext(browser, viewport);
      try {
        await runOwner(owner.page, viewport.width, catalog);
      } finally {
        await owner.close();
      }
      await runReadOnly(browser, viewport, "asesor@winecore.test", "asesor", catalog);
      await runReadOnly(browser, viewport, "bodega@winecore.test", "bodega", catalog);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
