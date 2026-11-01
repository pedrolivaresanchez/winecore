/**
 * Auditoría móvil: recorre las rutas del menú y los diálogos de alta y edición en 390x844,
 * mide desbordes, objetivos táctiles, letra de los campos y diálogos, y guarda informe y capturas.
 *
 * Uso (con API y UI ya levantadas, y datos de e2e/mobile/seed.ts):
 *   AUDIT_BASE=http://127.0.0.1:5261 AUDIT_API=http://127.0.0.1:3161 AUDIT_TAG=antes \
 *     bun e2e/mobile/audit.ts [filtro-de-ruta]
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { measure, MOBILE_CONTEXT, type Finding } from "./measure";

const BASE = process.env.AUDIT_BASE ?? "http://127.0.0.1:5261";
const API = process.env.AUDIT_API ?? "http://127.0.0.1:3161";
const TAG = process.env.AUDIT_TAG ?? "antes";
const OUT = process.env.AUDIT_OUT ?? `/tmp/movil-audit/${TAG}`;
const CHROME = process.env.CHROME_PATH ?? "/usr/local/bin/google-chrome";
const FILTER = process.argv[2] ?? "";
const DESKTOP = process.env.AUDIT_DESKTOP === "1";

// Respuestas JSON de la API sin esquema: el rastreo solo las recorre.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function get(pathname: string): Promise<Json> {
  const response = await fetch(`${API}/v1${pathname}`, { headers: { "x-dev-user": "owner@winecore.test" } });
  if (!response.ok) return {};
  return (await response.json()) as Json;
}

type Route = { slug: string; url: string; screen?: string };

async function routes(): Promise<Route[]> {
  const first = async (pathname: string, pick: (item: Json) => boolean = () => true) =>
    (((await get(pathname)).items ?? []) as Json[]).find(pick);
  const vessel = await first("/vessels?limit=100", (item) => item.kind === "tank_storage" && item.lot_id);
  const barrel = await first("/vessels?limit=100", (item) => item.kind === "barrel");
  const lot = await first("/lots?limit=20");
  const product = await first("/products?limit=20", (item) => item.kind === "wine");
  const format = await first("/formats?limit=20");
  const list = await first("/price-lists?limit=20");
  const holder = await first("/cellar-holders?limit=20").catch(() => undefined);
  const recipe = await first("/recipes?limit=20").catch(() => undefined);
  const contact = await first("/contacts?role=customer&archived=false&limit=20", (item) => item.city);
  const quote = await first("/quotes?limit=5");
  const order = await first("/sales-orders?limit=5");
  const note = await first("/delivery-notes?limit=5");
  const invoices = ((await get("/invoices?limit=20")).items ?? []) as Json[];
  const draft = invoices.find((item) => item.status === "draft");
  const issued = invoices.find((item) => item.status === "issued");
  const expense = await first("/supplier-invoices?limit=20", (item) => item.status === "validated" || item.status === "approved");
  const captured = await first("/supplier-invoices?limit=20", (item) => item.status === "captured");
  const approval = await first("/approvals?limit=5");
  const count = await first("/stock-counts?limit=5").catch(() => undefined);
  const plot = await first("/vineyard/parcels?limit=5").catch(() => undefined);
  const remittance = await first("/remittances?limit=5");

  const list_: Route[] = [
    { slug: "panel", url: "/", screen: "panel" },
    { slug: "menu", url: "/" },
    { slug: "aprobaciones", url: "/aprobaciones" },
    approval && { slug: "aprobacion_detalle", url: `/aprobaciones/${approval.id}` },
    { slug: "contactos", url: "/contactos" },
    { slug: "contacto_nuevo", url: "/contactos/nuevo" },
    contact && { slug: "contacto_ficha", url: `/contactos/${contact.id}` },
    { slug: "informes", url: "/informes" },
    { slug: "catalogo", url: "/catalogo" },
    { slug: "producto_nuevo", url: "/catalogo/nuevo" },
    product && { slug: "producto_ficha", url: `/catalogo/${product.id}` },
    { slug: "catalogo_vinos", url: "/catalogo/vinos" },
    { slug: "catalogo_formatos", url: "/catalogo/formatos" },
    format && { slug: "formato_ficha", url: `/catalogo/formatos/${format.id}` },
    { slug: "catalogo_tarifas", url: "/catalogo/tarifas" },
    list && { slug: "tarifa_ficha", url: `/catalogo/tarifas/${list.id}` },
    { slug: "depositos_lista", url: "/bodega/depositos?vista=lista" },
    { slug: "plano", url: "/bodega/depositos?vista=plano" },
    { slug: "depositos_tarjetas", url: "/bodega/depositos?vista=tarjetas" },
    vessel && { slug: "deposito_ficha", url: `/bodega/depositos/${vessel.code}` },
    barrel && { slug: "barrica_ficha", url: `/bodega/depositos/${barrel.code}` },
    { slug: "contenedores", url: "/bodega/contenedores" },
    holder && { slug: "contenedor_ficha", url: `/bodega/contenedores/${holder.code}` },
    { slug: "lotes", url: "/bodega/lotes" },
    lot && { slug: "lote_ficha", url: `/bodega/lotes/${lot.id}` },
    { slug: "recetas", url: "/bodega/recetas" },
    recipe && { slug: "receta_ficha", url: `/bodega/recetas/${recipe.id}` },
    { slug: "anadas", url: "/bodega/anadas" },
    { slug: "lecturas", url: "/bodega/lecturas" },
    { slug: "fases", url: "/bodega/fases" },
    { slug: "analiticas", url: "/bodega/analiticas" },
    { slug: "operacion_nueva", url: "/bodega/operaciones/nueva" },
    { slug: "catas", url: "/bodega/catas" },
    { slug: "higiene", url: "/bodega/higiene" },
    { slug: "calculadoras", url: "/bodega/calculadoras" },
    { slug: "stock", url: "/stock" },
    { slug: "stock_movimientos", url: "/stock/movimientos" },
    { slug: "stock_informe", url: "/stock/informe" },
    { slug: "stock_aforos", url: "/stock/aforos" },
    { slug: "stock_aforo_nuevo", url: "/stock/aforos/nuevo" },
    count && { slug: "stock_aforo_ficha", url: `/stock/aforos/${count.id}` },
    { slug: "presupuestos", url: "/ventas/presupuestos" },
    { slug: "presupuesto_nuevo", url: "/ventas/presupuestos/nuevo" },
    quote && { slug: "presupuesto_ficha", url: `/ventas/presupuestos/${quote.id}` },
    { slug: "pedidos", url: "/ventas/pedidos" },
    { slug: "pedido_nuevo", url: "/ventas/pedidos/nuevo" },
    order && { slug: "pedido_ficha", url: `/ventas/pedidos/${order.id}` },
    { slug: "albaranes", url: "/ventas/albaranes" },
    { slug: "albaran_nuevo", url: "/ventas/albaranes/nuevo" },
    note && { slug: "albaran_ficha", url: `/ventas/albaranes/${note.id}` },
    { slug: "gastos", url: "/gastos" },
    { slug: "gastos_capturar", url: "/gastos/capturar" },
    { slug: "gastos_libro", url: "/gastos?libro=nuevos" },
    expense && { slug: "gasto_ficha", url: `/gastos/${expense.id}` },
    captured && { slug: "gasto_captura_ficha", url: `/gastos/${captured.id}` },
    { slug: "facturas_lista", url: "/facturas" },
    { slug: "factura_nueva", url: "/facturas/nueva" },
    draft && { slug: "factura_borrador", url: `/facturas/${draft.id}` },
    issued && { slug: "factura_emitida", url: `/facturas/${issued.id}` },
    issued && { slug: "factura_rectificar", url: `/facturas/${issued.id}/rectificar` },
    { slug: "cobros", url: "/cobros" },
    remittance && { slug: "remesa_ficha", url: `/cobros/remesas/${remittance.id}` },
    { slug: "intercompania", url: "/intercompania" },
    { slug: "intercompania_tarifas", url: "/intercompania/tarifas" },
    { slug: "vinedo", url: "/vinedo" },
    plot && { slug: "parcela_ficha", url: `/vinedo/${plot.code}` },
    { slug: "regulatorio", url: "/regulatorio" },
    { slug: "asistente", url: "/asistente" },
  ].filter(Boolean) as Route[];
  return list_;
}

type PageReport = {
  slug: string;
  step: string;
  url: string;
  width: number;
  scrollWidth: number;
  findings: Finding[];
  shot: string;
  error?: string;
};

const reports: PageReport[] = [];
const consoleErrors: { slug: string; message: string }[] = [];

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => undefined);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

function fileName(slug: string, step: string) {
  const clean = `${slug}${step ? `__${step}` : ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90);
  return clean;
}

async function record(page: Page, slug: string, step: string, url: string, fullPage = false) {
  const m = await measure(page);
  const shot = path.join("shots", `${fileName(slug, step)}.png`);
  await page.screenshot({ path: path.join(OUT, shot), fullPage });
  const viewport = page.viewportSize();
  reports.push({ slug, step, url, width: viewport?.width ?? 0, scrollWidth: m.scrollWidth, findings: m.findings, shot });
  return m;
}

const OPENERS =
  /^(Nuev[oa]s?\b|Crear|Añadir|Agregar|Registrar|Cobrar|Pagar|Importar|Editar|Subir|Capturar|Exportar|Filtrar|Filtros|Columnas|Ordenar|Agrupar|Vista|Escanear|Aforo|Inventario|Movimiento|Trasiego|Conciliar|Operaci[oó]n|Más acciones|Acciones|Opciones|Lectura|Anotar|Cambiar|Configurar|Gestionar|Cuentas|Remesa|Generar|Pedir|Solicitar|Rectificar|Duplicar|Enviar|Vincular|Asignar|Mover|Llenar|Vaciar|Medir|Calcular|Mostrar|Ver todo|Invitar|Más)/i;

const SKIP_BUTTON = /(Eliminar|Borrar|Anular|Emitir|Cerrar sesión|Archivar|Rechazar|Aprobar|Confirmar|Descartar|Desactivar|Revocar)/i;

async function openers(page: Page): Promise<string[]> {
  return page.evaluate(
    ({ source, skip }) => {
      const re = new RegExp(source, "i");
      const skipRe = new RegExp(skip, "i");
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("button, [role=button], a[role=button]"))) {
        if (el.closest('[role="dialog"]')) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") continue;
        const name = (el.getAttribute("aria-label") || el.innerText || "").replace(/\s+/g, " ").trim();
        if (!name || name.length > 60) continue;
        if (skipRe.test(name)) continue;
        if (!re.test(name)) continue;
        if (!out.includes(name)) out.push(name);
      }
      return out;
    },
    { source: OPENERS.source, skip: SKIP_BUTTON.source },
  );
}

async function closeOverlays(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const open = await page.locator('[role="dialog"], [role="menu"], [role="listbox"]').count();
    if (open === 0) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
}

async function tabs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const name = (el.getAttribute("aria-label") || el.innerText || "").replace(/\s+/g, " ").trim();
      if (name && !out.includes(name)) out.push(name);
    }
    return out;
  });
}

async function exploreButtons(page: Page, slug: string, url: string, area: string) {
  const buttons = await openers(page);
  for (const name of buttons.slice(0, 8)) {
    try {
      const handle = page.locator('[data-screen="ajustes"]').getByRole("button", { name, exact: true }).first();
      if ((await handle.count()) === 0) continue;
      await handle.click({ timeout: 3000 });
      await page.waitForTimeout(450);
      const overlay = await page.locator('[role="dialog"], [role="menu"], [role="listbox"]').count();
      if (overlay > 0) await record(page, slug, `${area}-abre-${name}`, url);
      await closeOverlays(page);
    } catch {
      await closeOverlays(page);
    }
  }
}

async function visitRoute(page: Page, route: Route) {
  const url = `${BASE}${route.url}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await settle(page);
  } catch (error) {
    reports.push({
      slug: route.slug,
      step: "",
      url: route.url,
      width: 0,
      scrollWidth: 0,
      findings: [],
      shot: "",
      error: String(error).slice(0, 200),
    });
    return;
  }
  if (route.slug === "menu") {
    const toggle = page.getByRole("button", { name: "Desplegar menú" });
    if (await toggle.count()) {
      await toggle.first().click();
      await page.waitForTimeout(500);
    }
  }
  await record(page, route.slug, "", route.url);
  if (route.slug === "menu") return;

  // Pestañas
  const names = await tabs(page);
  for (const name of names.slice(0, 8)) {
    try {
      await page.getByRole("tab", { name, exact: true }).first().click({ timeout: 3000 });
      await settle(page);
      await record(page, route.slug, `tab-${name}`, route.url);
    } catch {
      /* la pestaña no se deja pulsar: queda sin medir */
    }
  }
  if (names.length) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await settle(page);
  }

  // Diálogos y menús que abren los botones de acción
  const buttons = await openers(page);
  for (const name of buttons.slice(0, 14)) {
    try {
      const handle = page.getByRole("button", { name, exact: true }).first();
      if ((await handle.count()) === 0) continue;
      await handle.click({ timeout: 3000 });
      await page.waitForTimeout(450);
      const overlay = await page.locator('[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]').count();
      if (overlay > 0) {
        await record(page, route.slug, `abre-${name}`, route.url);
      }
      await closeOverlays(page);
      if (page.url() !== url && !page.url().startsWith(url.split("?")[0] ?? url)) {
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await settle(page);
      }
    } catch {
      await closeOverlays(page);
    }
  }
}


type Special = { slug: string; url: string; run: (page: Page, url: string) => Promise<void> };

async function openMenu(page: Page) {
  const toggle = page.getByRole("button", { name: "Desplegar menú" });
  if (await toggle.count()) {
    await toggle.first().click();
    await page.waitForTimeout(450);
  }
}

async function step(page: Page, slug: string, name: string, url: string, action: () => Promise<unknown>) {
  try {
    await action();
    await page.waitForTimeout(500);
    await record(page, slug, name, url);
  } catch (error) {
    reports.push({ slug, step: name, url, width: 0, scrollWidth: 0, findings: [], shot: "", error: String(error).slice(0, 160) });
  }
}

const AJUSTES_AREAS = [
  "Entidades",
  "Sociedades y numeración",
  "Personas",
  "Seguridad",
  "Políticas",
  "Enología",
  "Conectores",
  "Sistema",
];

const specials: Special[] = [
  {
    slug: "paleta",
    url: "/",
    run: async (page, url) => {
      await step(page, "paleta", "abierta", url, () => page.getByRole("button", { name: /^Buscar/ }).last().click());
      await step(page, "paleta", "escribe", url, () => page.keyboard.type("fact"));
    },
  },
  {
    slug: "ajustes",
    url: "/",
    run: async (page, url) => {
      await openMenu(page);
      await step(page, "ajustes", "cuenta", url, () => page.getByRole("button", { name: /Cuenta de/ }).first().click());
      await step(page, "ajustes", "lista", url, () => page.getByRole("menuitem", { name: "Ajustes" }).click());
      for (const area of AJUSTES_AREAS) {
        await step(page, "ajustes", area, url, async () => {
          if ((await page.locator('[data-screen="rail"]').count()) === 0) await openMenu(page);
          await page.locator('[data-screen="rail"]').getByRole("button", { name: new RegExp(`^${area}`) }).first().click({ timeout: 4000 });
        });
        await page.waitForTimeout(400);
        await exploreButtons(page, "ajustes", url, area);
      }
    },
  },
  {
    slug: "plano_interaccion",
    url: "/bodega/depositos?vista=plano",
    run: async (page, url) => {
      await step(page, "plano_interaccion", "deposito", url, () => page.getByRole("button", { name: /FERM-001/ }).first().click());
      await closeOverlays(page);
      await step(page, "plano_interaccion", "editar", url, () => page.getByRole("button", { name: "Editar", exact: true }).click());
    },
  },
  {
    slug: "operacion_trasiego",
    url: "/bodega/operaciones/nueva",
    run: async (page, url) => {
      await step(page, "operacion_trasiego", "tipo", url, () => page.getByRole("button", { name: /Trasiego/ }).first().click());
      await step(page, "operacion_trasiego", "siguiente-1", url, () => page.getByRole("button", { name: "Siguiente" }).click());
      await step(page, "operacion_trasiego", "siguiente-2", url, () => page.getByRole("button", { name: "Siguiente" }).click());
    },
  },
  {
    slug: "cobro_dialogo",
    url: "/cobros",
    run: async (page, url) => {
      await step(page, "cobro_dialogo", "cobrar", url, () => page.getByRole("button", { name: "Cobrar", exact: true }).first().click());
    },
  },
  {
    slug: "aprobacion_decidir",
    url: "/aprobaciones",
    run: async (page, url) => {
      await step(page, "aprobacion_decidir", "lista", url, () => page.waitForTimeout(100));
      await step(page, "aprobacion_decidir", "abre", url, () => page.locator('a[href^="/aprobaciones/"]').first().click());
      await step(page, "aprobacion_decidir", "mas", url, () => page.getByRole("button", { name: "Más acciones" }).first().click());
    },
  },
];

function summarize(list: PageReport[]) {
  const counts = new Map<string, number>();
  for (const item of list) for (const f of item.findings) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort());
}

function markdown(list: PageReport[]): string {
  const lines: string[] = [];
  lines.push(`# Auditoría móvil (${TAG})`, "", `Viewport ${DESKTOP ? "1440x900" : "390x844"}. Resumen por tipo: \`${JSON.stringify(summarize(list))}\``, "");
  lines.push("| Pantalla / paso | page-overflow | viewport-overflow | clipped | touch (<40) | font<16 | diálogo | captura |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const item of list) {
    const n = (kind: string) => item.findings.filter((f) => f.kind === kind).length;
    const dialogs = n("dialog-tall") + n("dialog-cta-offscreen") + n("dialog-no-scroll");
    lines.push(
      `| ${item.slug}${item.step ? ` › ${item.step}` : ""}${item.error ? ` ⚠ ${item.error}` : ""} | ${n("page-overflow")} | ${n("viewport-overflow")} | ${n("clipped")} | ${n("touch-target")} | ${n("font-size")} | ${dialogs} | ${item.shot} |`,
    );
  }
  lines.push("");
  for (const item of list) {
    const relevant = item.findings.filter((f) => f.kind !== "truncated" && f.kind !== "touch-target-inline");
    if (relevant.length === 0) continue;
    lines.push(`## ${item.slug}${item.step ? ` › ${item.step}` : ""}`, "");
    for (const f of relevant.slice(0, 40)) lines.push(`- **${f.kind}** ${f.where} — ${f.detail}`);
    if (relevant.length > 40) lines.push(`- … y ${relevant.length - 40} más`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(path.join(OUT, "shots"), { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const context = await browser.newContext(
    DESKTOP
      ? { viewport: { width: 1440, height: 900 }, locale: "es-ES", timezoneId: "Europe/Madrid", reducedMotion: "reduce" }
      : { ...MOBILE_CONTEXT },
  );
  let page = await context.newPage();
  let current = "";
  page.on("pageerror", (error) => consoleErrors.push({ slug: current, message: error.message }));
  const list = (await routes()).filter((route) => !FILTER || route.slug.includes(FILTER) || route.url.includes(FILTER));
  for (const route of list) {
    current = route.slug;
    process.stdout.write(`· ${route.slug} `);
    const before = reports.length;
    try {
      await visitRoute(page, route);
    } catch (error) {
      reports.push({ slug: route.slug, step: "", url: route.url, width: 0, scrollWidth: 0, findings: [], shot: "", error: String(error).slice(0, 160) });
      if (page.isClosed() || String(error).includes("crashed")) {
        page = await context.newPage();
        page.on("pageerror", (err) => consoleErrors.push({ slug: current, message: err.message }));
      }
    }
    const mine = reports.slice(before);
    const bad = mine.reduce(
      (total, item) => total + item.findings.filter((f) => !["truncated", "touch-target-inline"].includes(f.kind)).length,
      0,
    );
    console.log(`(${mine.length} medidas, ${bad} hallazgos)`);
  }
  for (const item of specials.filter((entry) => !FILTER || entry.slug.includes(FILTER) || entry.url.includes(FILTER))) {
    current = item.slug;
    process.stdout.write(`· ${item.slug} `);
    const before = reports.length;
    try {
      await page.goto(`${BASE}${item.url}`, { waitUntil: "domcontentloaded" });
      await settle(page);
      await item.run(page, item.url);
    } catch (error) {
      reports.push({ slug: item.slug, step: "", url: item.url, width: 0, scrollWidth: 0, findings: [], shot: "", error: String(error).slice(0, 160) });
    }
    console.log(`(${reports.length - before} medidas)`);
  }
  await browser.close();
  await writeFile(path.join(OUT, "report.json"), JSON.stringify({ tag: TAG, summary: summarize(reports), reports, consoleErrors }, null, 2));
  await writeFile(path.join(OUT, "report.md"), markdown(reports));
  console.log(`\nInforme: ${OUT}/report.md`);
  console.log(JSON.stringify(summarize(reports)));
}

await main();
