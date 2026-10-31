import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const outDir = process.env.E2E_SCREENSHOT_DIR ?? "/opt/cursor/artifacts/screenshots";
const chromePath =
  process.env.CHROME_PATH ?? (existsSync("/usr/local/bin/google-chrome") ? "/usr/local/bin/google-chrome" : undefined);

const WARN_CIF = "El dígito de control del CIF no coincide";

const COMPANY_NAMES = [
  "Vinoteca Prueba Norte S.L.",
  "Bodega Ensayo del Ebro S.L.",
  "Comercializadora Ejemplo Sur S.L.",
  "Distribuciones Ficticias del Duero S.L.",
] as const;

let companyCursor = 0;

function nextCompanyName(): string {
  const name = COMPANY_NAMES[companyCursor % COMPANY_NAMES.length] ?? COMPANY_NAMES[0];
  companyCursor += 1;
  return name;
}

const viewports = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

type AuditItem = {
  actor: { type: string; display_name: string };
  action: string;
  changes: { field: string; before: unknown; after: unknown }[];
};

function actorLabel(event: AuditItem): string {
  if (event.actor.type === "migration" || event.actor.type === "system") return "Sistema";
  return event.actor.display_name;
}

function cifControlDigit(digits: string): string {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    const digit = digits.charCodeAt(index) - 48;
    if (index % 2 === 0) {
      const doubled = digit * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    } else {
      sum += digit;
    }
  }
  return String((10 - (sum % 10)) % 10);
}

function cifFrom(seed: number): string {
  const digits = String(Math.abs(Math.trunc(seed)) % 10_000_000).padStart(7, "0");
  return `B${digits}${cifControlDigit(digits)}`;
}

function badCif(seed: number): string {
  const valid = cifFrom(seed);
  const control = valid.slice(-1);
  const wrong = control === "0" ? "1" : "0";
  return `${valid.slice(0, 8)}${wrong}`;
}

function grouped(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function subjectOf(event: AuditItem): string {
  const named = event.changes.find((change) => change.field === "legal_name" || change.field === "trade_name");
  const value = named?.after ?? named?.before;
  if (typeof value === "string" && value.trim()) return value;
  return "un contacto";
}

async function waitForUi(): Promise<void> {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < 60_000) {
    try {
      const page = await fetch(baseUrl);
      const health = await fetch(`${baseUrl}/api/health`);
      if (page.ok && health.ok) return;
      last = `ui ${page.status} health ${health.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`La pila no responde en ${baseUrl} (${last})`);
}

async function shot(page: Page, screen: string, width: number, keepScroll = false): Promise<void> {
  if (!keepScroll) await page.evaluate(() => window.scrollTo(0, 0));
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (extra > 1) throw new Error(`${screen}-${width} se sale ${extra}px`);
  const file = path.join(outDir, `real-contactos-${screen}-${width}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}

function rows(page: Page, width: number) {
  return width < 768
    ? page.locator("[data-screen='contactos'] ul > li")
    : page.locator("[data-screen='contactos'] tbody tr");
}

function visibleList(page: Page, width: number) {
  return width < 768 ? page.locator("[data-screen='contactos'] ul") : page.locator("[data-screen='contactos'] tbody");
}

async function gotoReady(page: Page, routePath: string, screen: string): Promise<void> {
  await page.goto(`${baseUrl}${routePath}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(`[data-screen="${screen}"]`);
}

async function openContext(browser: Browser, viewport: { width: number; height: number }, user: string) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    reducedMotion: "reduce",
    colorScheme: "light",
    acceptDownloads: true,
    extraHTTPHeaders: { "X-Dev-User": user },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return { context, page, errors };
}

async function closeContext(context: BrowserContext, errors: string[]): Promise<void> {
  if (errors.length > 0) throw new Error(errors.join(" | "));
  await context.close();
}

async function json<T>(page: Page, apiPath: string): Promise<T> {
  return page.evaluate(async (pathname) => {
    const response = await fetch(pathname);
    if (!response.ok) throw new Error(`${pathname} ${response.status}`);
    return response.json() as Promise<T>;
  }, apiPath);
}

async function unusedCif(page: Page): Promise<string> {
  for (let bump = 0; bump < 12; bump += 1) {
    const candidate = cifFrom(Date.now() + bump * 7919);
    const taken = await page.evaluate(async (tax) => {
      const response = await fetch(`/api/v1/contacts?q=${encodeURIComponent(tax)}&limit=20&archived=false`);
      const body = (await response.json()) as { items: { tax_id: string | null }[] };
      return body.items.some((item) => item.tax_id === tax);
    }, candidate);
    if (!taken) return candidate;
  }
  throw new Error("No hay un CIF libre");
}

async function assertMobileFilters(page: Page, width: number): Promise<void> {
  if (width >= 768) return;
  if (await page.getByRole("button", { name: "Columnas" }).count()) throw new Error("Columnas no debe verse en el móvil");
  const spread = await page.locator("#filtros-contactos").evaluate((el) => {
    const kids = Array.from(el.querySelectorAll(":scope > button, :scope > select"));
    const tops = kids.map((node) => node.getBoundingClientRect().top);
    return Math.max(...tops) - Math.min(...tops);
  });
  if (spread > 1) throw new Error(`Los filtros ocupan varias filas (${spread}px)`);
  await page.locator("[data-filters-fade='right']").waitFor();
}

async function openTab(page: Page, width: number, id: string, label: string): Promise<void> {
  if (width < 768) await page.locator("#ficha-seccion").selectOption(id);
  else await page.getByRole("tab", { name: label }).click();
}

async function factValue(page: Page, label: string): Promise<string> {
  const term = page.locator("dt").filter({ hasText: new RegExp(`^${label}$`) }).first();
  return term.evaluate((node) => node.nextElementSibling?.textContent?.replace(/\s+/g, " ").trim() ?? "");
}

async function runOwner(browser: Browser, viewport: { width: number; height: number }): Promise<void> {
  const width = viewport.width;
  const { context, page, errors } = await openContext(browser, viewport, "owner@winecore.test");
  try {
    await gotoReady(page, "/", "panel");
    const totals = await json<{ total: number }>(page, "/api/v1/contacts?limit=1&archived=false");
    const customers = await json<{ total: number }>(page, "/api/v1/contacts?limit=1&role=customer&archived=false");
    const suppliers = await json<{ total: number }>(page, "/api/v1/contacts?limit=1&role=supplier&archived=false");
    const audit = await json<{ items: AuditItem[] }>(page, "/api/v1/audit?table=party.contact&limit=5");
    const kpis = page.locator("section").filter({ has: page.getByRole("heading", { name: "Contactos", exact: true }) });
    await kpis.getByText(grouped(totals.total), { exact: true }).waitFor();
    await kpis.getByText(grouped(customers.total), { exact: true }).waitFor();
    await kpis.getByText(grouped(suppliers.total), { exact: true }).waitFor();
    const recent = page.locator("section").filter({ has: page.getByRole("heading", { name: "Cambios recientes" }) });
    const firstEvent = audit.items[0];
    if (!firstEvent) throw new Error("La auditoría no tiene cambios");
    await recent.getByText(actorLabel(firstEvent), { exact: false }).first().waitFor();
    await recent.getByText(subjectOf(firstEvent), { exact: false }).first().waitFor();
    await shot(page, "panel", width);

    await gotoReady(page, "/contactos", "contactos");
    await assertMobileFilters(page, width);
    await page.getByRole("button", { name: "Cargar más" }).waitFor();
    const before = await rows(page, width).count();
    if (before < 1) throw new Error("La lista no trae el demo");
    await shot(page, "lista", width);

    await page.getByRole("button", { name: "Cargar más" }).click();
    await page.waitForFunction(
      ([kind, count]) => {
        const selector = kind === "card" ? "[data-screen='contactos'] ul > li" : "[data-screen='contactos'] tbody tr";
        return document.querySelectorAll(selector).length > count;
      },
      [width < 768 ? "card" : "table", before] as const,
    );
    await page.getByRole("button", { name: "Cargar más" }).scrollIntoViewIfNeeded();
    await shot(page, "lista-mas", width, true);

    const sample = (await rows(page, width).first().innerText()).split("\n")[0]?.trim() ?? "";
    await page.locator("#buscar-contactos").fill("logistica");
    if (sample && !/log[ií]stica/i.test(sample)) {
      await visibleList(page, width).getByText(sample, { exact: true }).first().waitFor({ state: "hidden" });
    }
    await visibleList(page, width).getByText(/Logística/).first().waitFor();
    await shot(page, "lista-busqueda", width);

    await page.getByRole("button", { name: "Clientes" }).click();
    await page.getByText("Nada coincide con los filtros").waitFor();
    await page.locator("#buscar-contactos").fill("");
    await page.getByRole("button", { name: "Clientes", pressed: true }).waitFor();
    await rows(page, width).first().waitFor();
    if (width < 768) {
      const pill = await page.getByRole("button", { name: "Clientes", pressed: true }).boundingBox();
      const rail = await page.locator("#filtros-contactos").boundingBox();
      if (!pill || !rail) throw new Error("No se mide la píldora");
      if (pill.x < rail.x - 1 || pill.x + pill.width > rail.x + rail.width + 1) {
        throw new Error("La píldora activa queda fuera de la fila");
      }
    }
    await shot(page, "lista-filtros", width);
    await page.getByRole("button", { name: "Clientes", pressed: true }).click();
    const foreign = await json<{ items: { legal_name: string }[] }>(page, "/api/v1/contacts?country=FR&limit=1&archived=false");
    const foreignName = foreign.items[0]?.legal_name;
    if (!foreignName) throw new Error("El demo no tiene un contacto de Francia");
    await page.getByLabel("País").selectOption("ES");
    await page.locator("#buscar-contactos").fill(foreignName);
    await page.getByText("Nada coincide con los filtros").waitFor();
    await page.getByLabel("País").selectOption("FR");
    await visibleList(page, width).getByText(foreignName, { exact: false }).first().waitFor();

    await gotoReady(page, "/contactos", "contactos");
    if (width >= 768) {
      await page.getByRole("button", { name: "Columnas" }).click();
      await page.getByRole("menuitem", { name: "Nombre comercial" }).click();
      await shot(page, "lista-columnas", width);
      await page.keyboard.press("Escape");
      await page.getByRole("columnheader", { name: "Nombre comercial" }).waitFor();
    }

    await gotoReady(page, "/contactos", "contactos");
    const openTarget =
      width < 768
        ? page.locator("[data-screen='contactos'] ul button").first()
        : page.locator("[data-screen='contactos'] tbody tr").first();
    const nameAt = (index: number) =>
      width < 768
        ? page.locator("[data-screen='contactos'] ul button p").nth(index)
        : page.locator("[data-screen='contactos'] tbody tr").nth(index).locator("td").first();
    const firstName = (await nameAt(0).innerText()).replace(/\s+/g, " ").trim();
    const secondName = (await nameAt(1).innerText()).replace(/\s+/g, " ").trim();
    if (!firstName || !secondName || firstName === secondName) throw new Error(`Filas no distintas: ${firstName} / ${secondName}`);
    await openTarget.click();
    await page.waitForSelector("[data-screen='contacto-preview']");
    await page.locator("[data-screen='contacto-preview']").getByText(firstName, { exact: false }).first().waitFor();
    await shot(page, "preview", width);
    await page.getByRole("button", { name: "Siguiente" }).click();
    await page.locator("[data-screen='contacto-preview']").getByRole("heading", { name: secondName }).waitFor();
    await shot(page, "preview-siguiente", width);
    await page.getByRole("button", { name: "Anterior" }).click();
    await page.locator("[data-screen='contacto-preview']").getByRole("heading", { name: firstName }).waitFor();
    await page.getByRole("link", { name: "Abrir ficha" }).click();
    await page.waitForSelector("[data-screen='ficha']");
    await page.getByRole("heading", { level: 1, name: firstName }).waitFor();
    if (await page.locator("#trade_name").count()) throw new Error("El resumen no está en solo lectura");
    await shot(page, "ficha-resumen", width);
    if (/Prueba Norte|Ensayo del Ebro|Ejemplo Sur|Ficticias del Duero|Tonelería de Prueba|Laboratorio Ensayo/.test(firstName)) {
      throw new Error(`La vista previa ya muestra un contacto de prueba: ${firstName}`);
    }
    if (errors.length > 0) throw new Error(errors.join(" | "));
  } catch (error) {
    if (!page.isClosed()) await page.screenshot({ path: `/tmp/qa-fail-${width}.png`, fullPage: true }).catch(() => undefined);
    if (errors.length > 0) console.error(errors.join(" | "));
    throw error;
  } finally {
    await context.close();
  }
}

async function runMutations(browser: Browser, viewport: { width: number; height: number }): Promise<void> {
  const width = viewport.width;
  const { context, page, errors } = await openContext(browser, viewport, "owner@winecore.test");
  try {
    await gotoReady(page, "/contactos", "contactos");
    await page.locator("#buscar-contactos").fill("Solana");
    const target =
      width < 768
        ? page.locator("[data-screen='contactos'] ul button").filter({ hasText: "Solana" }).first()
        : page.locator("[data-screen='contactos'] tbody tr").filter({ hasText: "Solana" }).first();
    await target.waitFor();
    await target.click();
    await page.waitForSelector("[data-screen='contacto-preview']");
    await page.getByRole("link", { name: "Abrir ficha" }).click();
    await page.waitForSelector("[data-screen='ficha']");
    const trade = width < 768 ? "Casa de la Prueba" : "Casa del Ensayo";
    await page.getByRole("button", { name: "Editar" }).click();
    await page.locator("#trade_name").fill(trade);
    await shot(page, "ficha-editar", width);
    const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/contacts/"));
    await page.getByRole("button", { name: "Guardar" }).click();
    const savedResponse = await saved;
    if (!savedResponse.ok()) throw new Error(`Guardar respondió ${savedResponse.status()}`);
    await page.getByRole("button", { name: "Editar" }).waitFor();
    await page.getByText(trade, { exact: false }).first().waitFor();
    await openTab(page, width, "historial", "Historial");
    await page.locator("ol").getByText(trade).waitFor();
    await page.getByText("Cambios guardados").waitFor({ state: "hidden" }).catch(() => undefined);
    await shot(page, "ficha-historial", width);

    const nif = await unusedCif(page);
    const legal = nextCompanyName();
    await gotoReady(page, "/contactos/nuevo", "contacto-nuevo");
    await page.locator("#legal_name").fill(legal);
    await page.locator("#tax_id").fill(nif);
    await page.getByText("Entre 2 y 120 caracteres.").waitFor();
    await shot(page, "alta", width);
    await page.getByRole("button", { name: "Crear contacto" }).click();
    await page.getByRole("heading", { level: 1, name: legal }).waitFor();

    await gotoReady(page, "/contactos/nuevo", "contacto-nuevo");
    await page.locator("#legal_name").fill(nextCompanyName());
    await page.locator("#tax_id").fill(nif);
    await page.getByRole("button", { name: "Crear contacto" }).click();
    const duplicate = page.locator("#duplicate-tax a");
    await duplicate.waitFor();
    const duplicateText = (await duplicate.innerText()).replace(/\s+/g, " ").trim();
    if (duplicateText !== `Ya existe ${legal} con este NIF`) throw new Error(duplicateText);
    await shot(page, "alta-duplicado", width);
    const href = await duplicate.getAttribute("href");
    await duplicate.click();
    await page.waitForURL((url) => url.pathname === href);
    await page.getByRole("heading", { level: 1, name: legal }).waitFor();

    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menuitem", { name: "Archivar" }).click();
    const archiveDialog = page.getByRole("dialog", { name: "Archivar contacto" });
    await archiveDialog.getByRole("button", { name: "Archivar" }).click();
    await page.getByText("Archivado", { exact: true }).waitFor();
    await shot(page, "ficha-archivado", width);
    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menuitem", { name: "Reactivar" }).click();
    const restoreDialog = page.getByRole("dialog", { name: "Reactivar contacto" });
    await restoreDialog.getByRole("button", { name: "Reactivar" }).click();
    await page.getByText("Archivado", { exact: true }).waitFor({ state: "hidden" });
    await shot(page, "ficha-reactivado", width);

    const bad = badCif(Date.now() + width * 17);
    const warnedName = nextCompanyName();
    await gotoReady(page, "/contactos/nuevo", "contacto-nuevo");
    await page.locator("#legal_name").fill(warnedName);
    await page.locator("#tax_id").fill(bad);
    await page.locator("#tax_id-warning").waitFor();
    await shot(page, "alta-aviso", width);
    await page.getByRole("button", { name: "Crear contacto" }).click();
    await page.getByRole("heading", { level: 1, name: warnedName }).waitFor();
    await page.getByText(WARN_CIF).waitFor();
    await page.getByText("Contacto creado").waitFor({ state: "hidden" }).catch(() => undefined);
    await shot(page, "alta-aviso-guardado", width);

    await gotoReady(page, "/contactos", "contactos");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menuitem", { name: "Exportar CSV" }).click();
    const download = await downloadPromise;
    const file = await download.path();
    if (!file) throw new Error("La exportación no dejó fichero");
    const bytes = await readFile(file);
    if (bytes[0] !== 0xef || bytes[1] !== 0xbb || bytes[2] !== 0xbf) throw new Error(`Sin BOM: ${[...bytes.subarray(0, 3)].join(",")}`);
    const csv = bytes.toString("utf8");
    const header = csv.split(/\r?\n/)[0] ?? "";
    if (!header.includes("Nombre fiscal;Nombre comercial;")) throw new Error(header);
    if (errors.length > 0) throw new Error(errors.join(" | "));
  } catch (error) {
    if (!page.isClosed()) await page.screenshot({ path: `/tmp/qa-fail-${width}.png`, fullPage: true }).catch(() => undefined);
    if (errors.length > 0) console.error(errors.join(" | "));
    throw error;
  } finally {
    await context.close();
  }
}

async function runAdvisor(browser: Browser, viewport: { width: number; height: number }): Promise<void> {
  const width = viewport.width;
  const { context, page, errors } = await openContext(browser, viewport, "asesor@winecore.test");
  try {
    await gotoReady(page, "/contactos", "contactos");
    if (width >= 768) {
      await page.getByRole("button", { name: "Columnas" }).click();
      await page.getByRole("menuitem", { name: "Correo" }).click();
      await page.keyboard.press("Escape");
      await page.getByRole("columnheader", { name: "Correo" }).waitFor();
      const headers = await page.locator("thead th").allInnerTexts();
      const index = headers.findIndex((header) => header.trim() === "Correo");
      const cells = await page.locator(`tbody tr td:nth-child(${index + 1})`).allInnerTexts();
      if (cells.length === 0 || cells.some((cell) => cell.includes("@"))) throw new Error(`Correo visible: ${cells.slice(0, 3).join(" | ")}`);
    }
    await shot(page, "asesor-lista", width);
    const target =
      width < 768
        ? page.locator("[data-screen='contactos'] ul button").first()
        : page.locator("[data-screen='contactos'] tbody tr").first();
    await target.click();
    await page.waitForSelector("[data-screen='contacto-preview']");
    if (await page.locator("[data-screen='contacto-preview'] a[href^='mailto:']").count()) throw new Error("El asesor ve un mailto");
    if (await page.locator("[data-screen='contacto-preview'] a[href^='tel:']").count()) throw new Error("El asesor ve un teléfono");
    await page.getByRole("link", { name: "Abrir ficha" }).click();
    await page.waitForSelector("[data-screen='ficha']");
    if ((await factValue(page, "Correo")) !== "—") throw new Error("El asesor ve el correo");
    if ((await factValue(page, "Teléfono")) !== "—") throw new Error("El asesor ve el teléfono");
    await shot(page, "asesor-ficha", width);
  } finally {
    await closeContext(context, errors);
  }
}

async function runCellar(browser: Browser, viewport: { width: number; height: number }): Promise<void> {
  const width = viewport.width;
  const { context, page, errors } = await openContext(browser, viewport, "bodega@winecore.test");
  try {
    await gotoReady(page, "/", "panel");
    if (await page.getByRole("link", { name: "Contactos", exact: true }).count()) throw new Error("Bodega ve el enlace de Contactos");
    await page.goto(`${baseUrl}/contactos`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-screen='contactos-sin-permiso']");
    await page.getByText("No tienes permiso para ver esto").waitFor();
    if (await page.locator("[data-screen='contactos']").count()) throw new Error("Bodega ve el listado");
    await shot(page, "bodega", width);
  } finally {
    await closeContext(context, errors);
  }
}

async function main(): Promise<void> {
  await waitForUi();
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    await rm(path.join(outDir, "real-contactos-lista-columnas-390.png"), { force: true });
    for (const viewport of viewports) {
      console.log(`vista ${viewport.width}`);
      await runOwner(browser, viewport);
    }
    for (const viewport of viewports) {
      console.log(`cambios ${viewport.width}`);
      await runMutations(browser, viewport);
    }
    for (const viewport of viewports) {
      console.log(`resto ${viewport.width}`);
      await runAdvisor(browser, viewport);
      await runCellar(browser, viewport);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
