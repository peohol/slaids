import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { expect, familiesFrom, localFaceCss, test, type Page } from './fixtures'
import {
  addContentToZone,
  addPage,
  backToLibrary,
  choosePresentationAction,
  createPresentation,
  enterZoneMode,
  stage,
  toast,
  watchForErrors,
  zoneRects,
} from './helpers'

const FONT_URL = 'https://fonts.gstatic.com/s/slaids-e2e.ttf'
const COUNTER = readFileSync(new URL('./apps/counter-app.html', import.meta.url))
const FIGURE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#1f6feb"/><circle cx="800" cy="450" r="240" fill="#ffdc64"/></svg>'

/** Samme lokale testfont, men med en filadresse eksporten kan bygge inn. */
async function routeExportFonts(page: Page): Promise<void> {
  const fontCss = localFaceCss('Testfont')
  const encoded = /base64,([^)]+)/.exec(fontCss)![1]
  await page.route(FONT_URL, (route) =>
    route.fulfill({
      contentType: 'font/ttf',
      headers: { 'access-control-allow-origin': '*' },
      body: Buffer.from(encoded, 'base64'),
    }),
  )
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({
      contentType: 'text/css',
      headers: { 'access-control-allow-origin': '*' },
      body: familiesFrom(route.request().url())
        .map(localFaceCss)
        .join('\n')
        .replace(/url\(data:font\/ttf;base64,[^)]+\)/g, `url('${FONT_URL}')`),
    }),
  )
}

/** Les den faktisk nedlastede filen, ikke bare nettleserens filnavn. */
async function downloadPdf(page: Page, fileName: string): Promise<string> {
  const downloaded = page.waitForEvent('download')
  await choosePresentationAction(page, 'export-presentation-pdf')
  const file = await downloaded
  expect(file.suggestedFilename()).toBe(fileName)
  expect(await file.failure()).toBeNull()
  await file.saveAs(test.info().outputPath(fileName))
  const path = await file.path()
  expect(path).not.toBeNull()
  const bytes = await readFile(path!)
  expect(bytes.byteLength).toBeGreaterThan(10_000)
  const pdf = bytes.toString('latin1')
  expect(pdf).toMatch(/^%PDF-1\./)
  expect(pdf.trimEnd()).toMatch(/%%EOF$/)
  await expect(toast(page, 'PDF lastet ned.')).toBeVisible()
  return pdf
}

function expectPages(pdf: string, count: number): void {
  expect([...pdf.matchAll(/\/Type\s*\/Page\b/g)]).toHaveLength(count)
  const sizes = [...pdf.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
  expect(sizes).toHaveLength(count)
  for (const [, width, height] of sizes) {
    expect(Number(width) / Number(height)).toBeCloseTo(16 / 9, 3)
  }
  // Hver side inneholder et faktisk rendret bilde av sliden.
  expect([...pdf.matchAll(/\/Subtype\s*\/Image\b/g)].length).toBeGreaterThanOrEqual(count)
}

test.describe('PDF-eksport fra biblioteket', () => {
  test.beforeEach(async ({ page }) => {
    await routeExportFonts(page)
  })

  test('laster ned hele presentasjonen i 16:9 uten å åpne editoren', { tag: '@pr' }, async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'PDF-eksport')
    await enterZoneMode(page)
    await page.getByTestId('inspector-action-image').click()
    await page.getByTestId('image-input').setInputFiles({
      name: 'figur.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(FIGURE),
    })
    await expect(page.getByTestId('image-modal')).toBeHidden()
    await expect(stage(page).locator('img.image-panel__img')).toBeVisible()
    await backToLibrary(page)

    const pdf = await downloadPdf(page, 'pdf-eksport.pdf')
    expectPages(pdf, 2)
    await expect(page.getByTestId('presentation-grid')).toBeVisible()
    await expect(page.getByTestId('editor')).toHaveCount(0)
    await expect(page.getByTestId('pdf-export-status')).toHaveCount(0)
    expect(guard.errors).toEqual([])
  })

  test('viser fontfeil og lar brukeren prøve eksporten igjen', async ({ page }) => {
    await createPresentation(page, 'Prøv igjen')
    await backToLibrary(page)
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 503, body: 'Fonttjenesten er utilgjengelig.' }),
    )
    let downloads = 0
    page.on('download', () => { downloads += 1 })
    await choosePresentationAction(page, 'export-presentation-pdf')
    await expect(toast(page, 'Kunne ikke laste skrifttypene')).toBeVisible()
    await expect(page.getByTestId('pdf-export-status')).toHaveCount(0)
    expect(downloads).toBe(0)

    await routeExportFonts(page)
    const pdf = await downloadPdf(page, 'prøv-igjen.pdf')
    expectPages(pdf, 2)
    expect(downloads).toBe(1)
    await expect(page.getByTestId('pdf-export-status')).toHaveCount(0)
  })

  test('tar med genererte referanser og miniappens forside uten å starte appen', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Med referanse og miniapp')
    const [zone] = await zoneRects(page)
    await addContentToZone(page, zone.id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('Påstand med kilde ')
    await page.getByTestId('insert-reference').click()
    const references = page.getByTestId('reference-modal')
    await references.getByTestId('reference-title').fill('Kilden til påstanden')
    await references.getByTestId('save-reference').click()
    await references.getByRole('button', { name: 'Lukk', exact: true }).click()
    await expect(page.getByTestId('filmstrip-derived')).toHaveCount(1)

    let framesStarted = 0
    page.on('frameattached', () => { framesStarted += 1 })
    await addPage(page, 'interactive')
    await page.getByTestId('interactive-file-input').setInputFiles({
      name: 'counter-app.html',
      mimeType: 'text/html',
      buffer: COUNTER,
    })
    await page.getByTestId('interactive-name-input').fill('Tellerens forside')
    await page.getByTestId('create-interactive').click()
    await expect(stage(page).getByTestId('interactive-name')).toHaveText('Tellerens forside')
    await backToLibrary(page)

    const pdf = await downloadPdf(page, 'med-referanse-og-miniapp.pdf')
    expectPages(pdf, 4)
    expect(framesStarted).toBe(0)
    expect(guard.errors).toEqual([])
  })
})
