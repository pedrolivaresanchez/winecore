import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page, type Route } from "playwright";
import { lotTinto, meCellar, traceTinto, vesselDetail, vesselQr, vessels } from "./fixtures";

const port = 5219;
const baseUrl = `http://127.0.0.1:${port}`;
const outDir = "/opt/cursor/artifacts/screenshots";
const chromePath = "/usr/local/bin/google-chrome";

type Mode = "ok" | "empty";

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

function sumMl(lines: { role?: string; volume_ml?: number }[], role: string) {
  return lines.filter((line) => line.role === role).reduce((sum, line) => sum + Number(line.volume_ml ?? 0), 0);
}

async function installApi(page: Page, mode: Mode) {
  const drafts = new Map<string, Record<string, unknown>>();
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const method = route.request().method();

    if (pathname.endsWith("/v1/me")) return fulfill(route, meCellar);
    if (pathname.endsWith("/health")) return fulfill(route, { status: "ok", sha: "abc1234", schema_version: "0006", db: "local", writer: "leader" });

    if (pathname.endsWith("/v1/vessels") && method === "GET") {
      const items = mode === "empty" ? [] : vessels;
      return fulfill(route, { items, next_cursor: null, total: items.length });
    }

    const qr = pathname.match(/\/v1\/vessels\/([^/]+)\/qr$/);
    if (qr && method === "GET") {
      const label = vesselQr(decodeURIComponent(qr[1] ?? ""));
      if (!label) return fulfill(route, { code: "WC_NOT_FOUND", message: "Depósito no encontrado" }, 404);
      return fulfill(route, label);
    }

    const vessel = pathname.match(/\/v1\/vessels\/([^/]+)$/);
    if (vessel && method === "GET") {
      const detail = vesselDetail(decodeURIComponent(vessel[1] ?? ""));
      if (!detail) return fulfill(route, { code: "WC_NOT_FOUND", message: "Depósito no encontrado" }, 404);
      return fulfill(route, detail);
    }

    const trace = pathname.match(/\/v1\/lots\/([^/]+)\/traceability$/);
    if (trace && method === "GET") {
      const code = decodeURIComponent(trace[1] ?? "");
      if (code !== lotTinto.code) return fulfill(route, { code: "WC_NOT_FOUND", message: "Lote no encontrado" }, 404);
      return fulfill(route, traceTinto);
    }

    const lot = pathname.match(/\/v1\/lots\/([^/]+)$/);
    if (lot && method === "GET") {
      const code = decodeURIComponent(lot[1] ?? "");
      if (code !== lotTinto.code) return fulfill(route, { code: "WC_NOT_FOUND", message: "Lote no encontrado" }, 404);
      return fulfill(route, lotTinto);
    }

    if (pathname.endsWith("/v1/cellar-operations") && method === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const id = "op-draft-1";
      const saved = { id, number: null, status: "draft", approval_request_id: null, ...body };
      drafts.set(id, saved);
      return fulfill(route, saved, 201);
    }

    const confirm = pathname.match(/\/v1\/cellar-operations\/([^/]+)\/confirm$/);
    if (confirm && method === "POST") {
      const id = decodeURIComponent(confirm[1] ?? "");
      const saved = drafts.get(id);
      if (!saved) return fulfill(route, { code: "WC_NOT_FOUND", message: "Operación no encontrada" }, 404);
      const opType = String(saved.op_type ?? "");
      const lines = Array.isArray(saved.lines) ? (saved.lines as { role?: string; volume_ml?: number; loss_kind?: string }[]) : [];
      const incident = lines.some((line) => line.loss_kind === "incident");
      if (opType === "destruction" || incident) {
        return fulfill(route, { ...saved, status: "draft", approval_request_id: "apr-bodega-2" });
      }
      if (opType === "racking" || opType === "blend" || opType === "filtration" || opType === "bottling") {
        const inn = sumMl(lines, "input");
        const out = sumMl(lines, "output");
        const loss = sumMl(lines, "loss");
        if (inn !== out + loss) {
          return fulfill(
            route,
            {
              code: "WC020",
              message: "El volumen no cuadra: entran 1.000,000 L y salen 999,000 L",
              details: { role: "output", vessel_code: "D-04" },
            },
            422,
          );
        }
      }
      return fulfill(route, { ...saved, status: "confirmed", number: "BO-2026-0201", approval_request_id: null });
    }

    const patch = pathname.match(/\/v1\/cellar-operations\/([^/]+)$/);
    if (patch && method === "PATCH") {
      const id = decodeURIComponent(patch[1] ?? "");
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const saved = { ...(drafts.get(id) ?? {}), ...body, id, status: "draft" };
      drafts.set(id, saved);
      return fulfill(route, saved);
    }

    console.error("api sin mock", method, pathname);
    return fulfill(route, { code: "WC_NOT_FOUND", message: pathname }, 404);
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
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("pageerror", error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") console.error("console", message.text());
  });
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
  try {
    await page.waitForSelector(`[data-screen="${ready}"]`, { timeout: 15_000 });
  } catch (error) {
    const text = await page.locator("body").innerText().catch(() => "");
    const screens = await page.locator("[data-screen]").evaluateAll((els) => els.map((el) => el.getAttribute("data-screen"))).catch(() => []);
    console.error("Pantalla inesperada", page.url(), screens, text.slice(0, 1200));
    throw error;
  }
}

async function openSection(page: Page, width: number, id: string, label: string) {
  if (width < 768) await page.locator("#deposito-seccion").selectOption(id);
  else await page.getByRole("tab", { name: label }).click();
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
    if (file.startsWith("bodega-") && file.endsWith(".png")) await rm(path.join(outDir, file));
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

        const map = await openContext(browser, viewport, "ok");
        await gotoReady(map.page, "/bodega", "bodega-mapa");
        await map.page.getByText("D-01").first().waitFor();
        await shot(map.page, `bodega-mapa-${width}`);
        if (width >= 768) {
          await map.page.getByRole("button", { name: "Tabla" }).click();
          await map.page.waitForSelector("[data-view='tabla']");
          await shot(map.page, `bodega-tabla-${width}`);
        }
        await map.page.getByRole("button", { name: "Escanear QR" }).click();
        await map.page.waitForSelector("[data-screen='bodega-qr']");
        await map.page.locator("#qr-url").fill("https://winecore.test/bodega/B-12");
        await shot(map.page, `bodega-qr-${width}`);
        await map.page.getByRole("button", { name: "Abrir depósito" }).click();
        await map.page.waitForSelector("[data-screen='bodega-deposito']");
        await map.page.getByRole("heading", { name: "B-12" }).waitFor();
        await map.close();

        const empty = await openContext(browser, viewport, "empty");
        await gotoReady(empty.page, "/bodega", "bodega-vacio");
        await empty.page.getByText("Aún no hay depósitos").waitFor();
        await shot(empty.page, `bodega-vacio-${width}`);
        await empty.close();

        const tank = await openContext(browser, viewport, "ok");
        await gotoReady(tank.page, "/bodega/D-01", "bodega-deposito");
        await tank.page.getByText("Tinto del Ensayo").waitFor();
        await shot(tank.page, `bodega-deposito-${width}`);
        await openSection(tank.page, width, "historial", "Historial");
        await tank.page.getByRole("link", { name: "Pendiente de aprobación" }).waitFor();
        await shot(tank.page, `bodega-historial-${width}`);
        await openSection(tank.page, width, "limpiezas", "Limpiezas");
        await tank.page.getByText("Ácido peracético").waitFor();
        await shot(tank.page, `bodega-limpiezas-${width}`);
        await openSection(tank.page, width, "qr", "QR");
        await tank.page.getByRole("button", { name: "Imprimir QR" }).waitFor();
        await shot(tank.page, `bodega-qr-deposito-${width}`);
        await tank.close();

        const lot = await openContext(browser, viewport, "ok");
        await gotoReady(lot.page, "/lotes/L25-T01", "bodega-lote");
        await lot.page.getByRole("heading", { name: "Genealogía" }).waitFor();
        await shot(lot.page, `bodega-lote-${width}`);
        await lot.close();

        const wizard = await openContext(browser, viewport, "ok");
        await gotoReady(wizard.page, "/bodega/operacion/nueva", "bodega-operacion");
        await wizard.page.getByRole("button", { name: /Trasiego/ }).click();
        await shot(wizard.page, `bodega-op-tipo-${width}`);
        await wizard.page.getByRole("button", { name: "Siguiente" }).click();
        await wizard.page.waitForSelector("[data-step='origenes']");
        await wizard.page.getByRole("button", { name: /D-01/ }).click();
        await wizard.page.locator("#origen-0-volumen").click();
        await shot(wizard.page, `bodega-op-origenes-${width}`);
        await wizard.page.locator("#origen-0-volumen").fill("1000");
        await wizard.page.getByRole("button", { name: "Siguiente" }).click();
        await wizard.page.waitForSelector("[data-step='destinos']");
        await wizard.page.getByRole("button", { name: /D-04/ }).click();
        await wizard.page.locator("#destino-0-volumen").fill("960");
        await wizard.page.locator("#destino-0-volumen").blur();
        await shot(wizard.page, `bodega-op-destinos-${width}`);
        await wizard.page.getByRole("button", { name: "Siguiente" }).click();
        await wizard.page.waitForSelector("[data-step='mermas']");
        await wizard.page.locator("#merma-0-volumen").fill("40");
        await wizard.page.locator("#merma-0-volumen").blur();
        await wizard.page.locator("[data-code='ok']").waitFor();
        await shot(wizard.page, `bodega-op-mermas-${width}`);
        await wizard.page.getByRole("button", { name: "Siguiente" }).click();
        await wizard.page.waitForSelector("[data-step='revision']");
        await wizard.page.locator("[data-code='ok']").waitFor();
        await shot(wizard.page, `bodega-op-revision-${width}`);
        await wizard.close();

        const broken = await openContext(browser, viewport, "ok");
        await gotoReady(broken.page, "/bodega/operacion/nueva", "bodega-operacion");
        await broken.page.getByRole("button", { name: /Trasiego/ }).click();
        await broken.page.getByRole("button", { name: "Siguiente" }).click();
        await broken.page.getByRole("button", { name: /D-01/ }).click();
        await broken.page.locator("#origen-0-volumen").fill("1000");
        await broken.page.getByRole("button", { name: "Siguiente" }).click();
        await broken.page.getByRole("button", { name: /D-04/ }).click();
        await broken.page.locator("#destino-0-volumen").fill("999");
        await broken.page.getByRole("button", { name: "Siguiente" }).click();
        await broken.page.getByRole("button", { name: "Siguiente" }).click();
        await broken.page.waitForSelector("[data-step='revision']");
        await broken.page.locator("[data-code='WC020']").first().waitFor();
        await shot(broken.page, `bodega-op-wc020-${width}`);
        const disabled = await broken.page.getByRole("button", { name: "Confirmar" }).isDisabled();
        if (!disabled) throw new Error("Confirmar debería quedar desactivado con WC020");
        await broken.close();

        const pending = await openContext(browser, viewport, "ok");
        await gotoReady(pending.page, "/bodega/operacion/nueva?tipo=destruction", "bodega-operacion");
        await pending.page.waitForSelector("[data-op='destruction']");
        await pending.page.getByRole("button", { name: "Siguiente" }).click();
        await pending.page.getByRole("button", { name: /D-01/ }).click();
        await pending.page.locator("#origen-0-volumen").fill("12");
        await pending.page.getByRole("button", { name: "Siguiente" }).click();
        await pending.page.getByRole("button", { name: "Siguiente" }).click();
        await pending.page.locator("#motivo").fill("Botellas rotas en el muelle");
        await pending.page.getByRole("button", { name: "Siguiente" }).click();
        await pending.page.getByRole("button", { name: "Confirmar" }).click();
        await pending.page.waitForSelector("[data-screen='bodega-operacion-pendiente']");
        await pending.page.getByRole("link", { name: "Pendiente de aprobación" }).waitFor();
        await shot(pending.page, `bodega-op-pendiente-${width}`);
        await pending.close();
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
