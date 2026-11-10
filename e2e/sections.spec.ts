import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  addContentToZone,
  createPresentation,
  stage,
  toast,
  waitForSaved,
  watchForErrors,
  worstOverflow,
  zoneRects,
  openSlideMenu,
  addPage,
  pickSystemColor,
} from './helpers'
import { PALETTE, PALETTE_COLUMNS } from '../src/domain/color'

/**
 * Sections, and the front page that is the first of them.
 *
 * Three claims are worth making in a real browser, and none of them can be made
 * anywhere else. The first is that the deck genuinely opens with a section and
 * genuinely cannot be left without one. The second is what a section is for: a
 * heading nobody picked a colour for takes the governing section's, *live* — so
 * recolouring a section has to repaint a heading on a slide the author is not
 * even looking at, without any edit to that slide. The third is that the run
 * stops at the next section: a deck of two parts is drawn in two colours.
 */

/** Pick a colour in the section inspector, from one of its two palettes. */
async function sectionColor(page: Page, label: string, hex: string): Promise<void> {
  await page
    .getByTestId('inspector')
    .locator('section')
    .filter({ hasText: label })
    .getByTestId('palette')
    .locator(`[data-color="${hex}"]`)
    .click()
}

/** The nth page of the filmstrip, front page included. */
async function selectPage(page: Page, index: number): Promise<void> {
  await page.getByTestId('filmstrip-item').nth(index).getByTestId('filmstrip-thumb').click()
}

/**
 * A section on the stage.
 *
 * Scoped deliberately: the filmstrip draws the very same component, which is
 * the point of it — a thumbnail can never misrepresent the page.
 */
function sectionStage(page: Page) {
  return stage(page).getByTestId('section-page')
}

/** The background a heading pill is actually painted with right now. */
async function headingPillColor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const heading = document.querySelector(
      '[data-testid="stage-slide"] .rd-heading',
    ) as HTMLElement
    return getComputedStyle(heading).backgroundColor
  })
}

/** The colour the stage is actually drawn on right now. */
async function stageBackground(page: Page): Promise<string> {
  return page.evaluate(() => {
    const slide = document.querySelector('[data-testid="stage-slide"] .slide') as HTMLElement
    return getComputedStyle(slide).backgroundColor
  })
}

test.describe('forsiden', () => {
  test('er dekkets første slide, og kan ikke byttes ut med en vanlig', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Med forside')

    // Forsiden og den ene tomme sliden: to elementer i stripen, forsiden først.
    const items = page.getByTestId('filmstrip-item')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0).getByTestId('filmstrip-thumb')).toHaveAttribute(
      'aria-label',
      'Forside',
    )

    // Den kan ikke slettes så lenge det ville etterlatt en vanlig slide først,
    // og menyen sier det, med grunnen, før man prøver.
    let menu = await openSlideMenu(page, 0)
    await expect(menu.getByTestId('delete-slide')).toHaveAttribute('data-disabled', '')
    await expect(menu.getByTestId('delete-slide')).toContainText('inndeling')
    await page.keyboard.press('Escape')
    menu = await openSlideMenu(page, 1)
    await expect(menu.getByTestId('delete-slide')).not.toHaveAttribute('data-disabled', '')
    await page.keyboard.press('Escape')

    expect(guard.errors).toEqual([])
  })

  test('viser dekkets navn, og tar imot overskrift og underoverskrift', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Kvartalsrapport')

    await selectPage(page, 0)
    await expect(sectionStage(page)).toBeVisible()
    // Navnet forfatteren allerede har skrevet er den åpenbare første overskriften.
    await expect(sectionStage(page)).toContainText('Kvartalsrapport')

    // Plassholderpillen er der før underoverskriften finnes: det er den man
    // klikker på for at den skal begynne å finnes.
    const subtitle = stage(page).locator('[data-section-line="subtitle"] .tiptap')
    await subtitle.click()
    await page.keyboard.type('Tall og tiltak')
    await expect(sectionStage(page)).toContainText('Tall og tiltak')

    // Soner finnes ikke her, så soneverktøyene er ikke tilgjengelige.
    await expect(page.getByTestId('mode-zone')).toBeDisabled()

    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    await selectPage(page, 0)
    await expect(sectionStage(page)).toContainText('Tall og tiltak')

    expect(guard.errors).toEqual([])
  })

  test('klipper aldri en linje – for lang tekst rulles tilbake', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Lang forside')

    await selectPage(page, 0)
    const title = stage(page).locator('[data-section-line="title"] .tiptap')
    await title.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Backspace')

    // Én linje, som en tittelsone: teksten som ikke får plass skal aldri
    // committes, og pillen skal aldri ende opp med noe skjult i seg.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.insertText('En veldig lang forsidetittel ')
      await page.waitForTimeout(60)
    }
    await page.waitForTimeout(400)

    await expect(toast(page, 'Overskriften får ikke plass på inndelingssliden.')).toHaveCount(1)
    expect(await worstOverflow(page)).toBeLessThan(1)

    expect(guard.errors).toEqual([])
  })
})

test.describe('seksjonsfarger', () => {
  test('gir aksentfargen sin til overskrifter som ikke har valgt en egen', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Farger')

    // En overskrift på den første vanlige sliden. Ingen farge er valgt for den.
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('En overskrift')
    await page.getByTestId('format-heading').click()
    await expect(stage(page).locator('.rd-heading')).toHaveCount(1)
    const before = await headingPillColor(page)

    // Fargen settes på seksjonen — ikke på overskriften.
    await selectPage(page, 0)
    await expect(sectionStage(page)).toBeVisible()
    await sectionColor(page, 'Aksentfarge', '#4d4d80')

    // Tilbake til sliden: overskriften har fulgt etter, uten at noen har
    // redigert den.
    await selectPage(page, 1)
    const followed = await headingPillColor(page)
    expect(followed).not.toBe(before)
    expect(followed).toBe('rgb(77, 77, 128)')

    // En overskrift som *får* en egen farge slutter å følge seksjonen.
    await stage(page).locator('.rd-heading').first().click()
    await page.getByTestId('heading-color').click()
    await page.locator('.popover [data-color="#804d4d"]').click()
    await page.keyboard.press('Escape')
    await expect(headingPillColor(page)).resolves.toBe('rgb(128, 77, 77)')

    await selectPage(page, 0)
    await sectionColor(page, 'Aksentfarge', '#4d8066')
    await selectPage(page, 1)
    // Uendret: en farge som er valgt, er valgt.
    await expect(headingPillColor(page)).resolves.toBe('rgb(128, 77, 77)')

    // …og «Standard» gir den tilbake til seksjonen.
    await stage(page).locator('.rd-heading').first().click()
    await page.getByTestId('heading-color').click()
    await page.getByTestId('palette-inherited').click()
    await page.keyboard.press('Escape')
    await expect(headingPillColor(page)).resolves.toBe('rgb(77, 128, 102)')

    expect(guard.errors).toEqual([])
  })

  test('ordner fargene etter fargetone, og tar imot en hvilken som helst farge fra systemets fargevelger', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Egen farge')
    await selectPage(page, 0)
    await expect(sectionStage(page)).toBeVisible()

    const palette = page
      .getByTestId('inspector')
      .locator('section')
      .filter({ hasText: 'Bakgrunnsfarge' })
      .getByTestId('palette')

    // Radene i rutenettet er palettens egne rader, i samme rekkefølge, hver på
    // én linje i inspektørens bredde – ingen rad brytes og skiller en
    // fargetone fra nyansene sine. Kolonnene er felles, så svart, hvit og
    // knappen for egen farge står under de første fargene.
    const rows = await palette.locator('.palette__row').evaluateAll((elements) =>
      elements.map((row) =>
        [...row.querySelectorAll<HTMLElement>('button')].map((button) => {
          const box = button.getBoundingClientRect()
          return { color: button.dataset.color ?? 'custom', x: Math.round(box.x), y: Math.round(box.y) }
        }),
      ),
    )
    expect(rows.map((row) => row.map((swatch) => swatch.color))).toEqual(
      PALETTE.map((row, index) => (index === PALETTE.length - 1 ? [...row, 'custom'] : [...row])),
    )
    for (const row of rows) expect(new Set(row.map((swatch) => swatch.y)).size).toBe(1)
    const columns = rows[0].map((swatch) => swatch.x)
    expect(columns).toHaveLength(PALETTE_COLUMNS)
    expect(rows.at(-1)?.map((swatch) => swatch.x)).toEqual(columns.slice(0, rows.at(-1)?.length))

    // En farge utenfor paletten, fra systemets fargevelger. Mens en
    // palettfarge er valgt, er det den som er markert.
    await sectionColor(page, 'Bakgrunnsfarge', PALETTE[1][0])
    const custom = palette.getByTestId('palette-custom')
    await expect(custom).toHaveAttribute('aria-pressed', 'false')
    await pickSystemColor(page, custom, '#123456')
    await expect.poll(() => stageBackground(page)).toBe('rgb(18, 52, 86)')
    await expect(custom).toHaveAttribute('aria-pressed', 'true')
    await expect(palette.locator('[aria-pressed="true"]')).toHaveCount(1)

    // Den er lagret som enhver annen farge.
    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    await selectPage(page, 0)
    await expect.poll(() => stageBackground(page)).toBe('rgb(18, 52, 86)')
    await expect(palette.getByTestId('palette-custom')).toHaveAttribute('aria-pressed', 'true')

    // En palettfarge tar over igjen.
    await sectionColor(page, 'Bakgrunnsfarge', PALETTE[0][0])
    await expect(palette.getByTestId('palette-custom')).toHaveAttribute('aria-pressed', 'false')

    expect(guard.errors).toEqual([])
  })

  test('gjelder fram til neste seksjon, og ikke lenger', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'To deler')

    // Bakgrunnen settes på forsiden, og den ene sliden etter den følger med.
    await selectPage(page, 0)
    await sectionColor(page, 'Bakgrunnsfarge', '#4d4d80')
    await selectPage(page, 1)
    await expect(stageBackground(page)).resolves.toBe('rgb(77, 77, 128)')

    // En ny seksjon arver fargene fra den forrige, som er hele poenget med å
    // ikke måtte velge dem på nytt.
    await addPage(page, 'section')
    await page.getByTestId('section-title-input').fill('Del to')
    await page.getByTestId('create-section').click()
    await expect(sectionStage(page)).toBeVisible()
    await expect(stageBackground(page)).resolves.toBe('rgb(77, 77, 128)')

    // Og når den får sin egen, stopper den forrige seksjonens farge her.
    await sectionColor(page, 'Bakgrunnsfarge', '#4d8066')
    await expect(stageBackground(page)).resolves.toBe('rgb(77, 128, 102)')
    await selectPage(page, 1)
    await expect(stageBackground(page)).resolves.toBe('rgb(77, 77, 128)')

    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    await selectPage(page, 2)
    await expect(stageBackground(page)).resolves.toBe('rgb(77, 128, 102)')

    expect(guard.errors).toEqual([])
  })
})
