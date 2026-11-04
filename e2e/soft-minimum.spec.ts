/**
 * A person may make a zone smaller than its text needs; the slide then draws
 * the text smaller. See `domain/softSize.ts` for the two limits, and
 * `ui/editor/softLimitDrag.ts` for the magnet at the soft one.
 *
 * Every number here is read off the app rather than assumed: where the soft
 * limit lies depends on the text, the font and the theme, so the tests find it
 * by dragging towards it and watching for the mark — the same way a person
 * would.
 */

import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  addContentToZone,
  caretInto,
  createPresentation,
  enterContentMode,
  enterZoneMode,
  splitSelected,
  stage,
  toast,
  waitForSaved,
  watchForErrors,
  zoneRects,
} from './helpers'
import { createContainer } from '../src/domain/content'
import { minimumSizeFor } from '../src/domain/geometry'
import { createLeaf } from '../src/domain/layout'
import { geometryForTheme } from '../src/domain/metrics'
import { defaultTheme } from '../src/domain/presentation'
import { SOFT_LIMIT_RESISTANCE_PX } from '../src/ui/editor/softLimitDrag'
import { SHRUNK_ZONE_MESSAGE, SHRUNK_ZONE_TYPING_MESSAGE } from '../src/ui/editor/ShrunkZoneMarker'

/** The narrowest a text zone may ever be, whatever it says. */
const HARD_MIN_WIDTH = minimumSizeFor(createLeaf(createContainer()), geometryForTheme(defaultTheme())).width

const TEXT = 'Dette er en setning med noen helt vanlige ord i seg. '.repeat(9)

/** Screen pixels per step of a slow drag: fine enough to see the magnet hold. */
const STEP_PX = 2

/** A row of two zones, the left one holding text that fits it with some room to spare. */
async function rowWithText(page: Page, title: string): Promise<string> {
  await createPresentation(page, title)
  await enterZoneMode(page)
  await splitSelected(page, [1, 1], 'x')
  const [left] = await zoneRects(page)
  await enterContentMode(page)
  await addContentToZone(page, left.id, 'container')
  const field = zoneLocator(page, left.id).locator('.tiptap').first()
  await caretInto(field)
  await page.keyboard.insertText(TEXT)
  await page.waitForTimeout(300)
  await enterZoneMode(page)
  return left.id
}

function zoneLocator(page: Page, nodeId: string) {
  return stage(page).locator(`.slide-zone[data-node-id="${nodeId}"]`)
}

async function stageScale(page: Page): Promise<number> {
  return Number(await stage(page).getAttribute('data-scale'))
}

interface Sample {
  /** Screen pixels the pointer has moved. */
  travel: number
  /** The zone's width as drawn, in slide units. */
  width: number
  /** Whether it carries the shrunk mark. */
  marked: boolean
}

async function sample(page: Page, nodeId: string, travel: number): Promise<Sample> {
  const zone = zoneLocator(page, nodeId)
  const box = await zone.boundingBox()
  if (!box) throw new Error('the zone has no box')
  return {
    travel,
    width: box.width / (await stageScale(page)),
    marked: (await zone.getByTestId('zone-shrunk-marker').count()) > 0,
  }
}

/**
 * Press on the ratio handle and move it `travel` screen pixels in `STEP_PX`
 * steps, sampling the zone after each, then let go unless told not to.
 */
async function slowDrag(
  page: Page,
  nodeId: string,
  travel: number,
  options: { release?: boolean } = {},
): Promise<Sample[]> {
  const handle = page.getByTestId('ratio-handle').first()
  const box = await handle.boundingBox()
  if (!box) throw new Error('the ratio handle has no box')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  const samples: Sample[] = []
  const direction = Math.sign(travel)
  for (let moved = STEP_PX; moved <= Math.abs(travel); moved += STEP_PX) {
    await page.mouse.move(x + direction * moved, y)
    samples.push(await sample(page, nodeId, moved))
  }
  if (options.release !== false) {
    await page.mouse.up()
    await page.waitForTimeout(250)
  }
  return samples
}

/** How far the pointer travelled while the zone held the same width before the mark appeared. */
function holdBeforeMark(samples: Sample[]): { held: number; width: number } {
  const first = samples.findIndex((entry) => entry.marked)
  expect(first, 'the drag reached the soft limit').toBeGreaterThan(0)
  const width = samples[first - 1].width
  const start = samples.findIndex((entry) => Math.abs(entry.width - width) < 0.5)
  return { held: samples[first - 1].travel - samples[start].travel, width }
}

/** Whether the zone's content is drawn inside its own box, with nothing outside it. */
async function contentInside(page: Page, nodeId: string): Promise<boolean> {
  return zoneLocator(page, nodeId).evaluate((zone) => {
    const outer = zone.getBoundingClientRect()
    const text = zone.querySelector('.zone-fit__inner')
    if (!text) return false
    const range = document.createRange()
    range.selectNodeContents(text)
    const inner = range.getBoundingClientRect()
    const slack = 1
    return (
      inner.left >= outer.left - slack &&
      inner.top >= outer.top - slack &&
      inner.right <= outer.right + slack &&
      inner.bottom <= outer.bottom + slack
    )
  })
}

/** The scale the zone's content is drawn at, or 1 at normal size. */
async function fitScale(page: Page, nodeId: string): Promise<number> {
  const value = await zoneLocator(page, nodeId).locator('.zone-fit').first().getAttribute('data-fit-scale')
  return value === null ? 1 : Number(value)
}

async function rootRatios(page: Page): Promise<string> {
  await page.getByTestId('zone-breadcrumb').getByRole('button', { name: 'Rot' }).click()
  return (await page.getByTestId('zone-ratios').textContent()) ?? ''
}

test.describe('myk minstegrense', () => {
  test(
    'holder ved den myke grensen, slipper forbi, forminsker teksten og angres',
    { tag: '@pr' },
    async ({ page }) => {
      const { errors } = watchForErrors(page)
      const left = await rowWithText(page, 'Myk grense')
      const ratiosBefore = await rootRatios(page)

      // Slowly towards the left: the zone stops at the soft limit for a
      // stretch of the hand before the mark appears.
      const samples = await slowDrag(page, left, -500, { release: false })
      const { held, width: softWidth } = holdBeforeMark(samples)
      expect(held).toBeGreaterThanOrEqual(SOFT_LIMIT_RESISTANCE_PX - STEP_PX * 2)
      expect(softWidth).toBeGreaterThan(HARD_MIN_WIDTH)
      await page.mouse.up()
      await page.waitForTimeout(250)

      // Released past it, the zone is stored smaller than its text needs.
      const after = await sample(page, left, 0)
      expect(after.marked).toBe(true)
      expect(after.width).toBeLessThan(softWidth)
      // The stored geometry is the one the drag showed at release.
      expect(Math.abs(after.width - samples[samples.length - 1].width)).toBeLessThan(0.5)
      const scale = await fitScale(page, left)
      expect(scale).toBeLessThan(1)
      expect(await contentInside(page, left)).toBe(true)

      // The inspector says why, and the mark takes no pointer.
      await zoneLocator(page, left).click()
      await expect(page.getByTestId('zone-shrunk-notice')).toContainText(SHRUNK_ZONE_MESSAGE)
      await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCSS('pointer-events', 'none')

      // One undo puts the zone back at normal size, unmarked; redo returns it.
      const ratiosShrunk = await rootRatios(page)
      expect(ratiosShrunk).not.toBe(ratiosBefore)
      await page.getByTestId('undo').click()
      await expect(page.getByTestId('zone-ratios')).toHaveText(ratiosBefore)
      await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCount(0)
      expect(await fitScale(page, left)).toBe(1)
      await page.getByTestId('redo').click()
      await expect(page.getByTestId('zone-ratios')).toHaveText(ratiosShrunk)
      await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCount(1)

      // Saved and reopened: the same geometry, and the same state, from the
      // geometry alone.
      await waitForSaved(page)
      await page.reload()
      await expect(stage(page)).toBeVisible()
      await enterZoneMode(page)
      expect(await rootRatios(page)).toBe(ratiosShrunk)
      await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCount(1)
      expect(Math.abs((await fitScale(page, left)) - scale)).toBeLessThan(0.02)
      expect(errors).toEqual([])
    },
  )

  test('stopper ved den harde grensen, uansett hvor langt hånden drar', async ({ page }) => {
    const left = await rowWithText(page, 'Hard grense')
    const samples = await slowDrag(page, left, -1400)
    const narrowest = Math.min(...samples.map((entry) => entry.width))
    expect(narrowest).toBeGreaterThanOrEqual(HARD_MIN_WIDTH - 0.5)
    const stored = await sample(page, left, 0)
    expect(stored.width).toBeGreaterThanOrEqual(HARD_MIN_WIDTH - 0.5)
    // Small is still all there.
    expect(await contentInside(page, left)).toBe(true)
  })

  test('trekkes tilbake til den myke grensen og får normal skrift igjen', async ({ page }) => {
    const left = await rowWithText(page, 'Tilbake')
    await slowDrag(page, left, -400)
    await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCount(1)
    const normalFont = await stage(page)
      .locator('.slide-zone')
      .last()
      .evaluate((zone) => getComputedStyle(zone).fontSize)

    // Back towards the right: the mark goes before the pointer has quite
    // reached where the text fits — the limit reaches out and takes the zone.
    const samples = await slowDrag(page, left, 400)
    const fitted = samples.findIndex((entry) => !entry.marked)
    expect(fitted).toBeGreaterThan(0)
    expect(samples[fitted].width - samples[fitted - 1].width).toBeGreaterThan(0)
    await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCount(0)
    expect(await fitScale(page, left)).toBe(1)
    // Normal type again: the same size as anywhere else on the slide.
    const font = await zoneLocator(page, left).evaluate((zone) => getComputedStyle(zone).fontSize)
    expect(font).toBe(normalFont)
  })

  test('lar en forminsket sone redigeres, forstørret, og viser den uten merke i presentasjon', async ({
    page,
  }) => {
    const { errors } = watchForErrors(page)
    const left = await rowWithText(page, 'Redigering')
    await slowDrag(page, left, -400)
    await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCount(1)

    // Content mode: still marked, and written in straight through the mark.
    await enterContentMode(page)
    await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCount(1)
    // The editor's fields are drawn at the same scale as the static drawing
    // was, with every line inside the zone.
    await expect.poll(() => contentInside(page, left)).toBe(true)
    const field = zoneLocator(page, left).locator('.tiptap').first()
    const text = () => field.evaluate((element) => element.textContent ?? '')
    const before = await text()
    // A letter for a letter is a correction, and is taken.
    await caretInto(field)
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.insertText('d')
    await expect.poll(text).toBe(`d${before.slice(1)}`)
    // More text is held to normal size, like anywhere else, and says why.
    await page.keyboard.insertText('Mange flere ord som ikke får plass. '.repeat(6))
    await expect(toast(page, SHRUNK_ZONE_TYPING_MESSAGE)).toBeVisible()
    await expect.poll(text).toBe(`d${before.slice(1)}`)
    expect(await contentInside(page, left)).toBe(true)

    // The inspector draws just this zone large enough to write in, and back.
    await expect(page.getByTestId('zone-shrunk-notice')).toBeVisible()
    const smallBox = await zoneLocator(page, left).boundingBox()
    await page.getByTestId('zone-shrunk-enlarge').click()
    await expect(page.getByTestId('zone-shrunk-show-slide')).toBeVisible()
    const bigBox = await zoneLocator(page, left).boundingBox()
    expect(bigBox && smallBox && bigBox.width > smallBox.width * 1.5).toBe(true)
    expect(await contentInside(page, left)).toBe(true)
    // Enlarging puts the caret in the field itself, at the end of the text.
    await expect(field).toBeFocused()
    await page.keyboard.press('Backspace')
    await expect.poll(text).toBe(`d${before.slice(1, -1)}`)
    await page.getByTestId('zone-shrunk-show-slide').click()
    await expect(page.getByTestId('zone-shrunk-enlarge')).toBeVisible()

    // Presentation mode: the same small text, and no mark.
    await page.getByTestId('present').click()
    const presented = page.locator('[data-testid="present-view"] .slide-zone').first()
    await expect(presented).toBeVisible()
    await expect(page.getByTestId('zone-shrunk-marker')).toHaveCount(0)
    const presentedScale = await page
      .locator('[data-testid="present-view"] .zone-fit[data-fit-scale]')
      .first()
      .getAttribute('data-fit-scale')
    expect(Number(presentedScale)).toBeLessThan(1)
    expect(errors).toEqual([])
  })
})
