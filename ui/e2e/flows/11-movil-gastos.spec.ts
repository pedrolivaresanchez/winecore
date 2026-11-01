import { expect, test, type Page } from "playwright/test";
import { datosMovil, MOVIL, sinDesborde } from "./movil";
import { pantalla } from "./support";

test.use(MOVIL);

/** Foto sintética de 3200x2400 con ruido: pesa varios MB, como la de una cámara. */
async function fotoGrande(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 3200;
    canvas.height = 2400;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Sin canvas");
    const data = context.createImageData(canvas.width, canvas.height);
    for (let index = 0; index < data.data.length; index += 4) {
      const grey = 200 + Math.floor(Math.random() * 55);
      data.data[index] = grey;
      data.data[index + 1] = grey;
      data.data[index + 2] = grey - 12;
      data.data[index + 3] = 255;
    }
    context.putImageData(data, 0, 0);
    context.fillStyle = "#222";
    context.font = "bold 160px sans-serif";
    context.fillText("FACTURA DE PRUEBA 58,08 EUR", 240, 400);
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Sin blob"))), "image/jpeg", 0.98),
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(text);
  });
  return Buffer.from(base64, "base64");
}

test("Móvil: subir la foto de un gasto y revisarlo", async ({ page }) => {
  await datosMovil();
  let foto: Buffer = Buffer.alloc(0);

  await test.step("La captura ofrece hacer foto o subir un archivo", async () => {
    await page.goto("/gastos/capturar");
    await pantalla(page, "gastos-captura");
    await expect(page.getByRole("button", { name: "Hacer foto" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Subir archivo" })).toBeVisible();
    await expect(page.locator("#captura-gasto")).toHaveAttribute("capture", "environment");
    await expect(page.locator("#captura-gasto")).toHaveAttribute("accept", "image/*,application/pdf");
    await expect(page.locator("#captura-gasto-archivo")).not.toHaveAttribute("capture", /.*/);
    await sinDesborde(page, "captura de gasto");
    foto = await fotoGrande(page);
    expect(foto.length, "la foto de prueba tiene que pesar más de 2 MB").toBeGreaterThan(2 * 1024 * 1024);
  });

  await test.step("La foto se comprime por debajo de 2 MB y se sube", async () => {
    const respuesta = page.waitForResponse(
      (resp) => resp.request().method() === "POST" && new URL(resp.url()).pathname === "/api/v1/supplier-invoices/capture",
    );
    await page.evaluate(() => {
      const original = XMLHttpRequest.prototype.send;
      (window as unknown as { __subidas: number[] }).__subidas = [];
      XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
        if (body instanceof FormData) {
          const archivo = body.get("file");
          if (archivo instanceof File) (window as unknown as { __subidas: number[] }).__subidas.push(archivo.size);
        }
        return original.call(this, body);
      };
    });
    await page.locator("#captura-gasto").setInputFiles({ name: "factura-camara.jpg", mimeType: "image/jpeg", buffer: foto });
    await respuesta;
    const subidas = await page.evaluate(() => (window as unknown as { __subidas: number[] }).__subidas);
    expect(subidas, "tiene que haber una sola subida").toHaveLength(1);
    expect(subidas[0], "el archivo enviado supera 2 MB: no se comprimió").toBeLessThan(2 * 1024 * 1024);
    expect(subidas[0], "no se envió nada").toBeGreaterThan(10_000);
    expect((await respuesta).ok()).toBe(true);
  });

  await test.step("Vista previa y estado de la subida", async () => {
    await expect(page.getByRole("img", { name: /Vista previa de factura-camara/ })).toBeVisible();
    await expect(page.getByText(/^Listo/)).toBeVisible();
    await sinDesborde(page, "foto subida");
  });

  await test.step("Revisar el gasto capturado", async () => {
    await page.getByRole("button", { name: "Revisar" }).tap();
    await page.waitForURL(/\/gastos\/[0-9a-f-]+$/i);
    await expect(page.getByText("Capturado").first()).toBeVisible();
    await sinDesborde(page, "gasto recién capturado");
  });
});

test("Móvil: completar y validar un gasto", async ({ page }) => {
  const datos = await datosMovil();
  const captura = await page.request.post("/api/v1/supplier-invoices/capture", {
    headers: { "idempotency-key": `movil-${Date.now()}`, "x-dev-user": "owner@winecore.test" },
    multipart: {
      entity: "CVPO",
      source: "photo",
      file: {
        name: "ticket.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(
          "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
        ),
      },
    },
  });
  expect(captura.ok()).toBe(true);
  const gasto = (await captura.json()) as { id: string };

  await test.step("Abrir el gasto y rellenar los datos", async () => {
    await page.goto(`/gastos/${gasto.id}`);
    await expect(page.getByText("Capturado").first()).toBeVisible();
    await sinDesborde(page, "gasto por completar");
    const proveedor = page.locator("#gasto-contacto");
    await expect(proveedor.locator("option").nth(1)).toBeAttached();
    await proveedor.selectOption({ value: datos.supplierId });
    await page.locator("#gasto-numero").fill(`F-MOVIL-${Date.now()}`);
    await page.locator('label[for="gasto-fecha"]').locator("xpath=..").getByRole("button").first().tap();
    await sinDesborde(page, "selector de fecha del gasto");
    await page.getByRole("button", { name: "Hoy", exact: true }).tap();
    await page.locator("#gasto-categoria").selectOption({ index: 1 });
    if (!(await page.locator("#linea-desc-0").isVisible())) {
      await page.getByRole("button", { name: "Añadir línea" }).tap();
    }
    await page.locator("#linea-desc-0").fill("Material de la prueba móvil");
    await page.locator("#linea-base-0").fill("48");
    await page.locator("#linea-iva-0").fill("21");
    await expect(page.locator("#gasto-total")).toHaveValue("58.08");
    await sinDesborde(page, "gasto relleno");
  });

  await test.step("Guardar y validar", async () => {
    await page.getByRole("button", { name: "Guardar" }).tap();
    await page.getByRole("button", { name: "Validar" }).tap();
    await expect(page.getByText(/Validado|Pendiente de aprobación|Aprobado/).first()).toBeVisible();
    await sinDesborde(page, "gasto validado");
  });
});

test("Móvil: decidir una aprobación", async ({ page }) => {
  const datos = await datosMovil();
  test.skip(!datos.approvalId, "La preparación no dejó una aprobación pendiente.");

  await test.step("La bandeja lista la solicitud", async () => {
    await page.goto("/aprobaciones");
    await sinDesborde(page, "bandeja de aprobaciones");
    await page.locator(`a[href="/aprobaciones/${datos.approvalId}"]`).first().tap();
    await page.waitForURL(new RegExp(`/aprobaciones/${datos.approvalId}$`));
    await sinDesborde(page, "detalle de la aprobación");
  });

  await test.step("Aprobar lo que se ve", async () => {
    const aprobar = page.getByRole("button", { name: "Aprobar", exact: true });
    await expect(aprobar).toBeVisible();
    await aprobar.tap();
    const dialog = page.getByRole("dialog");
    if (await dialog.isVisible().catch(() => false)) {
      await sinDesborde(page, "confirmar aprobación");
      await dialog.getByRole("button", { name: /Aprobar|Confirmar/ }).last().tap();
    }
    await expect(page.getByText(/Aprobada|Aprobado|Decidida/).first()).toBeVisible();
    await sinDesborde(page, "aprobación decidida");
  });
});
