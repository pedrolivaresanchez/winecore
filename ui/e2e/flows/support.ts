import { readFileSync, writeFileSync } from "node:fs";
import type { Page } from "playwright/test";
import { test } from "playwright/test";

export const statePath = process.env.E2E_STATE_FILE ?? "/tmp/winecore-e2e-state.json";

export type RunState = {
  customerName?: string;
  invoiceNumber?: string;
  deliveryNoteId?: string;
};

export function readState(): RunState {
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as RunState;
  } catch {
    return {};
  }
}

export function writeState(patch: RunState): void {
  writeFileSync(statePath, JSON.stringify({ ...readState(), ...patch }));
}

/** Marca el caso como omitido. Playwright lanza y no sigue. */
export function omitir(reason: string): never {
  test.skip(true, reason);
  throw new Error(reason);
}

export async function pantalla(page: Page, name: string): Promise<void> {
  await page.locator(`[data-screen="${name}"]`).waitFor({ state: "visible" });
}

export async function pulsarVisible(page: Page, name: string | RegExp): Promise<void> {
  const buttons = page.getByRole("button", { name });
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (await button.isVisible()) {
      await button.click();
      return;
    }
  }
  throw new Error(`No hay un botón visible: ${String(name)}`);
}

/** Autenticador virtual de Chromium: la verificación reforzada de desarrollo. */
export async function armarPasskey(page: Page): Promise<void> {
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
}

export async function registrarPasskey(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Cuenta de/ }).click();
  await page.getByRole("menuitem", { name: "Ajustes" }).click();
  await page.getByRole("button", { name: "Seguridad" }).click();
  await pantalla(page, "seguridad");
  await page.getByRole("button", { name: "Añadir passkey" }).click();
  await page.locator("#passkey-label").fill("Llave de prueba");
  await page.getByRole("button", { name: "Registrar passkey" }).click();
  await page.getByText("Passkey registrada").waitFor();
  await page.getByRole("button", { name: /Cuenta de/ }).click();
  await page.getByRole("menuitem", { name: "Ajustes" }).click();
}
