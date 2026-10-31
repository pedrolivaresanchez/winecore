import { spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'

const baseUrl = process.env.VENTAS_UI_URL ?? 'http://127.0.0.1:5207'
const outDir = '/opt/cursor/artifacts/screenshots'
const chromePath = '/usr/local/bin/google-chrome'
const sdrDir = outDir

const viewports = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const

const frames = [
  { name: 'lista', sdr: 'sdr-list' },
  { name: 'ficha', sdr: 'sdr-record' },
  { name: 'dialogo', sdr: 'sdr-dialog' },
  { name: 'vacio', sdr: 'sdr-empty' },
  { name: 'emitir', sdr: 'sdr-dialog' },
] as const

async function assertInView(page: Page, name: string) {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (extra > 1) throw new Error(`${name} se sale ${extra}px`)
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(250)
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
  const left = path.join(sdrDir, `${sdrName}-${width}.png`)
  const right = path.join(outDir, `ventas-${frame}-${width}.png`)
  const dest = path.join(outDir, `side-by-side-ventas-${frame}-${width}.png`)
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
      await ready(list.page, '/ventas/presupuestos', '[data-screen="ventas-lista"]')
      await list.page.getByText('Elsa Ejemplo Airén').first().waitFor({ timeout: 15_000 })
      await shot(list.page, `ventas-lista-${width}`)
      await list.page.getByLabel('Buscar número o cliente').fill('zzzz')
      await list.page.waitForSelector('[data-screen="ventas-vacio"]')
      await shot(list.page, `ventas-vacio-${width}`)
      await list.close()

      const record = await openPage(browser, viewport)
      await ready(record.page, '/ventas/pedidos', '[data-screen="ventas-lista"]')
      await record.page.getByRole('link', { name: /PC26/ }).click()
      await record.page.waitForSelector('[data-screen="ventas-ficha"]')
      await shot(record.page, `ventas-ficha-${width}`)
      await record.close()

      const dialog = await openPage(browser, viewport)
      await ready(dialog.page, '/ventas/presupuestos', '[data-screen="ventas-lista"]')
      await dialog.page.getByRole('button', { name: 'Nuevo presupuesto' }).click()
      await dialog.page.waitForSelector('[data-screen="ventas-dialogo"]')
      await shot(dialog.page, `ventas-dialogo-${width}`)
      await dialog.close()

      const issue = await openPage(browser, viewport)
      await ready(issue.page, '/ventas/albaranes', '[data-screen="ventas-lista"]')
      await issue.page.getByRole('link', { name: 'Borrador' }).click()
      await issue.page.waitForSelector('[data-screen="ventas-ficha"]')
      await issue.page.getByRole('button', { name: 'Emitir', exact: true }).click()
      await issue.page.waitForSelector('[data-screen="ventas-emitir"]')
      await shot(issue.page, `ventas-emitir-${width}`)
      await issue.close()
    }
  } finally {
    await browser.close()
  }
  for (const viewport of viewports) {
    for (const frame of frames) composite(frame.name, viewport.width)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Error')
  process.exit(1)
})
