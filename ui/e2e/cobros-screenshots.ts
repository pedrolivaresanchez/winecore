import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'

const baseUrl = process.env.COBROS_UI_URL ?? 'http://127.0.0.1:5209'
const outDir = '/opt/cursor/artifacts/screenshots'
const chromePath = '/usr/local/bin/google-chrome'

const viewports = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const

const frames = [
  { name: 'pendiente', sdr: 'sdr-list' },
  { name: 'dialogo', sdr: 'sdr-dialog' },
  { name: 'pagos', sdr: 'sdr-list' },
  { name: 'conciliacion', sdr: 'sdr-inbox' },
  { name: 'remesas', sdr: 'sdr-list' },
  { name: 'remesa', sdr: 'sdr-record' },
  { name: 'vacio', sdr: 'sdr-empty' },
  { name: 'cuentas', sdr: 'sdr-dialog' },
] as const

type Ids = { import_id: string; remittance_id: string }

async function ids(): Promise<Ids> {
  if (process.env.COBROS_IMPORT_ID && process.env.COBROS_REMITTANCE_ID) {
    return { import_id: process.env.COBROS_IMPORT_ID, remittance_id: process.env.COBROS_REMITTANCE_ID }
  }
  const file = JSON.parse(await readFile('/tmp/cobros-ids.json', 'utf8')) as Ids
  return file
}

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
  const right = path.join(outDir, `cobros-${frame}-${width}.png`)
  const dest = path.join(outDir, `side-by-side-cobros-${frame}-${width}.png`)
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
  const known = await ids()
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  })
  try {
    for (const viewport of viewports) {
      const width = viewport.width
      const list = await openPage(browser, viewport)
      await ready(list.page, '/cobros', '[data-screen="cobros-pendiente"]')
      await list.page.getByText('Bodega Norte S.L.').first().waitFor()
      await shot(list.page, `cobros-pendiente-${width}`)
      await list.page.getByRole('button', { name: 'Registrar cobro', exact: true }).click()
      await list.page.waitForSelector('[data-screen="cobros-dialogo"]')
      await list.page.locator('#cobro-cliente').selectOption({ label: 'Bodega Norte S.L.' })
      await list.page.getByText('FS-PO-1042').waitFor()
      await shot(list.page, `cobros-dialogo-${width}`)
      await list.page.keyboard.press('Escape')
      await list.page.locator('#buscar-cobros').fill('zzzz')
      await list.page.waitForSelector('[data-screen="cobros-vacio"]')
      await shot(list.page, `cobros-vacio-${width}`)
      await list.close()

      const pagos = await openPage(browser, viewport)
      await ready(pagos.page, '/cobros?vista=pagos', '[data-screen="cobros-pagos"]')
      await pagos.page.getByText('Bodega Norte S.L.').first().waitFor()
      await shot(pagos.page, `cobros-pagos-${width}`)
      await pagos.close()

      const queue = await openPage(browser, viewport)
      await ready(queue.page, `/cobros?vista=conciliacion&extracto=${known.import_id}`, '[data-screen="cobros-conciliacion"]')
      await queue.page.getByText('FS-PO-1108').first().waitFor()
      await shot(queue.page, `cobros-conciliacion-${width}`)
      await queue.page.getByRole('button', { name: 'Cuentas' }).click()
      await queue.page.waitForSelector('[data-screen="cobros-cuentas"]')
      await queue.page.getByText('···· 1332').waitFor()
      await shot(queue.page, `cobros-cuentas-${width}`)
      await queue.close()

      const remesas = await openPage(browser, viewport)
      await ready(remesas.page, '/cobros?vista=remesas', '[data-screen="cobros-remesas"]')
      await remesas.page.getByText('Adeudo').first().waitFor()
      await shot(remesas.page, `cobros-remesas-${width}`)
      await remesas.close()

      const record = await openPage(browser, viewport)
      await ready(record.page, `/cobros/remesas/${known.remittance_id}`, '[data-screen="cobros-remesa"]')
      await record.page.getByRole('button', { name: 'Pedir aprobación' }).waitFor()
      await shot(record.page, `cobros-remesa-${width}`)
      await record.close()
    }
    for (const viewport of viewports) {
      for (const frame of frames) composite(frame.name, viewport.width)
    }
  } finally {
    await browser.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
