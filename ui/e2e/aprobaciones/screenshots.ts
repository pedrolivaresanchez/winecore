import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { installApprovalsApi, type ApiMode } from "./fixtures";

const port = 5213;
const baseUrl = `http://localhost:${port}`;
const outDir = "/opt/cursor/artifacts/screenshots";
const chromePath = "/usr/local/bin/google-chrome";

const viewports = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

async function assertInView(page: Page, name: string) {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (extra > 1) throw new Error(`${name} se sale ${extra}px`);
}

function visibleText(page: Page, text: string | RegExp) {
  return page.getByText(text).filter({ visible: true });
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(250);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  await assertInView(page, name);
  console.log(file);
}

async function armPasskey(page: Page) {
  try {
    const client = await page.context().newCDPSession(page);
    await client.send("WebAuthn.enable");
    await client.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
  } catch (error) {
    console.warn(`autenticador virtual no disponible: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function openContext(browser: Browser, viewport: { width: number; height: number }, mode: ApiMode) {
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
  await installApprovalsApi(page, mode);
  await armPasskey(page);
  return { page, errors, context };
}

async function gotoReady(page: Page, routePath: string, ready: string) {
  await page.goto(`${baseUrl}${routePath}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(`[data-screen="${ready}"]`, { timeout: 15_000 });
}

async function openAjustes(page: Page, width: number) {
  if (width < 768) {
    await page.getByRole("button", { name: "Más" }).click();
    await page.waitForSelector("[data-screen='mas']");
    await page.getByRole("button", { name: "Ajustes" }).click();
  } else {
    await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  }
  await page.waitForSelector("[data-screen='ajustes']");
}

function sheet(page: Page) {
  return page.locator("[data-screen='ajustes']");
}

function startServer() {
  const logs: string[] = [];
  const proc = spawn(process.execPath, ["run", "dev", "--", "--host", "localhost", "--port", String(port), "--strictPort"], {
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

async function run(browser: Browser, viewport: { width: number; height: number }, mode: ApiMode, task: (page: Page) => Promise<void>) {
  const ctx = await openContext(browser, viewport, mode);
  try {
    await task(ctx.page);
    if (ctx.errors.length > 0) throw new Error(ctx.errors.join(" | "));
  } finally {
    await ctx.context.close();
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  for (const file of await readdir(outDir)) {
    if (file.startsWith("aprobaciones-") && file.endsWith(".png")) await rm(path.join(outDir, file));
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

        await run(browser, viewport, "full", async (page) => {
          await gotoReady(page, "/aprobaciones", "aprobaciones");
          await visibleText(page, "SILICIE dic 2026 – jul 2027").waitFor();
          await page.getByRole("tab", { name: "Pendientes 5" }).waitFor();
          await shot(page, `aprobaciones-pendientes-${width}`);
        });

        await run(browser, viewport, "full", async (page) => {
          await gotoReady(page, "/aprobaciones", "aprobaciones");
          await page.getByRole("radio", { name: "P.O" }).click();
          await page.waitForFunction(() => {
            const ready = document.querySelector("[data-screen='aprobaciones']");
            const text = document.body.innerText;
            return Boolean(ready) && text.includes("SILICIE dic 2026 – jul 2027") && !text.includes("Destrucción de barricas");
          });
          await shot(page, `aprobaciones-entidad-${width}`);
        });

        await run(browser, viewport, "full", async (page) => {
          await gotoReady(page, "/aprobaciones", "aprobaciones");
          await page.getByRole("tab", { name: "Decididas" }).click();
          await visibleText(page, "Modelo 561 de septiembre").waitFor();
          await visibleText(page, "Caducada").first().waitFor();
          await shot(page, `aprobaciones-decididas-${width}`);
        });

        await run(browser, viewport, "empty", async (page) => {
          await gotoReady(page, "/aprobaciones", "aprobaciones-vacio");
          await page.getByText("No hay nada pendiente").waitFor();
          await shot(page, `aprobaciones-vacio-${width}`);
        });

        await run(browser, viewport, "full", async (page) => {
          await gotoReady(page, "/aprobaciones/apr-silicie", "aprobacion");
          await page.getByText("Qué se va a ejecutar").waitFor();
          await page.getByText("9F3A…C21B").waitFor();
          await shot(page, `aprobaciones-detalle-${width}`);
        });

        await run(browser, viewport, "full", async (page) => {
          await gotoReady(page, "/aprobaciones/apr-merma", "aprobacion");
          await page.getByText("Solo puede decidir: Propietario").waitFor();
          if ((await page.getByRole("button", { name: "Aprobar" }).count()) !== 0) {
            throw new Error("Se muestra Aprobar sin permiso para decidir");
          }
          await shot(page, `aprobaciones-sin-decidir-${width}`);
        });

        await run(browser, viewport, "full", async (page) => {
          await gotoReady(page, "/aprobaciones/apr-expired", "aprobacion");
          await page.getByText("Caducada. Se puede pedir de nuevo desde el origen.").waitFor();
          await shot(page, `aprobaciones-caducada-${width}`);
        });

        await run(browser, viewport, "full", async (page) => {
          await gotoReady(page, "/aprobaciones/apr-silicie", "aprobacion");
          await page.getByRole("button", { name: "Rechazar" }).click();
          const dialog = page.locator("[data-screen='rechazo']");
          await dialog.waitFor();
          await dialog.locator("#motivo").fill("corto");
          await dialog.getByRole("button", { name: "Rechazar" }).click();
          await dialog.getByText("Escribe entre 10 y 500 caracteres.").waitFor();
          await shot(page, `aprobaciones-rechazar-${width}`);
        });

        await run(browser, viewport, "full", async (page) => {
          await gotoReady(page, "/aprobaciones/apr-silicie", "aprobacion");
          await page.getByRole("button", { name: "Aprobar" }).click();
          const dialog = page.locator("[data-screen='verificacion']");
          await dialog.getByRole("button", { name: "Comprobar passkey" }).waitFor();
          await shot(page, `aprobaciones-stepup-${width}`);
          await dialog.getByRole("button", { name: "Usar código de la app" }).click();
          await dialog.locator("#totp-code").waitFor();
          await shot(page, `aprobaciones-stepup-totp-${width}`);
          await dialog.locator("#totp-code").fill("000000");
          await dialog.getByRole("button", { name: "Confirmar código" }).click();
          await dialog.getByText("El código no es válido").waitFor();
          await shot(page, `aprobaciones-stepup-error-${width}`);
          await dialog.locator("#totp-code").fill("123456");
          await dialog.getByRole("button", { name: "Confirmar código" }).click();
          await page.getByText("Aprobado. Se ejecutará en unos minutos.").waitFor();
          await page.locator("[data-status='approved']").waitFor();
          await shot(page, `aprobaciones-aprobada-${width}`);
        });

        await run(browser, viewport, "full", async (page) => {
          await gotoReady(page, "/aprobaciones/apr-wc040", "aprobacion");
          await page.getByRole("button", { name: "Aprobar" }).click();
          await page.getByText("El contenido ha cambiado desde que se pidió la aprobación").waitFor();
          await shot(page, `aprobaciones-wc040-${width}`);
        });

        await run(browser, viewport, "nocreds", async (page) => {
          await gotoReady(page, "/aprobaciones/apr-silicie", "aprobacion");
          await page.getByRole("button", { name: "Aprobar" }).click();
          const dialog = page.locator("[data-screen='verificacion']");
          await dialog.getByRole("button", { name: "Ir a Seguridad" }).waitFor();
          await shot(page, `aprobaciones-sin-metodo-${width}`);
          await dialog.getByRole("button", { name: "Ir a Seguridad" }).click();
          await page.waitForSelector("[data-screen='seguridad']");
          await page.getByText("Aún no hay passkeys").waitFor();
          await shot(page, `aprobaciones-seguridad-vacia-${width}`);
        });

        await run(browser, viewport, "full", async (page) => {
          await gotoReady(page, "/aprobaciones", "aprobaciones");
          await openAjustes(page, width);
          await sheet(page).getByText("Seguridad").waitFor();
          await sheet(page).getByText("Aprobaciones").waitFor();
          await shot(page, `aprobaciones-ajustes-${width}`);
          await sheet(page).getByRole("button", { name: "Seguridad" }).click();
          await page.waitForSelector("[data-screen='seguridad']");
          await page.getByText("iPhone de Pedro").waitFor();
          await shot(page, `aprobaciones-seguridad-${width}`);

          await page.locator("li", { hasText: "iPhone de Pedro" }).getByRole("button", { name: "Cambiar nombre" }).click();
          await page.waitForSelector("[data-screen='seguridad-renombrar']");
          await shot(page, `aprobaciones-seguridad-renombrar-${width}`);
          await page.locator("[data-screen='seguridad-renombrar']").getByRole("button", { name: "Cancelar" }).click();

          await page.locator("li", { hasText: "App de códigos" }).getByRole("button", { name: "Revocar" }).click();
          await page.waitForSelector("[data-screen='revocar']");
          await shot(page, `aprobaciones-seguridad-revocar-${width}`);
          await page.locator("[data-screen='revocar']").getByRole("button", { name: "Cancelar" }).click();

          await page.getByRole("button", { name: "Añadir passkey" }).click();
          await page.waitForSelector("[data-screen='seguridad-passkey']");
          await page.locator("#passkey-label").fill("Portátil de la oficina");
          await shot(page, `aprobaciones-seguridad-passkey-${width}`);
          await page.getByRole("button", { name: "Registrar passkey" }).click();
          const passkeyResult = await page
            .waitForFunction(() => {
              if (document.body.innerText.includes("Passkey registrada")) return "ok";
              const alert = document.querySelector("[data-screen='seguridad-passkey'] [role='alert']");
              if (alert?.textContent) return "error";
              return "";
            }, null, { timeout: 8_000 })
            .then(async (handle) => handle.jsonValue())
            .catch(() => "timeout");
          if (passkeyResult === "ok") await shot(page, `aprobaciones-seguridad-passkey-ok-${width}`);
          else {
            console.warn(`passkey ${width}: ${passkeyResult}`);
            await shot(page, `aprobaciones-seguridad-passkey-error-${width}`);
            await page.locator("[data-screen='seguridad-passkey']").getByRole("button", { name: "Cancelar" }).click();
          }

          await page.locator("li", { hasText: "App de códigos" }).getByRole("button", { name: "Revocar" }).click();
          await page.locator("[data-screen='revocar']").getByRole("button", { name: "Revocar" }).click();
          await page.getByRole("button", { name: "Añadir código" }).waitFor();
          await page.getByRole("button", { name: "Añadir código" }).click();
          await page.waitForSelector("[data-screen='seguridad-totp'] img");
          await page.getByText("JBSW Y3DP EHPK 3PXP").waitFor();
          await page.locator("[data-sonner-toast]").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
          await page.locator("[data-screen='seguridad-totp']").evaluate((node) => {
            const scroller = node.closest(".overflow-y-auto");
            if (!(scroller instanceof HTMLElement)) return;
            const top = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
            scroller.scrollTop = top;
          });
          await shot(page, `aprobaciones-seguridad-totp-${width}`);

          await page.getByRole("button", { name: "Todos los ajustes" }).click();
          await sheet(page).getByRole("button", { name: "Aprobaciones" }).click();
          await page.waitForSelector("[data-screen='politicas']");
          await sheet(page).getByText("Envío regulatorio").waitFor();
          await page.locator("[data-sonner-toast]").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
          await shot(page, `aprobaciones-politicas-${width}`);
          await page.getByRole("button", { name: "Editar" }).first().click();
          await page.waitForSelector("[data-screen='politicas-editar']");
          await page.getByText("Exigir passkey o código").waitFor();
          await page.getByRole("button", { name: "Guardar" }).scrollIntoViewIfNeeded();
          await shot(page, `aprobaciones-politicas-editar-${width}`);
        });

        await run(browser, viewport, "approver", async (page) => {
          await gotoReady(page, "/", "panel");
          await openAjustes(page, width);
          await sheet(page).getByText("Seguridad").waitFor();
          if ((await sheet(page).getByRole("button", { name: "Aprobaciones" }).count()) !== 0) {
            throw new Error("Aprobaciones visible sin ser propietario");
          }
          await shot(page, `aprobaciones-ajustes-sin-politicas-${width}`);
        });
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
