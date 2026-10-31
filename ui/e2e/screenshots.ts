import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page, type Route } from "playwright";
import { auditEvents, contactDetail, filterContacts, healthOk, meForbidden, meOk } from "./fixtures";

const port = 5199;
const baseUrl = `http://127.0.0.1:${port}`;
const outDir = "/opt/cursor/artifacts/screenshots";
const chromePath = "/usr/local/bin/google-chrome";

type Mode = "ok" | "empty" | "forbidden";

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

function pageOf(url: URL) {
  const matched = filterContacts(url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const start = Number(url.searchParams.get("cursor") ?? "0");
  const items = matched.slice(start, start + limit);
  const next = start + limit < matched.length ? String(start + limit) : null;
  return { items, next_cursor: next, total: matched.length };
}

async function installApi(page: Page, mode: Mode) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const method = route.request().method();

    if (pathname.endsWith("/health")) return fulfill(route, healthOk);
    if (pathname.endsWith("/v1/me")) {
      if (mode === "forbidden") return fulfill(route, meForbidden, 403);
      return fulfill(route, meOk);
    }
    if (pathname.endsWith("/v1/contacts/export.csv")) {
      return route.fulfill({
        status: 200,
        contentType: "text/csv",
        body: "nombre,nif\nVinoteca La Encina S.L.,B00000000\n",
      });
    }
    if (pathname.endsWith("/v1/audit")) {
      const row = url.searchParams.get("row_id");
      const limit = Number(url.searchParams.get("limit") ?? "20");
      const items = auditEvents
        .filter((event) => !row || event.row_id === row)
        .slice(0, Number.isFinite(limit) ? limit : 20)
        .map((event) => ({
          id: event.id,
          occurred_at: event.occurred_at,
          actor: event.actor,
          action: event.action,
          changes: event.changes,
          row_id: event.row_id,
        }));
      return fulfill(route, { items, next_cursor: null });
    }
    if (pathname.endsWith("/v1/contacts") && method === "GET") {
      if (mode === "empty") return fulfill(route, { items: [], next_cursor: null, total: 0 });
      return fulfill(route, pageOf(url));
    }
    if (pathname.endsWith("/v1/contacts") && method === "POST") {
      const body = route.request().postDataJSON() as { tax_id?: string; legal_name?: string };
      const tax = (body.tax_id ?? "").replace(/[\s.-]/g, "").toUpperCase();
      if (tax === "00000000T") {
        return fulfill(
          route,
          {
            code: "WC_CONTACT_DUPLICATE_TAX_ID",
            message: "Ya existe un contacto con este NIF",
            details: { existing_id: "c-nora", existing_name: "Nora Vidal" },
          },
          409,
        );
      }
      return fulfill(
        route,
        contactDetail("c-encina"),
        201,
      );
    }
    const contactMatch = pathname.match(/\/v1\/contacts\/([^/]+)$/);
    if (contactMatch && method === "GET") return fulfill(route, contactDetail(contactMatch[1] ?? ""));
    if (contactMatch && method === "PATCH") return fulfill(route, contactDetail(contactMatch[1] ?? ""));
    if (pathname.endsWith("/archive") || pathname.endsWith("/unarchive")) {
      return fulfill(route, contactDetail("c-encina"));
    }
    if (pathname.includes("/addresses") && method === "POST") {
      return fulfill(route, { id: "a-new", kind: "billing", label: null, line1: "Nueva", line2: null, postal_code: null, city: "Haro", province: null, country_code: "ES", is_default: false }, 201);
    }
    if (pathname.includes("/persons") && method === "POST") {
      return fulfill(route, { id: "p-new", full_name: "Nueva", role: null, email: null, phone: null, receives_invoices: false, receives_dunning: false }, 201);
    }
    return fulfill(route, { code: "WC_NOT_FOUND", message: "No encontrado" }, 404);
  });
}

async function assertInView(page: Page, name: string) {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (extra > 1) throw new Error(`${name} se sale ${extra}px`);
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(200);
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
    if (logs.length > 30) logs.shift();
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
    if (file.endsWith(".png") && !file.startsWith("sdr-") && !file.startsWith("side-by-side-")) {
      await rm(path.join(outDir, file));
    }
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
        const panel = await openContext(browser, viewport, "ok");
        await gotoReady(panel.page, "/", "panel");
        await panel.page.getByText("Acciones rápidas").waitFor();
        await shot(panel.page, `panel-${width}`);
        if (width >= 1280) {
          await panel.page.getByRole("button", { name: "Plegar menú" }).click();
          await shot(panel.page, `shell-collapsed-${width}`);
        }
        await panel.close();

        const list = await openContext(browser, viewport, "ok");
        await gotoReady(list.page, "/contactos", "contactos");
        await shot(list.page, `contactos-${width}`);
        await list.page.getByRole("link", { name: "Vinoteca La Encina S.L." }).click();
        await list.page.waitForSelector("[data-screen='contacto-preview']");
        await list.page.getByText("Luis Encina").waitFor();
        await shot(list.page, `contacto-preview-${width}`);
        await list.page.keyboard.press("Escape");
        await list.page.getByRole("button", { name: "Columnas" }).click();
        await list.page.getByRole("menuitemcheckbox", { name: "NIF" }).waitFor();
        await shot(list.page, `menu-${width}`);
        await list.close();

        const create = await openContext(browser, viewport, "ok");
        await gotoReady(create.page, "/contactos/nuevo", "contacto-nuevo");
        await create.page.getByRole("button", { name: "Crear contacto" }).click();
        await create.page.locator("#legal_name-error").waitFor();
        await shot(create.page, `contacto-nuevo-${width}`);
        await create.close();

        const duplicate = await openContext(browser, viewport, "ok");
        await gotoReady(duplicate.page, "/contactos/nuevo", "contacto-nuevo");
        await duplicate.page.locator("#legal_name").fill("Bodega Duplicada S.L.");
        await duplicate.page.locator("#tax_id").fill("00000000T");
        await duplicate.page.getByRole("button", { name: "Crear contacto" }).click();
        await duplicate.page.getByText("Ya existe Nora Vidal con este NIF").waitFor();
        await shot(duplicate.page, `contacto-duplicado-${width}`);
        await duplicate.close();

        const ficha = await openContext(browser, viewport, "ok");
        await gotoReady(ficha.page, "/contactos/c-encina", "ficha");
        await shot(ficha.page, `ficha-resumen-${width}`);
        await ficha.page.getByRole("tab", { name: "Direcciones" }).click();
        await ficha.page.getByText("Calle de la Encina 12").waitFor();
        await shot(ficha.page, `ficha-direcciones-${width}`);
        await ficha.page.getByRole("tab", { name: "Personas" }).click();
        await ficha.page.getByText("Luis Encina").waitFor();
        await shot(ficha.page, `ficha-personas-${width}`);
        await ficha.page.getByRole("tab", { name: "Historial" }).click();
        await ficha.page.locator("[data-screen='ficha']").getByText("Ana Rivas").waitFor();
        await shot(ficha.page, `ficha-historial-${width}`);
        await ficha.close();

        const empty = await openContext(browser, viewport, "empty");
        await gotoReady(empty.page, "/contactos", "contactos-vacio");
        await shot(empty.page, `contactos-vacio-${width}`);
        await empty.close();
      }

      const mobile = await openContext(browser, viewports[0], "ok");
      await gotoReady(mobile.page, "/", "panel");
      await mobile.page.getByRole("button", { name: "Desplegar menú" }).click();
      await mobile.page.waitForSelector("[data-screen='rail']");
      await shot(mobile.page, "mas-390");
      await mobile.page.getByRole("button", { name: "Ajustes" }).click();
      await mobile.page.waitForSelector("[data-screen='ajustes']");
      await mobile.page.getByRole("heading", { name: "Entidades y usuarios" }).waitFor();
      await shot(mobile.page, "ajustes-390");
      await mobile.close();

      const desktop = await openContext(browser, viewports[1], "ok");
      await gotoReady(desktop.page, "/", "panel");
      await desktop.page.getByRole("button", { name: "Ajustes" }).click();
      await desktop.page.waitForSelector("[data-screen='ajustes']");
      await desktop.page.getByRole("heading", { name: "Entidades y usuarios" }).waitFor();
      await shot(desktop.page, "ajustes-1440");
      await desktop.close();
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
