import { spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'

const baseUrl = process.env.FACTURAS_UI_URL ?? 'http://127.0.0.1:5208'
const outDir = '/opt/cursor/artifacts/screenshots'
const chromePath = '/usr/local/bin/google-chrome'
const withhold = '01a19345-3d4e-7a58-9337-a24381ba6ebf'
const draft = '01a19345-3dd6-7b66-adb9-be549d69867b'
const issued = '01a19345-3ccd-7238-afcc-fc1c35d6a829'

const viewports = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const

const frames = [
  { name: 'lista', sdr: 'sdr-list' },
  { name: 'ficha', sdr: 'sdr-record' },
  { name: 'dialogo', sdr: 'sdr-dialog' },
  { name: 'vacio', sdr: 'sdr-empty' },
  { name: 'envio', sdr: 'sdr-record' },
  { name: 'rectificar', sdr: 'sdr-record' },
  { name: 'pdf', sdr: 'sdr-record' },
] as const

async function assertInView(page: Page, name: string) {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (extra > 1) throw new Error(`${name} se sale ${extra}px`)
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(300)
  const file = path.join(outDir, `${name}.png`)
  await page.screenshot({ path: file })
  await assertInView(page, name)
  console.log(file)
}

async function openPage(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    reducedMotion: 'reduce',
    colorScheme: 'light',
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return {
    page,
    async close() {
      if (errors.length > 0) throw new Error(errors.join(' | '))
      await context.close()
    },
  }
}

async function ready(page: Page, routePath: string, selector: string) {
  await page.goto(`${baseUrl}${routePath}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(selector, { timeout: 20_000 })
}

function composite(frame: string, width: number) {
  const sdrName = frames.find((item) => item.name === frame)?.sdr
  if (!sdrName) return
  const left = path.join(outDir, `${sdrName}-${width}.png`)
  const right = path.join(outDir, `facturas-${frame}-${width}.png`)
  const dest = path.join(outDir, `side-by-side-facturas-${frame}-${width}.png`)
  const script = `
from PIL import Image
left = Image.open(${JSON.stringify(left)}).convert('RGB')
right = Image.open(${JSON.stringify(right)}).convert('RGB')
height = max(left.height, right.height)
canvas = Image.new('RGB', (left.width + right.width, height), (255, 255, 255))
canvas.paste(left, (0, 0))
canvas.paste(right, (left.width, 0))
canvas.save(${JSON.stringify(dest)})
print(${JSON.stringify(dest)})
`
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || 'No se ha podido componer la captura')
  process.stdout.write(result.stdout)
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  })
  try {
    for (const viewport of viewports) {
      const width = viewport.width
      const list = await openPage(browser, viewport)
      await ready(list.page, '/facturas', '[data-screen="facturas"]')
      await list.page.getByRole('link', { name: 'CF26-0001' }).waitFor({ timeout: 15_000 })
      await shot(list.page, `facturas-lista-${width}`)
      await list.page.getByLabel('Buscar número o cliente').fill('zzzz')
      await list.page.waitForSelector('[data-screen="facturas-vacio"]')
      await shot(list.page, `facturas-vacio-${width}`)
      await list.close()

      const record = await openPage(browser, viewport)
      await ready(record.page, `/facturas/${withhold}`, '[data-screen="facturas-ficha"]')
      await record.page.getByText('Total a pagar').waitFor({ timeout: 15_000 })
      await shot(record.page, `facturas-ficha-${width}`)
      await record.page.goto(`${baseUrl}/facturas/${issued}`, { waitUntil: 'domcontentloaded' })
      await record.page.waitForSelector('[data-screen="facturas-ficha"]')
      await record.page.getByRole('tab', { name: 'Envío' }).click()
      await record.page.getByRole('button', { name: 'Reenviar' }).waitFor({ timeout: 15_000 })
      await shot(record.page, `facturas-envio-${width}`)
      await record.page.getByRole('tab', { name: 'PDF' }).click()
      await record.page.locator('iframe[title="PDF"]').waitFor({ timeout: 15_000 })
      await shot(record.page, `facturas-pdf-${width}`)
      await record.close()

      const dialog = await openPage(browser, viewport)
      await ready(dialog.page, `/facturas/${draft}`, '[data-screen="facturas-ficha"]')
      await dialog.page.getByRole('button', { name: 'Emitir' }).click()
      await dialog.page.waitForSelector('[data-screen="facturas-dialogo"]', { timeout: 15_000 })
      await shot(dialog.page, `facturas-dialogo-${width}`)
      await dialog.close()

      const rectify = await openPage(browser, viewport)
      await ready(rectify.page, `/facturas/${issued}/rectificar`, '[data-screen="facturas-rectificar"]')
      await shot(rectify.page, `facturas-rectificar-${width}`)
      await rectify.close()

      for (const frame of frames) composite(frame.name, width)
    }
  } finally {
    await browser.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
