import { copyFile, mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright";

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const api = `${base}/api`;
const outDir = "/opt/cursor/artifacts/screenshots";
const backupDir = "/tmp/qa-bodega-shots";
const chromePath = "/usr/local/bin/google-chrome";
const widths = [390, 1440] as const;

type Vessel = {
  code: string;
  kind: string;
  material: string;
  status: string;
  capacity_ml: number;
  volume_ml: number;
  lot_code: string | null;
  wine_name: string | null;
  qr_token?: string;
};

async function shot(page: Page, name: string, width: number): Promise<void> {
  const file = `real-${name}-${width}.png`;
  await page.screenshot({ path: `${backupDir}/${file}`, fullPage: width >= 768 });
  await copyFile(`${backupDir}/${file}`, `${outDir}/${file}`);
  console.log(`shot ${file}`);
}

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const root = document.querySelector("[data-screen]");
    if (!root) return false;
    const screen = root.getAttribute("data-screen") ?? "";
    if (screen.endsWith("-cargando")) return false;
    if (root.getAttribute("aria-busy") === "true") return false;
    return document.querySelector("[aria-busy='true']") == null;
  }, undefined, { timeout: 25_000 });
}

async function openAs(browser: Awaited<ReturnType<typeof chromium.launch>>, email: string, width: number, height: number) {
  const context = await browser.newContext({
    viewport: { width, height },
    extraHTTPHeaders: { "X-Dev-User": email },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  return { context, page };
}

async function vesselsOf(email: string): Promise<Vessel[]> {
  const response = await fetch(`${api}/v1/vessels?limit=100`, { headers: { "X-Dev-User": email } });
  if (!response.ok) throw new Error(`No se han podido leer los depósitos (${response.status})`);
  const body = (await response.json()) as { items: Vessel[] };
  return body.items;
}

async function clickVessel(page: Page, code: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${code}\\b`) }).click();
}

async function goWizard(page: Page, tank: string, barrel: string, inputL: string, outputL: string): Promise<void> {
  await page.goto(`${base}/bodega/operacion/nueva`, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.getByRole("button", { name: "Trasiego" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await clickVessel(page, tank);
  await page.locator("#origen-0-volumen").fill(inputL);
  await page.locator("#origen-0-volumen").blur();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await clickVessel(page, barrel);
  await page.locator("#destino-0-volumen").fill(outputL);
  await page.locator("#destino-0-volumen").blur();
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await mkdir(backupDir, { recursive: true });
  const health = await fetch(`${api}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`La API no responde en ${api}/health`);

  const cellar = "bodega@winecore.test";
  const list = await vesselsOf(cellar);
  const tank = list.find((item) => item.kind === "tank_storage" && item.status === "in_service" && item.volume_ml > 500_000 && item.lot_code);
  const barrel = list.find((item) => item.code === "BAR-008" && item.volume_ml === 0);
  if (!tank?.lot_code || !barrel) throw new Error("El demo no tiene un depósito con vino y una barrica vacía");
  const qr = await fetch(`${api}/v1/vessels/${tank.code}/qr`, { headers: { "X-Dev-User": cellar } });
  if (!qr.ok) throw new Error(`QR de ${tank.code} no disponible (${qr.status})`);
  const label = (await qr.json()) as { qr_token: string; payload: string };
  const token = label.qr_token;

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    for (const width of widths) {
      const { context, page } = await openAs(browser, "owner@winecore.test", width, width === 390 ? 844 : 900);
      try {
        await page.goto(`${base}/bodega`, { waitUntil: "domcontentloaded" });
        await settle(page);
        await page.getByText(tank.code).first().waitFor();
        await shot(page, "bodega-mapa", width);

        await page.getByRole("link", { name: new RegExp(tank.code) }).first().click();
        await page.waitForURL(new RegExp(`/bodega/${tank.code}$`));
        await settle(page);
        await page.getByRole("heading", { name: tank.code }).waitFor();
        await page.getByText(tank.lot_code).first().waitFor();
        await shot(page, "bodega-deposito", width);

        await page.getByRole("link", { name: new RegExp(tank.lot_code) }).click();
        await settle(page);
        await page.getByRole("heading", { name: "Genealogía" }).waitFor();
        await shot(page, "bodega-lote", width);

        await page.goto(`${base}/q/${token}`, { waitUntil: "domcontentloaded" });
        await settle(page);
        await page.getByRole("heading", { name: tank.code }).waitFor();
        await shot(page, "bodega-qr", width);

        await page.goto(`${base}/stock`, { waitUntil: "domcontentloaded" });
        await settle(page);
        await page.getByText(tank.code).filter({ visible: true }).first().waitFor();
        await shot(page, "existencias-fecha", width);

        await page.getByRole("tab", { name: "Fiscal" }).or(page.getByRole("button", { name: "Fiscal" })).first().click();
        await settle(page);
        await shot(page, "existencias-fiscal", width);

        await page.goto(`${base}/stock/movimientos`, { waitUntil: "domcontentloaded" });
        await settle(page);
        await shot(page, "existencias-movimientos", width);

        await page.goto(`${base}/stock/aforos`, { waitUntil: "domcontentloaded" });
        await settle(page);
        await shot(page, "existencias-aforos", width);
      } finally {
        await context.close();
      }
    }

    const desktop = await openAs(browser, cellar, 1440, 900);
    try {
      const page = desktop.page;
      await goWizard(page, tank.code, barrel.code, "100", "50");
      await page.getByRole("button", { name: "Siguiente" }).click();
      await page.locator("#merma-0-volumen").fill("0");
      await page.locator("#merma-0-volumen").blur();
      await page.getByRole("button", { name: "Siguiente" }).click();
      await page.getByText("WC020").first().waitFor();
      await shot(page, "bodega-wc020", 1440);

      await page.goto(`${base}/bodega/operacion/nueva`, { waitUntil: "domcontentloaded" });
      await goWizard(page, tank.code, barrel.code, "400", "400");
      await page.getByRole("button", { name: "Siguiente" }).click();
      await page.getByText("WC025").first().waitFor();
      await shot(page, "bodega-wc025", 1440);

      await page.goto(`${base}/bodega/operacion/nueva`, { waitUntil: "domcontentloaded" });
      await goWizard(page, tank.code, barrel.code, "205", "200");
      await page.getByRole("button", { name: "Siguiente" }).click();
      await page.locator("#merma-0-volumen").fill("5");
      await page.locator("#merma-0-volumen").blur();
      await page.getByRole("button", { name: "Siguiente" }).click();
      await page.getByText("Sale del mayor").waitFor({ timeout: 20_000 });
      await page.getByText("Merma fiscal").waitFor();
      await page.getByText(/CRIANZA-/).waitFor();
      await shot(page, "bodega-vista-previa", 1440);
      await page.getByRole("button", { name: "Confirmar" }).click();
      await page.getByText("Operación confirmada").waitFor({ timeout: 20_000 });
      await shot(page, "bodega-confirmada", 1440);

      await page.goto(`${base}/stock`, { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByText(barrel.code).filter({ visible: true }).first().waitFor();
      await shot(page, "existencias-trasiego", 1440);
      await page.getByRole("tab", { name: "Fiscal" }).click();
      await settle(page);
      await page.getByText(/CRIANZA-/).first().waitFor();
      await shot(page, "existencias-fiscal-trasiego", 1440);

      await page.goto(`${base}/stock/movimientos`, { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByText("Entrada de bodega").filter({ visible: true }).first().waitFor();
      await shot(page, "existencias-movimientos-trasiego", 1440);

      const at = new Date().toISOString();
      await page.goto(`${base}/stock/informe?at=${encodeURIComponent(at)}`, { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByRole("button", { name: "Imprimir / Guardar PDF" }).waitFor();
      await page.getByRole("heading", { name: "Libro físico" }).waitFor();
      await shot(page, "existencias-informe", 1440);

      await page.goto(`${base}/stock/aforos/nuevo`, { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.locator("#legal_entity_id").selectOption({ label: "P.O" });
      await page.getByText("Bodega Ejemplo").click();
      await page.getByRole("button", { name: "Crear aforo" }).click();
      await page.waitForURL(/\/stock\/aforos\/[^/]+$/);
      await settle(page);
      await page.locator("table").getByLabel("Litros contados").first().waitFor({ timeout: 20_000 });
      const rows = page.locator("table tbody tr");
      const total = await rows.count();
      if (total < 1) throw new Error("El aforo no tiene líneas");
      for (let index = 0; index < total; index += 1) {
        const row = rows.nth(index);
        const book = (await row.locator("td").nth(2).innerText()).replace(/\u00a0/g, " ").replace(/\s*L$/, "").trim();
        const normalized = book.includes(",") ? book.replace(/\./g, "").replace(",", ".") : book.replace(/\./g, "");
        const litres = Number(normalized) + (index === 0 ? -1 : 0);
        const text = litres.toFixed(3).replace(".", ",");
        const input = row.getByLabel("Litros contados");
        await input.fill(text);
        await input.blur();
        await row.getByLabel(/Método de/).selectOption("dipstick");
      }
      await page.locator("table").getByLabel(/Motivo de la diferencia/).fill("Merma de trasiego no anotada en el aforo");
      await shot(page, "existencias-aforo", 1440);
      await page.getByRole("button", { name: "Cerrar recuento" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Cerrar recuento" }).click();
      await page.getByText("Recuento cerrado").waitFor({ timeout: 20_000 });
      await shot(page, "existencias-aforo-cerrado", 1440);

      await page.goto(`${base}/stock/aforos/nuevo?kind=opening`, { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByText("31/12/2026").waitFor();
      await page.locator("#legal_entity_id").selectOption({ label: "P.O" });
      await page.getByText("Bodega Ejemplo").click();
      await page.getByRole("button", { name: "Crear aforo" }).click();
      await page.waitForURL(/\/stock\/aforos\//);
      await settle(page);
      await page.getByText("Aforo de arranque del 31/12/2026").waitFor();
      await shot(page, "existencias-arranque", 1440);
    } finally {
      await desktop.context.close();
    }

    const mobile = await openAs(browser, cellar, 390, 844);
    try {
      const page = mobile.page;
      await goWizard(page, tank.code, barrel.code, "400", "400");
      await page.getByRole("button", { name: "Siguiente" }).click();
      await page.getByText("WC025").first().waitFor();
      await shot(page, "bodega-wc025", 390);
      await page.goto(`${base}/stock`, { waitUntil: "domcontentloaded" });
      await settle(page);
      await shot(page, "existencias-trasiego", 390);
      await page.goto(`${base}/stock/informe`, { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByRole("heading", { name: "Libro físico" }).waitFor();
      await shot(page, "existencias-informe", 390);
    } finally {
      await mobile.context.close();
    }

    for (const width of widths) {
      const { context, page } = await openAs(browser, "asesor@winecore.test", width, width === 390 ? 844 : 900);
      try {
        await page.goto(`${base}/bodega`, { waitUntil: "domcontentloaded" });
        await settle(page);
        await page.getByRole("link", { name: "Nueva operación" }).waitFor({ state: "hidden" });
        await shot(page, "bodega-asesor", width);
        await page.goto(`${base}/stock`, { waitUntil: "domcontentloaded" });
        await settle(page);
        await page.getByRole("link", { name: "Iniciar aforo" }).waitFor({ state: "hidden" });
        await shot(page, "existencias-asesor", width);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
