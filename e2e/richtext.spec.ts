import { expect, test } from '@playwright/test'
import { addContentToZone, createPresentation, stage, watchForErrors, zoneRects } from './helpers'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" fill="#4d6680"/></svg>`

test.describe('rich text', () => {
  test('inserts and edits a table', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Tabeller')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()

    await page.getByTestId('format-table').click()
    const table = stage(page).locator('table')
    await expect(table).toBeVisible()
    await expect(table.locator('tr')).toHaveCount(3)

    await expect(page.getByTestId('table-tools')).toBeVisible()
    await page.getByTestId('table-add-row').click()
    await expect(table.locator('tr')).toHaveCount(4)
    await page.getByTestId('table-del-row').click()
    await expect(table.locator('tr')).toHaveCount(3)
    await page.getByTestId('table-add-col').click()
    await expect(table.locator('tr').first().locator('th, td')).toHaveCount(4)
    await page.getByTestId('table-del-table').click()
    await expect(table).toHaveCount(0)
    expect(guard.errors).toEqual([])
  })

  test('normalises pasted HTML instead of importing foreign styling', async ({ page }) => {
    await createPresentation(page, 'Innliming')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator('.subfield .tiptap').first()
    await field.click()

    await page.evaluate(() => {
      const element = document.querySelector(
        '[data-testid="stage-slide"] .subfield .tiptap',
      ) as HTMLElement
      const transfer = new DataTransfer()
      transfer.setData(
        'text/html',
        '<h3 style="font-size:72px;color:#ff0000;font-family:Comic Sans MS">Limt overskrift</h3>' +
          '<p style="color:#00ff00"><span style="font-size:48px">Limt brødtekst</span></p>',
      )
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      )
    })

    await expect(field).toContainText('Limt overskrift')
    await expect(field).toContainText('Limt brødtekst')
    // Deep headings collapse to the single Slaids heading, and no foreign styling survives.
    await expect(field.locator('h1')).toHaveCount(1)
    await expect(field.locator('h3')).toHaveCount(0)
    const html = await field.innerHTML()
    expect(html).not.toContain('Comic Sans')
    expect(html).not.toContain('#ff0000')
    expect(html).not.toContain('font-size:48px')
  })

  test('resizes an inline image by percentage', async ({ page }) => {
    await createPresentation(page, 'Bildebredde')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()

    await page.getByTestId('open-image').click()
    await page.getByTestId('image-input').setInputFiles({
      name: 'bilde.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })
    const wrapper = stage(page).locator('.rd-image-wrapper').first()
    await expect(wrapper).toBeVisible()

    await wrapper.click()
    await expect(page.getByTestId('image-tools')).toBeVisible()
    await page.getByTestId('image-width-50').click()
    await expect(wrapper).toHaveCSS('width', /.+/)
    const widths = await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="stage-slide"] .rd-image-wrapper',
      ) as HTMLElement
      const parent = el.parentElement as HTMLElement
      return { image: el.getBoundingClientRect().width, parent: parent.getBoundingClientRect().width }
    })
    expect(widths.image / widths.parent).toBeCloseTo(0.5, 1)
  })

  test('inserts a citation into a card title', async ({ page }) => {
    await createPresentation(page, 'Kilde i tittel')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'titled-card')
    await stage(page).locator('.card-header .tiptap').click()
    await page.keyboard.type('Kort med kilde')

    await page.getByTestId('open-references').click()
    await page.getByTestId('reference-title').fill('Tittelkilde')
    await page.getByTestId('save-reference').click()
    await page.getByRole('button', { name: 'Lukk' }).click()

    await expect(stage(page).locator('.card-header .rd-citation')).toHaveCount(1)
    await expect(stage(page).locator('.card-header .rd-citation')).toHaveText('1')
  })
})
