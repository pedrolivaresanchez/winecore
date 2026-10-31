import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page, type Route } from "playwright";
import { healthOk, meOk } from "../fixtures";
import {
  SHA256,
  balances,
  differenceCount,
  fiscalBalances,
  fiscalMoves,
  initialCounts,
  locations,
  physicalMoves,
  type CountRecord,
} from "./fixtures";

const port = 5219;
const baseUrl = `http://127.0.0.1:${port}`;
const outDir = "/opt/cursor/artifacts/screenshots";
const chromePath = "/usr/local/bin/google-chrome";
const at = "2027-03-15T09:00:00.000Z";
const before = "2026-06-01T10:00:00.000Z";

const viewports = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

function fulfill(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function pageOf(items: unknown[]) {
  return { items, next_cursor: null, total: items.length };
}

async function installApi(page: Page, mode: "ok" | "empty") {
  const counts: CountRecord[] = structuredClone(initialCounts());

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const method = route.request().method();

    if (pathname.endsWith("/health")) return fulfill(route, healthOk);
    if (pathname.endsWith("/v1/me")) return fulfill(route, meOk);
    if (pathname.endsWith("/v1/stock/inspection-report")) {
      return route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: { "X-Document-Sha256": SHA256 },
        body: "%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF",
      });
    }
    if (pathname.endsWith("/v1/stock/balances")) {
      return fulfill(route, mode === "empty" ? pageOf([]) : pageOf(balances));
    }
    if (pathname.endsWith("/v1/stock/fiscal-balances")) {
      return fulfill(route, mode === "empty" ? pageOf([]) : pageOf(fiscalBalances));
    }
    if (pathname.endsWith("/v1/stock/moves")) {
      const book = url.searchParams.get("book");
      if (mode === "empty") return fulfill(route, pageOf([]));
      return fulfill(route, pageOf(book === "fiscal" ? fiscalMoves : physicalMoves));
    }
    if (pathname.endsWith("/v1/locations")) {
      return fulfill(route, mode === "empty" ? pageOf([]) : pageOf(locations));
    }
    if (pathname.endsWith("/v1/inventory-counts") && method === "GET") {
      return fulfill(route, mode === "empty" ? pageOf([]) : pageOf(counts));
    }
    if (pathname.endsWith("/v1/inventory-counts") && method === "POST") {
      const body = route.request().postDataJSON() as {
        kind?: string;
        counted_at?: string;
        location_ids?: string[];
        legal_entity_id?: string;
        notes?: string;
      };
      const entityId = body.legal_entity_id ?? "po";
      if (body.kind === "opening" && counts.some((item) => item.kind === "opening" && item.legal_entity_id === entityId && item.status !== "cancelled")) {
        return fulfill(route, { code: "WC_OPENING_EXISTS", message: "Ya existe un aforo de arranque para esa fecha" }, 409);
      }
      const chosen = locations.filter((item) => (body.location_ids ?? []).includes(item.id));
      const created: CountRecord = {
        id: "cnt-new",
        legal_entity_id: entityId,
        legal_entity_code: entityId === "cvpo" ? "CVPO" : "PO",
        number: null,
        kind: body.kind ?? "periodic",
        counted_at: body.counted_at ?? at,
        location_ids: body.location_ids ?? [],
        location_codes: chosen.map((item) => item.code),
        status: "draft",
        approval_request_id: null,
        signed_by: null,
        signed_by_name: null,
        signed_at: null,
        notes: body.notes ?? null,
        created_by: "Ana Rivas",
        created_at: "2027-03-15T12:00:00.000Z",
        difference_count: 0,
        lines: chosen.map((item, index) => ({
          id: `ln-new-${index}`,
          count_id: "cnt-new",
          location_id: item.id,
          location_code: item.code,
          location_name: item.name,
          vessel_id: null,
          vessel_code: null,
          vessel_capacity_ml: null,
          qr_token: null,
          owner_entity_id: entityId,
          owner_code: entityId === "cvpo" ? "CVPO" : "PO",
          lot_id: null,
          lot_code: null,
          product_id: null,
          product_name: null,
          wine_name: null,
          vintage: null,
          product_state: "wine",
          nominal_volume_ml: null,
          expected_qty_units: 0,
          expected_volume_ml: 0,
          counted_qty_units: null,
          counted_volume_ml: null,
          method: null,
          difference_reason: null,
          photo_attachment_id: null,
        })),
      };
      counts.unshift(created);
      return fulfill(route, created, 201);
    }

    const linesMatch = pathname.match(/\/v1\/inventory-counts\/([^/]+)\/lines$/);
    if (linesMatch && method === "PUT") {
      const count = counts.find((item) => item.id === linesMatch[1]);
      if (!count) return fulfill(route, { code: "WC_NOT_FOUND", message: "No encontrado" }, 404);
      const body = route.request().postDataJSON() as { lines?: Array<Record<string, unknown>> };
      for (const input of body.lines ?? []) {
        const line = count.lines.find((item) => item.id === input.id);
        if (!line) continue;
        line.counted_volume_ml = (input.counted_volume_ml ?? null) as number | null;
        line.counted_qty_units = (input.counted_qty_units ?? null) as number | null;
        line.method = (input.method ?? null) as string | null;
        line.difference_reason = (input.difference_reason ?? null) as string | null;
      }
      if (count.status === "draft") count.status = "counting";
      count.difference_count = differenceCount(count.lines);
      return fulfill(route, count);
    }

    const closeMatch = pathname.match(/\/v1\/inventory-counts\/([^/]+)\/close$/);
    if (closeMatch && method === "POST") {
      if (closeMatch[1] === "cnt-neg") {
        return fulfill(route, { code: "WC024", message: "Saldo negativo", details: { lot_code: "L25-T01" } }, 422);
      }
      const count = counts.find((item) => item.id === closeMatch[1]);
      if (!count) return fulfill(route, { code: "WC_NOT_FOUND", message: "No encontrado" }, 404);
      count.status = "review";
      count.signed_by_name = "Ana Rivas";
      count.signed_at = "2027-03-15T12:30:00.000Z";
      count.difference_count = differenceCount(count.lines);
      return fulfill(route, count);
    }

    const postMatch = pathname.match(/\/v1\/inventory-counts\/([^/]+)\/post-request$/);
    if (postMatch && method === "POST") {
      const count = counts.find((item) => item.id === postMatch[1]);
      if (!count) return fulfill(route, { code: "WC_NOT_FOUND", message: "No encontrado" }, 404);
      count.approval_request_id = "apr-stock-new";
      count.status = "review";
      return fulfill(route, count);
    }

    const countMatch = pathname.match(/\/v1\/inventory-counts\/([^/]+)$/);
    if (countMatch && method === "GET") {
      const count = counts.find((item) => item.id === countMatch[1]);
      if (!count) return fulfill(route, { code: "WC_NOT_FOUND", message: "No encontrado" }, 404);
      return fulfill(route, count);
    }

    return fulfill(route, { code: "WC_NOT_FOUND", message: "No encontrado" }, 404);
  });
}

async function assertInView(page: Page, name: string) {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (extra > 1) throw new Error(`${name} se sale ${extra}px`);
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(250);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  await assertInView(page, name);
  console.log(file);
}

async function openContext(browser: Browser, viewport: { width: number; height: number }, mode: "ok" | "empty") {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installApi(page, mode);
  return {
    page,
    errors,
    async close() {
      if (errors.length > 0) throw new Error(errors.join(" | "));
      await context.close();
    },
  };
}

function visibleText(page: Page, text: string) {
  return page.getByText(text).filter({ visible: true }).first();
}

async function gotoReady(page: Page, routePath: string, ready: string) {
  await page.goto(`${baseUrl}${routePath}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(`[data-screen="${ready}"]`, { timeout: 15_000 });
}

function startServer() {
  const logs: string[] = [];
  const proc = spawn(process.execPath, ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: process.cwd(),
    env: { ...process.env, VITE_AUTH_ENABLED: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = (chunk: Buffer) => {
    logs.push(chunk.toString());
    if (logs.length > 40) logs.shift();
  };
  proc.stdout?.on("data", collect);
  proc.stderr?.on("data", collect);
  return { proc, logs };
}

async function waitForServer(proc: ChildProcess, logs: string[]) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    if (proc.exitCode !== null) throw new Error(`Vite terminó\n${logs.join("")}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      /* sigue arrancando */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite no arrancó\n${logs.join("")}`);
}

async function captureWidth(browser: Browser, width: number, height: number) {
  const viewport = { width, height };
  const ok = await openContext(browser, viewport, "ok");
  await gotoReady(ok.page, `/stock?at=${encodeURIComponent(before)}`, "existencias-antes");
  await visibleText(ok.page, "WineCore no tiene datos antes del aforo de arranque").waitFor();
  await shot(ok.page, `existencias-arranque-${width}`);

  await gotoReady(ok.page, `/stock?at=${encodeURIComponent(at)}`, "existencias-physical");
  await visibleText(ok.page, "41.250,000 L").waitFor();
  await shot(ok.page, `existencias-fecha-${width}`);

  await ok.page.getByRole("tab", { name: "Fiscal" }).click();
  await ok.page.waitForSelector('[data-screen="existencias-fiscal"]');
  await visibleText(ok.page, "Granel en madera").waitFor();
  await shot(ok.page, `existencias-fiscal-${width}`);

  await gotoReady(ok.page, `/stock/informe?at=${encodeURIComponent(at)}`, "informe");
  await visibleText(ok.page, SHA256).waitFor();
  await visibleText(ok.page, "INOX-03").waitFor();
  await shot(ok.page, `existencias-informe-${width}`);

  await gotoReady(ok.page, "/stock/movimientos", "movimientos-physical");
  await visibleText(ok.page, "ALB-2027-0014").waitFor();
  await shot(ok.page, `existencias-movimientos-${width}`);

  await ok.page.getByRole("tab", { name: "Fiscal" }).click();
  await ok.page.waitForSelector('[data-screen="movimientos-fiscal"]');
  await visibleText(ok.page, "Periodo cerrado").waitFor();
  await shot(ok.page, `existencias-movimientos-fiscal-${width}`);

  await gotoReady(ok.page, "/stock/aforos", "aforos");
  await visibleText(ok.page, "AF-2027-01").waitFor();
  await shot(ok.page, `existencias-aforos-${width}`);

  await gotoReady(ok.page, "/stock/aforos/cnt-01", "aforo-diferencias");
  await visibleText(ok.page, "-10,000 L").waitFor();
  await shot(ok.page, `existencias-aforo-diferencias-${width}`);

  await gotoReady(ok.page, "/stock/aforos/cnt-02", "aforo-aprobacion");
  await ok.page.getByRole("link", { name: "Ver la solicitud" }).waitFor();
  await shot(ok.page, `existencias-aforo-aprobacion-${width}`);

  await gotoReady(ok.page, "/stock/aforos/cnt-open", "aforo-arranque");
  await ok.page.getByText("Aforo de arranque del 31/12/2026").waitFor();
  await shot(ok.page, `existencias-aforo-arranque-${width}`);

  await gotoReady(ok.page, "/stock/aforos/nuevo", "aforo-nuevo");
  await ok.page.getByText("Bodega").first().waitFor();
  await shot(ok.page, `existencias-aforo-nuevo-${width}`);

  if (width === 1440) {
    await gotoReady(ok.page, `/stock?at=${encodeURIComponent(at)}`, "existencias-physical");
    await ok.page.getByRole("radio", { name: "CVPO" }).click();
    await ok.page.waitForSelector('[data-screen="existencias-physical"]');
    await visibleText(ok.page, "Tienda").waitFor();
    if ((await ok.page.getByText("INOX-03").filter({ visible: true }).count()) !== 0) throw new Error("CVPO sigue mostrando stock de P.O");
    await ok.page.getByRole("tab", { name: "Fiscal" }).click();
    await ok.page.getByText("CVPO no tiene libro fiscal").waitFor();
    await ok.page.getByRole("radio", { name: "Todas" }).click();

    await gotoReady(ok.page, "/stock/aforos/cnt-01", "aforo-diferencias");
    await ok.page.getByRole("button", { name: "Pedir contabilización" }).click();
    await ok.page.getByRole("dialog").getByRole("button", { name: "Pedir aprobación" }).click();
    await ok.page.waitForSelector('[data-screen="aforo-aprobacion"]');
    const href = await ok.page.getByRole("link", { name: "Ver la solicitud" }).getAttribute("href");
    if (href !== "/aprobaciones/apr-stock-new") throw new Error(`Enlace de aprobación inesperado: ${href}`);

    await gotoReady(ok.page, "/stock/aforos/cnt-neg", "aforo");
    const litres = ok.page.getByLabel("Litros contados").filter({ visible: true });
    await litres.fill("20000");
    await litres.blur();
    await visibleText(ok.page, "supera la capacidad").waitFor();
    await litres.fill("4000");
    await litres.blur();
    await ok.page.getByRole("button", { name: "Cerrar recuento" }).click();
    await ok.page.getByRole("dialog").getByRole("button", { name: "Cerrar recuento" }).click();
    await ok.page.getByText("quedaría en negativo").waitFor();

    await gotoReady(ok.page, "/stock/aforos/nuevo?kind=opening", "aforo-nuevo");
    await ok.page.getByRole("checkbox", { name: /Bodega/ }).check();
    await ok.page.getByRole("button", { name: "Crear aforo" }).click();
    await ok.page.getByText("No se puede repetir").waitFor();
  }

  await ok.close();

  const empty = await openContext(browser, viewport, "empty");
  await gotoReady(empty.page, `/stock?at=${encodeURIComponent(at)}`, "existencias-vacio");
  await empty.page.getByText("No hay existencias a esta fecha").waitFor();
  await shot(empty.page, `existencias-vacio-${width}`);
  await gotoReady(empty.page, "/stock/movimientos", "movimientos-vacio");
  await empty.page.getByText("No hay movimientos en este libro").waitFor();
  await shot(empty.page, `existencias-movimientos-vacio-${width}`);
  await gotoReady(empty.page, "/stock/aforos", "aforos-vacio");
  await empty.page.getByText("Aún no hay aforos").waitFor();
  await shot(empty.page, `existencias-aforos-vacio-${width}`);
  await empty.close();
}

async function main() {
  await mkdir(outDir, { recursive: true });
  for (const file of await readdir(outDir)) {
    if (file.startsWith("existencias-") && file.endsWith(".png")) await rm(path.join(outDir, file));
  }
  const { proc, logs } = startServer();
  try {
    await waitForServer(proc, logs);
    const browser = await chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    try {
      for (const viewport of viewports) {
        await captureWidth(browser, viewport.width, viewport.height);
      }
    } finally {
      await browser.close();
    }
  } finally {
    proc.kill("SIGTERM");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
