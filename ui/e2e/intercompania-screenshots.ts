import { spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'

const baseUrl = process.env.INTERCOMPANIA_UI_URL ?? 'http://127.0.0.1:5210'
const outDir = '/opt/cursor/artifacts/screenshots'
const chromePath = '/usr/local/bin/google-chrome'

const viewports = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const

const frames = [
  { name: 'lista', sdr: 'sdr-list' },
  { name: 'vacio', sdr: 'sdr-empty' },
  { name: 'tarifas', sdr: 'sdr-list' },
  { name: 'ficha', sdr: 'sdr-record' },
  { name: 'tarifa', sdr: 'sdr-record' },
  { name: 'dialogo', sdr: 'sdr-dialog' },
  { name: 'aprobacion', sdr: 'sdr-dialog' },
  { name: 'menu', sdr: 'sdr-menu' },
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
  const right = path.join(outDir, `intercompania-${frame}-${width}.png`)
  const dest = path.join(outDir, `side-by-side-intercompania-${frame}-${width}.png`)
  const script = `
import os
from PIL import Image
left_path = ${JSON.stringify(left)}
if not os.path.exists(left_path):
    raise SystemExit(0)
left = Image.open(left_path).convert('RGB')
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
      await ready(list.page, '/intercompania', '[data-screen="intercompania-lista"]')
      await list.page.getByText('Septiembre 2026').first().waitFor({ timeout: 15_000 })
      await shot(list.page, `intercompania-lista-${width}`)
      await list.page.getByLabel('Buscar mes').fill('zzzz')
      await list.page.waitForSelector('[data-screen="intercompania-vacio"]')
      await shot(list.page, `intercompania-vacio-${width}`)
      await list.close()

      const tariffs = await openPage(browser, viewport)
      await ready(tariffs.page, '/intercompania/tarifas', '[data-screen="intercompania-tarifas"]')
      await tariffs.page.getByText('Informe asesor IC-2026').first().waitFor({ timeout: 15_000 })
      await shot(tariffs.page, `intercompania-tarifas-${width}`)
      await tariffs.close()

      const record = await openPage(browser, viewport)
      await ready(record.page, '/intercompania/2026-09', '[data-screen="intercompania-ficha"]')
      await record.page.getByRole('button', { name: 'Pedir aprobación' }).waitFor({ timeout: 15_000 })
      await shot(record.page, `intercompania-ficha-${width}`)
      await record.page.getByRole('button', { name: 'Pedir aprobación' }).click()
      await record.page.waitForSelector('[data-screen="intercompania-aprobacion"]')
      await shot(record.page, `intercompania-aprobacion-${width}`)
      await record.close()

      const active = await openPage(browser, viewport)
      await ready(active.page, '/intercompania/tarifas', '[data-screen="intercompania-tarifas"]')
      await active.page.getByRole('link', { name: '01/01/2026 – 01/01/2027' }).click()
      await active.page.waitForSelector('[data-screen="intercompania-tarifa"]')
      await shot(active.page, `intercompania-tarifa-${width}`)
      await active.page.getByRole('button', { name: 'Más acciones' }).click()
      await active.page.getByRole('menuitem', { name: 'Retirar' }).waitFor({ timeout: 10_000 })
      await shot(active.page, `intercompania-menu-${width}`)
      await active.close()

      const draft = await openPage(browser, viewport)
      await ready(draft.page, '/intercompania/tarifas', '[data-screen="intercompania-tarifas"]')
      await draft.page.getByRole('link', { name: 'Desde 01/01/2027' }).click()
      await draft.page.waitForSelector('[data-screen="intercompania-tarifa"]')
      await draft.page.getByRole('button', { name: 'Activar', exact: true }).click()
      await draft.page.waitForSelector('[data-screen="intercompania-activar"]')
      await shot(draft.page, `intercompania-dialogo-${width}`)
      await draft.close()
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
