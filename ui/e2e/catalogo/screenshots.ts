import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page, type Route } from "playwright";
import {
  auditEvents,
  balances,
  filterProducts,
  formats,
  healthOk,
  meOk,
  priceLists,
  productPrices,
  products,
  versions,
  wines,
} from "./fixtures.ts";

const port = 5217;
const baseUrl = `http://127.0.0.1:${port}`;
const outDir = "/opt/cursor/artifacts/screenshots";
const chromePath = "/usr/local/bin/google-chrome";

type Mode = "ok" | "empty" | "stock-off";

const viewports = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

type Version = {
  id: string;
  price_list_id: string;
  version: number;
  valid_from: string;
  valid_to: string | null;
  status: string;
  notes: string | null;
  approval_request_id: string | null;
  activated_at: string | null;
  created_by: string;
  created_at: string;
  items: { id?: string; product_id: string; product_sku?: string | null; product_name?: string | null; min_qty: string; unit_price: string }[];
};

function fulfill(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function pageOf<T>(url: URL, rows: T[]) {
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const start = Number(url.searchParams.get("cursor") ?? "0");
  const items = rows.slice(start, start + limit);
  const next = start + limit < rows.length ? String(start + limit) : null;
  return { items, next_cursor: next, total: rows.length };
}

function emptyPage() {
  return { items: [], next_cursor: null, total: 0 };
}

async function installApi(page: Page, mode: Mode) {
  const versionBook = JSON.parse(JSON.stringify(versions)) as Record<string, Version[]>;

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();

    if (pathname === "/health") return fulfill(route, healthOk);
    if (pathname === "/v1/me") return fulfill(route, meOk);

    if (pathname === "/v1/products/export.csv") {
      return route.fulfill({ status: 200, contentType: "text/csv", body: "sku,nombre\nENEBRO-2025-B075,Alto del Enebro 2025 0,75 L\n" });
    }

    const pricesMatch = pathname.match(/^\/v1\/products\/([^/]+)\/prices$/);
    if (pricesMatch && method === "GET") {
      const items = mode === "empty" ? [] : productPrices(pricesMatch[1] ?? "");
      return fulfill(route, { items, next_cursor: null, total: items.length });
    }

    const gtinMatch = pathname.match(/^\/v1\/products\/([^/]+)\/gtin-current$/);
    if (gtinMatch && method === "POST") {
      return fulfill(route, { gtin: "8400000000017", product_id: gtinMatch[1] });
    }

    const productMatch = pathname.match(/^\/v1\/products\/([^/]+)$/);
    if (productMatch && method === "GET") {
      const row = products.find((item) => item.id === productMatch[1]);
      if (!row || mode === "empty") return fulfill(route, { code: "WC_NOT_FOUND", message: "No encontrado" }, 404);
      return fulfill(route, row);
    }
    if (productMatch && method === "PATCH") {
      const row = products.find((item) => item.id === productMatch[1]);
      if (!row) return fulfill(route, { code: "WC_NOT_FOUND", message: "No encontrado" }, 404);
      const body = route.request().postDataJSON() as Record<string, unknown>;
      return fulfill(route, { ...row, ...body, updated_at: new Date().toISOString() });
    }

    if (pathname === "/v1/products" && method === "GET") {
      if (mode === "empty") return fulfill(route, emptyPage());
      return fulfill(route, pageOf(url, filterProducts(url)));
    }
    if (pathname === "/v1/products" && method === "POST") {
      const body = route.request().postDataJSON() as { sku?: string; name?: string; kind?: string; wine_id?: string; vintage?: number; format_id?: string };
      const clash = products.find(
        (item) =>
          item.kind === "wine" &&
          body.kind === "wine" &&
          item.wine_id === body.wine_id &&
          item.format_id === body.format_id &&
          item.vintage === body.vintage,
      );
      if (clash) {
        return fulfill(
          route,
          { code: "WC_PRODUCT_DUPLICATE", message: "Ya existe", details: { existing_id: clash.id, existing_name: clash.name } },
          409,
        );
      }
      if (!body.sku || !body.name) {
        return fulfill(route, { code: "WC_VALIDATION", message: "Revisa los campos", fields: { sku: "El SKU es obligatorio.", name: "El nombre es obligatorio." } }, 422);
      }
      return fulfill(route, { ...products[0], id: "p-nuevo", sku: body.sku, name: body.name }, 201);
    }

    if (pathname === "/v1/wines" && method === "GET") return fulfill(route, mode === "empty" ? emptyPage() : pageOf(url, wines));
    if (pathname === "/v1/wines" && method === "POST") {
      const body = route.request().postDataJSON() as { code?: string; name?: string };
      if (!body.code || !body.name) {
        return fulfill(route, { code: "WC_VALIDATION", message: "Revisa los campos", fields: { code: "El código es obligatorio." } }, 422);
      }
      return fulfill(route, { id: "w-nuevo", ...body, color: "red", category: "wine", is_active: true, created_at: "2026-10-31T00:00:00Z" }, 201);
    }
    if (pathname === "/v1/formats" && method === "GET") return fulfill(route, mode === "empty" ? emptyPage() : pageOf(url, formats));
    if (pathname === "/v1/formats" && method === "POST") {
      const body = route.request().postDataJSON() as { code?: string; name?: string };
      return fulfill(route, { id: "f-nuevo", ...body, is_active: true }, 201);
    }

    if (pathname === "/v1/stock/balances" && method === "GET") {
      if (mode === "stock-off") {
        return fulfill(route, { code: "WC_MODULE_DISABLED", message: "Módulo desactivado" }, 404);
      }
      const productId = url.searchParams.get("product_id");
      const items = productId === "p-enebro-25" ? balances : [];
      return fulfill(route, { items, next_cursor: null, total: items.length });
    }

    if (pathname === "/v1/price-lists" && method === "GET") {
      return fulfill(route, mode === "empty" ? emptyPage() : pageOf(url, priceLists));
    }

    const itemsMatch = pathname.match(/^\/v1\/price-lists\/([^/]+)\/versions\/(\d+)\/items$/);
    if (itemsMatch && method === "PUT") {
      const listId = itemsMatch[1] ?? "";
      const number = Number(itemsMatch[2]);
      const version = versionBook[listId]?.find((item) => item.version === number);
      if (!version || version.status !== "draft") {
        return fulfill(route, { code: "WC050", message: "Versión de tarifa no editable" }, 409);
      }
      const body = route.request().postDataJSON() as { items?: Version["items"] };
      version.items = body.items ?? [];
      return fulfill(route, { items: version.items, next_cursor: null, total: version.items.length });
    }

    const activationMatch = pathname.match(/^\/v1\/price-lists\/([^/]+)\/versions\/(\d+)\/request-activation$/);
    if (activationMatch && method === "POST") {
      const listId = activationMatch[1] ?? "";
      const number = Number(activationMatch[2]);
      const version = versionBook[listId]?.find((item) => item.version === number);
      if (!version || version.status !== "draft") {
        return fulfill(route, { code: "WC050", message: "Versión de tarifa no editable" }, 409);
      }
      version.status = "pending";
      version.approval_request_id = "apr-nueva";
      return fulfill(route, { id: "apr-nueva", approval_request_id: "apr-nueva", status: "pending" });
    }

    const versionsMatch = pathname.match(/^\/v1\/price-lists\/([^/]+)\/versions$/);
    if (versionsMatch && method === "GET") {
      const items = mode === "empty" ? [] : (versionBook[versionsMatch[1] ?? ""] ?? []);
      return fulfill(route, { items, next_cursor: null, total: items.length });
    }
    if (versionsMatch && method === "POST") {
      const listId = versionsMatch[1] ?? "";
      const body = route.request().postDataJSON() as { valid_from?: string; valid_to?: string | null; notes?: string | null };
      const current = versionBook[listId] ?? [];
      const nextNumber = current.reduce((max, item) => Math.max(max, item.version), 0) + 1;
      const active = current.find((item) => item.status === "active");
      const created: Version = {
        id: `v-new-${nextNumber}`,
        price_list_id: listId,
        version: nextNumber,
        valid_from: body.valid_from ?? "2027-01-01",
        valid_to: body.valid_to ?? null,
        status: "draft",
        notes: body.notes ?? null,
        approval_request_id: null,
        activated_at: null,
        created_by: "Ana Rivas",
        created_at: "2026-10-31T12:00:00Z",
        items: active?.items ?? [],
      };
      versionBook[listId] = [created, ...current];
      return fulfill(route, created, 201);
    }

    if (pathname === "/v1/audit") {
      return fulfill(route, { items: auditEvents, next_cursor: null });
    }

    console.log("sin ruta", method, pathname);
    return fulfill(route, { code: "WC_NOT_FOUND", message: "No encontrado" }, 404);
  });
}

function visibleText(page: Page, text: string) {
  return page.getByText(text).filter({ visible: true }).first();
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

async function openContext(browser: Browser, viewport: { width: number; height: number }, mode: Mode) {
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

async function main() {
  await mkdir(outDir, { recursive: true });
  for (const file of await readdir(outDir)) {
    if (file.startsWith("catalogo-") && file.endsWith(".png")) await rm(path.join(outDir, file));
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
        const width = viewport.width;

        const list = await openContext(browser, viewport, "ok");
        await gotoReady(list.page, "/catalogo", "catalogo");
        await visibleText(list.page, "Alto del Enebro 2025 0,75 L").waitFor();
        await shot(list.page, `catalogo-lista-${width}`);
        const target =
          width < 768
            ? list.page.locator("button", { hasText: "Alto del Enebro 2025 0,75 L" })
            : list.page.locator("tr", { hasText: "Alto del Enebro 2025 0,75 L" });
        await target.first().click();
        await list.page.waitForSelector("[data-screen='producto-preview']");
        await list.page.getByRole("link", { name: "Abrir ficha" }).waitFor();
        await shot(list.page, `catalogo-preview-${width}`);
        await list.close();

        const invalid = await openContext(browser, viewport, "ok");
        await gotoReady(invalid.page, "/catalogo", "catalogo");
        await invalid.page.getByRole("button", { name: "Nuevo producto", exact: true }).click();
        await invalid.page.waitForSelector("[data-screen='producto-alta']");
        await invalid.page.getByRole("button", { name: "Crear producto" }).click();
        await invalid.page.locator("#sku-error").waitFor();
        await shot(invalid.page, `catalogo-validacion-${width}`);
        await invalid.close();

        const duplicate = await openContext(browser, viewport, "ok");
        await gotoReady(duplicate.page, "/catalogo", "catalogo");
        await duplicate.page.getByRole("button", { name: "Nuevo producto", exact: true }).click();
        await duplicate.page.locator("#sku").fill("NUEVO-2025-B075");
        await duplicate.page.locator("#name").fill("Copia de prueba");
        await duplicate.page.locator("#wine_id option", { hasText: "Alto del Enebro" }).waitFor({ state: "attached" });
        await duplicate.page.locator("#wine_id").selectOption({ label: "Alto del Enebro" });
        await duplicate.page.locator("#vintage").fill("2025");
        await duplicate.page.locator("#format_id").selectOption({ label: "B075 · Botella 0,75 L" });
        await duplicate.page.getByRole("button", { name: "Crear producto" }).click();
        await duplicate.page.getByText("Ya existe").waitFor();
        await shot(duplicate.page, `catalogo-duplicado-${width}`);
        await duplicate.close();

        const vinos = await openContext(browser, viewport, "ok");
        await gotoReady(vinos.page, "/catalogo/vinos", "vinos");
        await visibleText(vinos.page, "Alto del Enebro").waitFor();
        await shot(vinos.page, `catalogo-vinos-${width}`);
        await vinos.close();

        const ficha = await openContext(browser, viewport, "ok");
        await gotoReady(ficha.page, "/catalogo/p-enebro-25", "producto");
        await visibleText(ficha.page, "Bodega").waitFor();
        await visibleText(ficha.page, "Cliente final").waitFor();
        await shot(ficha.page, `catalogo-producto-${width}`);
        if (width >= 768) {
          await ficha.page.getByRole("button", { name: "Editar" }).click();
          await ficha.page.locator("#name").fill("A");
          await ficha.page.getByRole("button", { name: "Guardar" }).click();
          await ficha.page.locator("#name-error").waitFor();
          await shot(ficha.page, `catalogo-producto-validacion-${width}`);
        }
        await ficha.close();

        const stockOff = await openContext(browser, viewport, "stock-off");
        await gotoReady(stockOff.page, "/catalogo/p-enebro-25", "producto");
        await stockOff.page.getByText("El stock por almacén aparecerá cuando se active Existencias").waitFor();
        await shot(stockOff.page, `catalogo-stock-off-${width}`);
        await stockOff.close();

        const tarifas = await openContext(browser, viewport, "ok");
        await gotoReady(tarifas.page, "/catalogo/tarifas", "tarifas");
        await visibleText(tarifas.page, "Distribuidor").waitFor();
        await shot(tarifas.page, `catalogo-tarifas-${width}`);
        await tarifas.close();

        const tarifa = await openContext(browser, viewport, "ok");
        await gotoReady(tarifa.page, "/catalogo/tarifas/pl-dist", "tarifa");
        await tarifa.page.getByRole("tab", { name: /Borrador/ }).waitFor();
        await tarifa.page.getByText("Campaña de primavera.").waitFor();
        await shot(tarifa.page, `catalogo-tarifa-${width}`);
        await tarifa.close();

        const pending = await openContext(browser, viewport, "ok");
        await gotoReady(pending.page, "/catalogo/tarifas/pl-shop", "tarifa");
        await pending.page.getByRole("link", { name: "Pendiente de aprobación" }).waitFor();
        await visibleText(pending.page, "Pendiente de aprobación").waitFor();
        await shot(pending.page, `catalogo-tarifa-pendiente-${width}`);
        await pending.close();

        const empty = await openContext(browser, viewport, "empty");
        await gotoReady(empty.page, "/catalogo", "catalogo-vacio");
        await shot(empty.page, `catalogo-vacio-${width}`);
        await gotoReady(empty.page, "/catalogo/vinos", "vinos-vacio");
        await shot(empty.page, `catalogo-vinos-vacio-${width}`);
        await gotoReady(empty.page, "/catalogo/tarifas", "tarifas-vacio");
        await shot(empty.page, `catalogo-tarifas-vacio-${width}`);
        await empty.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    if (proc.exitCode === null) proc.kill("SIGTERM");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
