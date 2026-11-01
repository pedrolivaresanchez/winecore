import { expect, type Page } from "playwright/test";
import { measure, MOBILE_CONTEXT, type Finding } from "../mobile/measure";
import { seedMobile, type SeedIds } from "../mobile/seed";
import { readState, writeState } from "./support";

/** Contexto de los flujos móviles: 390x844, DPR 2, táctil, UA de iPhone, es-ES. */
export const MOVIL = { ...MOBILE_CONTEXT, viewport: { ...MOBILE_CONTEXT.viewport } };

/** Fallos que impiden usar la pantalla con un pulgar: nada de esto puede quedar en ningún paso. */
const BLOQUEANTES: Finding["kind"][] = [
  "page-overflow",
  "viewport-overflow",
  "dialog-tall",
  "dialog-no-scroll",
  "dialog-cta-offscreen",
  "font-size",
];

/** Falla si la pantalla se desborda en horizontal o si un diálogo no cabe, con el paso en el mensaje. */
export async function sinDesborde(page: Page, paso: string): Promise<void> {
  await page.waitForTimeout(250);
  const medida = await measure(page);
  expect(medida.scrollWidth, `${paso}: la página se desborda en horizontal`).toBeLessThanOrEqual(medida.clientWidth + 1);
  const graves = medida.findings.filter((hallazgo) => BLOQUEANTES.includes(hallazgo.kind));
  expect(
    graves.map((hallazgo) => `${hallazgo.kind} ${hallazgo.where} ${hallazgo.detail}`),
    `${paso}: hay elementos que no caben en 390 px`,
  ).toEqual([]);
}

/** Datos sintéticos de la API (presupuestos, pedidos, albaranes, facturas, cobro, gastos, aprobación). Se crean una vez por pasada. */
export async function datosMovil(): Promise<SeedIds> {
  const guardados = readState().movil;
  if (guardados) return guardados;
  const origen = process.env.E2E_BASE_URL ?? "http://localhost:5240";
  const ids = await seedMobile(`${origen}/api`);
  writeState({ movil: ids });
  return ids;
}
