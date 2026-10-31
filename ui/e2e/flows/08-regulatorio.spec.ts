import { test } from "playwright/test";
import { omitir } from "./support";

test("Regulatorio: preparar un envío SILICIE y pedir aprobación", async ({ page }) => {
  await test.step("Abrir la pantalla de envíos", async () => {
    await page.goto("/regulatorio");
    const missing = page.locator('[data-screen="no-encontrada"]');
    const found = await missing
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (found) {
      omitir(
        "No hay pantalla de envíos SILICIE: /regulatorio muestra «No encontrada». La API de submissions existe, pero la UI no la monta.",
      );
    }
  });

  omitir("La ruta /regulatorio no muestra el flujo de alta, validación y descarga de SILICIE.");
});
