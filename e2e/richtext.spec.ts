import { expect, test } from './fixtures'
import {
  addContentToZone,
  chooseFromTextMenu,
  chooseFromToolbarMenu,
  closeReferenceModal,
  createPresentation,
  stage,
  watchForErrors,
  zoneRects,
} from './helpers'

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

    // The toolbar's «Tabell» is the table's own menu, the one a right-click opens.
    await expect(page.getByTestId('table-tools')).toBeVisible()
    await chooseFromTextMenu(page, 'table-tools', 'add-row')
    await expect(table.locator('tr')).toHaveCount(4)
    await chooseFromTextMenu(page, 'table-tools', 'del-row')
    await expect(table.locator('tr')).toHaveCount(3)
    await chooseFromTextMenu(page, 'table-tools', 'add-col')
    await expect(table.locator('tr').first().locator('th, td')).toHaveCount(4)
    // Removing the whole table asks first, from the toolbar as from the menu.
    await chooseFromTextMenu(page, 'table-tools', 'del-table')
    await page.getByTestId('confirm-accept').click()
    await expect(table).toHaveCount(0)
    expect(guard.errors).toEqual([])
  })

  test('kaller den fremhevede tekstblokken en aksent, ikke en overskrift', async ({ page }) => {
    // The word is what was wrong. A button called «Overskrift» inside a text
    // field teaches an author to write one there instead of giving the card a
    // card title, which is the card's actual main heading. The stored node is
    // still a ProseMirror heading — the rename is in the product, not the
    // document.
    const guard = watchForErrors(page)
    await createPresentation(page, 'Aksent')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()

    const accent = page.getByTestId('format-heading')
    await expect(accent).toHaveAttribute('aria-label', 'Aksent')
    await accent.click()
    const heading = stage(page).locator('.subfield h1')
    await expect(heading).toHaveCount(1)

    // One line is a true pill. When the same accent wraps, the corner radius
    // stays tied to one line instead of growing with the block, so it becomes
    // a rounded card and the text stays clear of the corners.
    await page.keyboard.type('Kort aksent')
    // Both in the slide's own pixels: the radius is a computed style, and the
    // stage draws the slide scaled, so a box from `getBoundingClientRect` would
    // be the same pill measured in a different unit.
    const pill = (element: Element) => ({
      height: (element as HTMLElement).offsetHeight,
      radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
    })
    const oneLine = await heading.evaluate(pill)
    expect(oneLine.radius).toBeCloseTo(oneLine.height / 2, 0)

    await page.keyboard.type(
      ' som er lang nok til å brytes over flere linjer i feltet uten å endre typografi eller innholdstype',
    )
    await expect
      .poll(() => heading.evaluate((element) => (element as HTMLElement).offsetHeight))
      .toBeGreaterThan(oneLine.height * 1.5)
    const wrapped = await heading.evaluate(pill)
    expect(wrapped.radius).toBeCloseTo(oneLine.radius, 0)
    expect(wrapped.radius).toBeLessThan(wrapped.height / 2)

    // The colour control beside it is the accent's, and says so.
    await expect(page.getByTestId('heading-color')).toHaveAttribute('aria-label', /Aksentfarge/)
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

    const ratio = async (): Promise<number> =>
      page.evaluate(() => {
        const el = document.querySelector(
          '[data-testid="stage-slide"] .rd-image-wrapper',
        ) as HTMLElement
        const parent = el.parentElement as HTMLElement
        return el.getBoundingClientRect().width / parent.getBoundingClientRect().width
      })

    // Images are inserted at half width so they leave room for the text.
    expect(await ratio()).toBeCloseTo(0.5, 1)

    await wrapper.click()
    await expect(page.getByTestId('image-tools')).toBeVisible()
    await chooseFromTextMenu(page, 'image-tools', 'image-width', 'image-width-25')
    await expect
      .poll(ratio, { message: 'image width follows the chosen percentage' })
      .toBeCloseTo(0.25, 1)

    await chooseFromTextMenu(page, 'image-tools', 'image-width', 'image-width-50')
    await expect.poll(ratio).toBeCloseTo(0.5, 1)

    // Full width makes the figure taller than the card has room for at normal
    // size; the width is taken, and the zone draws its content smaller.
    await chooseFromTextMenu(page, 'image-tools', 'image-width', 'image-width-100')
    await expect.poll(ratio).toBeCloseTo(1, 1)
    await expect(stage(page).locator('.zone-fit[data-fit-scale]')).toHaveCount(1)
    await expect(page.getByTestId('toast')).toHaveCount(0)
  })

  test('inserts a citation into a card title', async ({ page }) => {
    await createPresentation(page, 'Kilde i tittel')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'titled-card')
    await stage(page).locator('.card-header .tiptap').click()
    await page.keyboard.type('Kort med kilde')

    await chooseFromToolbarMenu(page, 'presentation', 'open-references')
    await page.getByTestId('reference-title').fill('Tittelkilde')
    await page.getByTestId('save-reference').click()
    await closeReferenceModal(page)

    await expect(stage(page).locator('.card-header .rd-citation')).toHaveCount(1)
    await expect(stage(page).locator('.card-header .rd-citation')).toHaveText('1')
  })
})
