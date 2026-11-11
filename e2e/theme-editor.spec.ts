/**
 * Temaeditoren (§ 15.1): et nytt dekk åpner den straks, forhåndsvisningen er
 * den ekte rendreren og alltid helt synlig, og forsidens to farger er
 * forsidens – ikke globale farger som overstyrer senere inndelinger.
 */

import { expect, test, type Locator, type Page } from './fixtures'
import { PALETTE } from '../src/domain/color'
import { FONT_OPTIONS } from '../src/domain/fonts'
import { FONT_SCALE_PRESETS } from '../src/domain/metrics'
import {
  addPage,
  chooseFromToolbarMenu,
  createFromLibrary,
  watchForErrors,
} from './helpers'

const PREVIEW_TEXTS = [
  'Tittel',
  'Aksent',
  'Slik ser brødtekst ut.',
  'Her er mer brødtekst.',
  'Og her er atter mer brødtekst.',
]

function rgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`
}

async function backgroundOf(element: Locator): Promise<string> {
  return element.evaluate((node) => getComputedStyle(node).backgroundColor)
}

/** Siden en miniatyr i filmstripen tegner. */
function thumbPage(page: Page, index: number): Locator {
  return page.getByTestId('filmstrip-item').nth(index).locator('.slide').first()
}

/** Velg en farge i en fargeknapp i temaeditoren. */
async function pickThemeColor(page: Page, testId: string, color: string): Promise<void> {
  await page.getByTestId(testId).click()
  const popover = page.locator('.popover').getByTestId('palette')
  await popover.locator(`[data-color="${color}"]`).click()
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
}

/**
 * Hvor langt teksten i `field` står fra feltets midte, vannrett og loddrett, i
 * skjermpiksler. Teksten måles som et utvalg over innholdet, ikke som
 * blokkene: en midtstilt blokk er like bred som feltet uansett.
 */
async function offCentre(field: Locator): Promise<{ x: number; y: number }> {
  return field.evaluate((node) => {
    const box = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    const inner = {
      left: box.left + parseFloat(style.paddingLeft),
      right: box.right - parseFloat(style.paddingRight),
      top: box.top + parseFloat(style.paddingTop),
      bottom: box.bottom - parseFloat(style.paddingBottom),
    }
    const range = document.createRange()
    range.selectNodeContents(node.querySelector('.rich-doc') ?? node)
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0)
    const text = {
      left: Math.min(...rects.map((rect) => rect.left)),
      right: Math.max(...rects.map((rect) => rect.right)),
      top: Math.min(...rects.map((rect) => rect.top)),
      bottom: Math.max(...rects.map((rect) => rect.bottom)),
    }
    return {
      x: Math.abs((text.left + text.right) / 2 - (inner.left + inner.right) / 2),
      y: Math.abs((text.top + text.bottom) / 2 - (inner.top + inner.bottom) / 2),
    }
  })
}

test.describe('temaeditoren', () => {
  test('et nytt dekk åpner temaeditoren med en forhåndsvisning fra den ekte rendreren', { tag: '@pr' }, async ({ page }) => {
    const guard = watchForErrors(page)
    await page.goto('/')
    await page.getByTestId('new-presentation').click()
    await page.getByTestId('presentation-title-input').fill('Temaprøve')
    await page.getByTestId('create-presentation').click()

    const modal = page.getByTestId('theme-modal')
    await expect(modal).toBeVisible()
    const preview = modal.getByTestId('theme-preview')
    await expect(preview).toBeVisible()

    // En ekte slide: tre soner, et kort med tittel, en beholder og et kort uten tittel.
    const slide = preview.locator('.slide')
    await expect(slide.locator('.slide-zone')).toHaveCount(3)
    await expect(slide.locator('.zone-content--titled')).toHaveCount(1)
    await expect(slide.locator('.zone-content--container')).toHaveCount(1)
    await expect(slide.locator('.zone-content--card:not(.zone-content--titled)')).toHaveCount(1)
    await expect(slide.locator('.zone-content--titled h1')).toHaveText('Aksent')
    for (const text of PREVIEW_TEXTS) await expect(slide.getByText(text, { exact: true })).toHaveCount(1)
    // Forhåndsvisningen er et resultat, ikke redigering: ingen forminskingsmerker.
    await expect(slide.getByTestId('zone-shrunk-marker')).toHaveCount(0)

    // All tekst er midtstilt vannrett og loddrett i sitt felt.
    for (const field of await slide.locator('.subfield, .card-header').all()) {
      const off = await offCentre(field)
      expect(off.x).toBeLessThan(1.5)
      expect(off.y).toBeLessThan(1.5)
    }

    // Hele tegningen er synlig: innenfor boksen, og boksen innenfor vinduet.
    const drawing = (await preview.locator('.theme-preview__drawing').boundingBox())!
    const box = (await preview.boundingBox())!
    expect(drawing.x).toBeGreaterThanOrEqual(box.x - 0.5)
    expect(drawing.y).toBeGreaterThanOrEqual(box.y - 0.5)
    expect(drawing.x + drawing.width).toBeLessThanOrEqual(box.x + box.width + 0.5)
    expect(drawing.y + drawing.height).toBeLessThanOrEqual(box.y + box.height + 0.5)
    await expect(preview).toBeInViewport({ ratio: 1 })
    expect(await preview.evaluate((node) => node.scrollHeight <= node.clientHeight && node.scrollWidth <= node.clientWidth)).toBe(true)

    // Lukking beholder dekket.
    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
    await expect(page.getByTestId('presentation-title')).toHaveText('Temaprøve')
    expect(guard.errors).toEqual([])
  })

  test('forhåndsvisningen følger temaet, og menyen åpner den samme editoren', async ({ page }) => {
    await page.goto('/')
    await createFromLibrary(page, 'Følger temaet')
    await chooseFromToolbarMenu(page, 'presentation', 'open-theme')
    const modal = page.getByTestId('theme-modal')
    await expect(modal.getByTestId('theme-preview')).toBeVisible()
    const preview = modal.getByTestId('theme-preview').locator('.slide')

    const georgia = FONT_OPTIONS.find((font) => font.id === 'georgia')!
    await modal.getByTestId('theme-body-font').selectOption({ value: georgia.stack })
    await expect
      .poll(() => preview.getByText('Her er mer brødtekst.').evaluate((node) => getComputedStyle(node).fontFamily))
      .toContain(georgia.stack.split(',')[0].replaceAll("'", ''))

    const card = preview.locator('.zone-content--card:not(.zone-content--titled)')
    await expect.poll(() => card.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe('none')
    await modal.getByTestId('theme-shadows').click()
    await expect.poll(() => card.evaluate((node) => getComputedStyle(node).boxShadow)).toBe('none')

    const before = await preview.locator('.zone-content--titled h1').boundingBox()
    await modal.getByTestId(`theme-font-scale-${FONT_SCALE_PRESETS.at(-1)!.value}`).click()
    await expect
      .poll(async () => (await preview.locator('.zone-content--titled h1').boundingBox())!.height)
      .toBeGreaterThan(before!.height)
  })

  test('forsidens farger endrer forsiden og det den styrer, ikke senere inndelinger', async ({ page }) => {
    const later = PALETTE[0][1]
    const background = PALETTE[2][0]
    const accent = PALETTE[4][2]
    await page.goto('/')
    await createFromLibrary(page, 'Farger')

    // En inndeling til, med sin egen bakgrunn.
    await addPage(page, 'section')
    await page.getByTestId('section-title-input').fill('Del to')
    await page.getByTestId('create-section').click()
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(3)
    const inspectorPalettes = page.getByTestId('inspector').getByTestId('palette')
    await inspectorPalettes.nth(1).locator(`[data-color="${later}"]`).click()
    await expect.poll(() => backgroundOf(thumbPage(page, 2))).toBe(rgb(later))

    await chooseFromToolbarMenu(page, 'presentation', 'open-theme')
    await pickThemeColor(page, 'theme-front-background', background)
    await pickThemeColor(page, 'theme-front-accent', accent)
    const preview = page.getByTestId('theme-preview').locator('.slide')
    await expect.poll(() => backgroundOf(preview)).toBe(rgb(background))
    await expect
      .poll(() => backgroundOf(preview.locator('.card-header').first()))
      .toBe(rgb(accent))
    await page.getByTestId('theme-done').click()

    // Forsiden og sliden etter den har de nye fargene; den senere inndelingen har sin egen.
    await expect.poll(() => backgroundOf(thumbPage(page, 0))).toBe(rgb(background))
    await expect.poll(() => backgroundOf(thumbPage(page, 1))).toBe(rgb(background))
    await expect
      .poll(() => backgroundOf(thumbPage(page, 0).locator('.section-pill').first()))
      .toBe(rgb(accent))
    expect(await backgroundOf(thumbPage(page, 2))).toBe(rgb(later))

    // Hver farge er en vanlig, angrebar endring.
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await expect.poll(() => backgroundOf(thumbPage(page, 0))).not.toBe(rgb(background))
    expect(await backgroundOf(thumbPage(page, 2))).toBe(rgb(later))
  })
})
