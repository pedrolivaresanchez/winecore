import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page, type Route } from "playwright";
import { healthError, healthOk, meForbidden, meOk } from "./fixtures";

const port = 5199;
const baseUrl = `http://127.0.0.1:${port}`;
const outDir = "/opt/cursor/artifacts/screenshots";
const chromePath = "/usr/local/bin/google-chrome";

type Mode = "ok" | "forbidden" | "health-error";

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

async function installApi(page: Page, mode: Mode) {
  await page.route("**/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/health")) {
      if (mode === "health-error") return fulfill(route, healthError, 503);
      return fulfill(route, healthOk);
    }
    if (pathname.endsWith("/v1/me")) {
      if (mode === "forbidden") return fulfill(route, meForbidden, 403);
      return fulfill(route, meOk);
    }
    return fulfill(route, { code: "WC_NOT_FOUND", message: "No encontrado" }, 404);
  });
}

async function overflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return {
      extra: root.scrollWidth - root.clientWidth,
      offenders: Array.from(document.querySelectorAll("body *"))
        .map((node) => {
          const box = node.getBoundingClientRect();
          return { node, box };
        })
        .filter(({ box }) => box.width > 0 && (box.right > window.innerWidth + 1 || box.left < -1))
        .slice(0, 8)
        .map(({ node, box }) => ({
          tag: node.tagName,
          className: node instanceof HTMLElement ? node.className.toString().slice(0, 120) : "",
          left: Math.round(box.left),
          right: Math.round(box.right),
        })),
    };
  });
}

async function shoot(
  browser: Browser,
  name: string,
  routePath: string,
  mode: Mode,
  viewport: { width: number; height: number },
  ready: string,
  after?: (page: Page) => Promise<void>,
) {
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
  await page.goto(`${baseUrl}${routePath}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(`[data-screen="${ready}"]`, { timeout: 15_000 });
  if (ready === "panel" && mode === "ok") {
    await page.getByRole("heading", { name: "Panel" }).waitFor();
    await page.getByText("Ana Rivas").waitFor();
    await page.getByText("abc1234").waitFor();
    await page.getByText("Estado del sistema").waitFor();
  }
  if (ready === "contactos") await page.getByText("Aún no hay contactos").waitFor();
  if (ready === "sin-acceso") {
    await page.getByRole("heading", { name: "No tienes acceso a WineCore" }).waitFor();
  }
  await page.evaluate(() => document.fonts.ready);
  if (after) await after(page);
  await page.waitForTimeout(150);
  const file = path.join(outDir, `${name}-${viewport.width}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const layout = await overflow(page);
  await context.close();
  if (errors.length > 0) throw new Error(`${name}-${viewport.width}: ${errors.join(" | ")}`);
  if (layout.extra > 1) {
    throw new Error(`${name}-${viewport.width} se sale ${layout.extra}px: ${JSON.stringify(layout.offenders)}`);
  }
  console.log(file);
}

function startServer() {
  const logs: string[] = [];
  const proc = spawn(
    process.execPath,
    ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: process.cwd(),
      env: { ...process.env, VITE_AUTH_ENABLED: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
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
  let last = "";
  while (Date.now() - started < 30_000) {
    if (proc.exitCode !== null) {
      throw new Error(`Vite terminó con ${proc.exitCode}\n${logs.join("")}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : "sin conexión";
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite no arrancó (${last})\n${logs.join("")}`);
}

function stop(proc: ChildProcess) {
  if (proc.exitCode !== null) return;
  proc.kill("SIGTERM");
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const { proc, logs } = startServer();
  try {
    await waitForServer(proc, logs);
    const browser = await chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    try {
      const pages = [
        { name: "panel", path: "/", ready: "panel" },
        { name: "contactos", path: "/contactos", ready: "contactos" },
        { name: "mas", path: "/mas", ready: "mas" },
        { name: "no-encontrada", path: "/no-existe", ready: "no-encontrada" },
      ];
      for (const viewport of viewports) {
        for (const item of pages) {
          await shoot(browser, item.name, item.path, "ok", viewport, item.ready);
        }
        await shoot(browser, "sin-acceso", "/", "forbidden", viewport, "sin-acceso");
        await shoot(browser, "panel-error", "/", "health-error", viewport, "panel", async (page) => {
          await page.waitForSelector("[data-health='error']");
        });
        await shoot(browser, "panel-menu", "/", "ok", viewport, "panel", async (page) => {
          await page.getByRole("button", { name: "Cuenta de ana@winecore.test" }).click();
          await page.getByRole("menuitem", { name: "Cerrar sesión" }).waitFor();
        });
      }
      await shoot(browser, "panel-oscuro", "/", "ok", { width: 390, height: 844 }, "panel", async (page) => {
        await page.getByRole("button", { name: "Cuenta de ana@winecore.test" }).click();
        await page.getByRole("menuitem", { name: "Usar tema oscuro" }).click();
        await page.waitForSelector("html.dark");
        await page.keyboard.press("Escape");
        await page.getByRole("menuitem", { name: "Cerrar sesión" }).waitFor({ state: "hidden" });
      });
      await shoot(browser, "panel-plegado", "/", "ok", { width: 1440, height: 900 }, "panel", async (page) => {
        await page.getByRole("button", { name: "Plegar menú" }).click();
        await page.getByRole("button", { name: "Desplegar menú" }).waitFor();
      });
    } finally {
      await browser.close();
    }
  } finally {
    stop(proc);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
